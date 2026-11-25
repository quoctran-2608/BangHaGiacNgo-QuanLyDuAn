import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidation,
  mcpAuthMetadataRouter,
  originValidation,
  requireBearerAuth,
} from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import {
  createMcpTokenVerifier,
  McpActorForbiddenError,
  resolveActiveMcpActor,
} from './auth.js';
import { createFirestoreReadRepository } from './firestoreReadRepo.js';
import {
  createTbhgnMcpServer,
  MCP_READ_ONLY_TOOL_NAMES,
} from './tools.js';
import type {
  McpAuditEntry,
  McpConfig,
  McpReadRepository,
} from './types.js';

export type McpRepositoryFactory = (
  authInfo: AuthInfo,
  config: McpConfig
) => McpReadRepository | null;

export interface MountMcpServerOptions {
  config: McpConfig;
  verifier?: OAuthTokenVerifier;
  repositoryFactory?: McpRepositoryFactory;
  auditLogger?: (entry: McpAuditEntry) => void;
  referenceDate?: Date;
}

function createSlidingWindowRateLimiter(maxPerMinute: number) {
  const windowMs = 60_000;
  const buckets = new Map<string, number[]>();

  return function mcpRateLimiter(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);

    if (timestamps.length >= maxPerMinute) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'too_many_requests',
        error_description: 'Quá giới hạn truy vấn MCP. Vui lòng thử lại sau.',
      });
      return;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);

    // Prevent unbounded memory growth from stale IP keys
    if (buckets.size > 1_000) {
      for (const [bucketKey, list] of buckets.entries()) {
        if (list.length === 0 || list[list.length - 1] <= cutoff) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}

function defaultRepositoryFactory(
  authInfo: AuthInfo,
  config: McpConfig
): McpReadRepository | null {
  const authMethod = authInfo.extra?.authMethod;
  if (authMethod === 'firebase_id_token' && authInfo.token) {
    return createFirestoreReadRepository({
      projectId: config.firebaseProjectId,
      databaseId: config.firestoreDatabaseId,
      bearerToken: authInfo.token,
      timeoutMs: config.toolTimeoutMs,
    });
  }

  // External OAuth 2.1 JWT without a Firebase ID Token requires a dedicated
  // read-only Firestore credential (e.g., VPS GCP read-only ADC / token bridge)
  // and MUST fail closed rather than attempting unauthenticated reads.
  return null;
}

function getResourceMetadataPathSuffix(resourceUrl: URL): string {
  const cleanPath = resourceUrl.pathname.replace(/\/+$/, '');
  return cleanPath && cleanPath !== '/' ? cleanPath : '';
}

/**
 * Mounts the TBHGN Read-Only MCP V1.0 Streamable HTTP server, OAuth discovery
 * metadata endpoints (RFC 9728 / RFC 8414), and `/api/mcp/health` on an Express app.
 */
export function mountMcpServer(
  app: Express,
  options: MountMcpServerOptions
): void {
  const { config } = options;
  const verifier = options.verifier ?? createMcpTokenVerifier(config);
  const repositoryFactory =
    options.repositoryFactory ?? defaultRepositoryFactory;

  // 1. Safe MCP health check (never exposes secrets, tokens, or private URLs)
  app.get('/api/mcp/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      enabled: config.enabled,
      mode: 'read_only_v1',
      endpoint: '/mcp',
      toolCount: MCP_READ_ONLY_TOOL_NAMES.length,
      tools: [...MCP_READ_ONLY_TOOL_NAMES],
      auth: {
        firebaseIdTokenEnabled: config.allowFirebaseIdToken,
        oauthConfigured: Boolean(config.oauth),
        requiredScope: config.requiredScope,
      },
      projectId: config.firebaseProjectId,
      databaseId: config.firestoreDatabaseId,
    });
  });

  if (!config.enabled) {
    app.all('/mcp', (_req, res) => {
      res.status(503).json({
        error: 'mcp_disabled',
        error_description: 'TBHGN MCP Server hiện đang tắt bởi cấu hình máy chủ.',
      });
    });
    return;
  }

  // 2. OAuth 2.1 Protected Resource Metadata (RFC 9728) & Authorization Server Metadata (RFC 8414)
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
    config.publicUrl
  );

  if (config.oauth) {
    const oauthMetadata: OAuthMetadata = {
      issuer: config.oauth.issuer,
      authorization_endpoint: config.oauth.authorizationEndpoint,
      token_endpoint: config.oauth.tokenEndpoint,
      registration_endpoint: config.oauth.registrationEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [config.oauth.requiredScope],
    };

    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: config.publicUrl,
        scopesSupported: [config.oauth.requiredScope],
        resourceName: config.resourceName,
      })
    );

    // Also respond on root /.well-known/oauth-protected-resource for clients
    // that probe the origin root before path-suffixed RFC 9728 metadata.
    const suffix = getResourceMetadataPathSuffix(config.publicUrl);
    if (suffix) {
      app.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          resource: config.publicUrl.toString().replace(/\/+$/, ''),
          authorization_servers: [config.oauth!.issuer],
          scopes_supported: [config.oauth!.requiredScope],
          bearer_methods_supported: ['header'],
          resource_name: config.resourceName,
        });
      });
    }
  } else {
    const fallbackMetadata = {
      resource: config.publicUrl.toString().replace(/\/+$/, ''),
      authorization_servers: [] as string[],
      scopes_supported: [config.requiredScope],
      bearer_methods_supported: ['header'],
      resource_name: config.resourceName,
    };
    const suffix = getResourceMetadataPathSuffix(config.publicUrl);
    const paths = suffix
      ? [
          '/.well-known/oauth-protected-resource',
          `/.well-known/oauth-protected-resource${suffix}`,
        ]
      : ['/.well-known/oauth-protected-resource'];

    for (const metadataPath of paths) {
      app.get(metadataPath, (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(fallbackMetadata);
      });
    }
  }

  // 3. Dedicated Express router for `/mcp` with strict security & Streamable HTTP
  const mcpRouter = express.Router();

  // Security headers for MCP endpoint
  mcpRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // DNS rebinding & cross-origin protection
  mcpRouter.use(hostHeaderValidation(config.allowedHosts));
  mcpRouter.use(originValidation(config.allowedOrigins));

  // Rate limiting
  mcpRouter.use(createSlidingWindowRateLimiter(config.rateLimitPerMinute));

  // Request payload size limit (100kb)
  mcpRouter.use(express.json({ limit: config.maxBodyBytes }));
  mcpRouter.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'entity.too.large'
      ) {
        res.status(413).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Nội dung yêu cầu vượt quá giới hạn cho phép.',
          },
          id: null,
        });
        return;
      }
      if (err instanceof SyntaxError) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'JSON yêu cầu không hợp lệ.',
          },
          id: null,
        });
        return;
      }
      next(err);
    }
  );

  // Cryptographic Bearer Auth + RFC 9728 WWW-Authenticate challenge
  mcpRouter.use(
    requireBearerAuth({
      verifier,
      expectedResource: config.publicUrl,
      requiredScopes: [config.requiredScope],
      resourceMetadataUrl,
    })
  );

  // Stateless Streamable HTTP: only POST carries JSON-RPC MCP requests
  mcpRouter.get('/', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'TBHGN MCP V1 chạy ở chế độ stateless, chỉ hỗ trợ phương thức POST.',
      },
      id: null,
    });
  });

  mcpRouter.delete('/', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'TBHGN MCP V1 chạy ở chế độ stateless, không dùng phiên DELETE.',
      },
      id: null,
    });
  });

  mcpRouter.post('/', async (req: Request, res: Response) => {
    const authInfo = req.auth;
    if (!authInfo) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Yêu cầu xác thực Bearer token hợp lệ.',
      });
      return;
    }

    const repo = repositoryFactory(authInfo, config);
    if (!repo) {
      res.status(503).json({
        error: 'firestore_read_bridge_unconfigured',
        error_description:
          'Xác thực OAuth thành công nhưng máy chủ chưa được cấu hình kênh đọc Firestore chỉ đọc cho OAuth IdP ngoài.',
      });
      return;
    }

    let actor;
    try {
      actor = await resolveActiveMcpActor(authInfo, repo);
    } catch (err) {
      if (err instanceof McpActorForbiddenError) {
        res.status(403).json({
          error: err.code,
          error_description: err.message,
        });
        return;
      }
      res.status(503).json({
        error: 'actor_resolution_failed',
        error_description:
          'Không thể xác minh hồ sơ thành viên TBHGN tại thời điểm này.',
      });
      return;
    }

    const mcpServer = createTbhgnMcpServer({
      actor,
      repo,
      toolTimeoutMs: config.toolTimeoutMs,
      referenceDate: options.referenceDate,
      auditLogger: options.auditLogger,
    });

    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Lỗi xử lý yêu cầu MCP nội bộ.',
          },
          id: null,
        });
      }
    }
  });

  app.use('/mcp', mcpRouter);
}
