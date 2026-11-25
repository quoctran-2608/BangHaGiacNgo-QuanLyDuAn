import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidation,
  originValidation,
  requireBearerAuth,
} from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type {
  AuthInfo,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import {
  createMcpTokenVerifier,
  discoverAuthorizationServerMetadata,
  McpActorForbiddenError,
  resolveActiveMcpActor,
  resolveVerifiedFirebaseUid,
} from './auth.js';
import {
  createFirestoreReadBridge,
  McpFirestoreBridgeError,
  type McpFirestoreBridge,
} from './firestoreBridge.js';
import { createFirestoreReadRepository } from './firestoreReadRepo.js';
import {
  createOAuthIdentityLinker,
  McpIdentityLinkError,
  type OAuthIdentityLinker,
} from './identityLink.js';
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
  config: McpConfig,
  firestoreBridge: McpFirestoreBridge
) => Promise<McpReadRepository | null> | McpReadRepository | null;

export interface MountMcpServerOptions {
  config: McpConfig;
  verifier?: OAuthTokenVerifier;
  identityLinker?: OAuthIdentityLinker;
  firestoreBridge?: McpFirestoreBridge;
  repositoryFactory?: McpRepositoryFactory;
  auditLogger?: (entry: McpAuditEntry) => void;
  referenceDate?: Date;
  /** Strictly for non-production automated tests */
  allowLocalhostDiscovery?: boolean;
  /** Strictly for non-production automated tests */
  firestoreApiBaseUrlOverride?: string;
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
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + windowMs - now) / 1000)
      );
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'too_many_requests',
        error_description: 'Quá giới hạn truy vấn MCP. Vui lòng thử lại sau.',
      });
      return;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);

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

function getResourceMetadataPathSuffix(resourceUrl: URL): string {
  const cleanPath = resourceUrl.pathname.replace(/\/+$/, '');
  return cleanPath && cleanPath !== '/' ? cleanPath : '';
}

/**
 * Mounts the TBHGN Read-Only MCP V1.1 Streamable HTTP server, RFC 9728 Protected
 * Resource Metadata, optional verbatim AS discovery proxy, and `/api/mcp/health`.
 */
export function mountMcpServer(
  app: Express,
  options: MountMcpServerOptions
): void {
  const { config } = options;
  const verifier =
    options.verifier ??
    createMcpTokenVerifier(config, {
      allowLocalhostDiscovery: options.allowLocalhostDiscovery,
    });
  const identityLinker =
    options.identityLinker ?? createOAuthIdentityLinker(config.oauth);
  const firestoreBridge =
    options.firestoreBridge ??
    createFirestoreReadBridge(config.firestoreBridge);

  const defaultRepositoryFactory: McpRepositoryFactory = async (
    authInfo,
    cfg,
    bridge
  ) => {
    const authMethod = authInfo.extra?.authMethod;

    // Path A: Firebase ID Token — forward caller's own verified token (enforces firestore.rules + server RBAC)
    if (authMethod === 'firebase_id_token' && authInfo.token) {
      return createFirestoreReadRepository({
        projectId: cfg.firebaseProjectId,
        databaseId: cfg.firestoreDatabaseId,
        bearerToken: authInfo.token,
        timeoutMs: cfg.toolTimeoutMs,
        apiBaseUrlOverride: options.firestoreApiBaseUrlOverride,
      });
    }

    // Path B: External OAuth 2.1 JWT — obtain short-lived read-only GCP access token via Firestore Read Bridge
    // (NEVER treats OAuth JWT as a Firebase ID Token; NEVER reads Firestore unauthenticated!)
    if (authMethod === 'oauth_jwt') {
      const bridgeAccessToken = await bridge.getAccessToken();
      return createFirestoreReadRepository({
        projectId: cfg.firebaseProjectId,
        databaseId: cfg.firestoreDatabaseId,
        bearerToken: bridgeAccessToken,
        timeoutMs: cfg.toolTimeoutMs,
        apiBaseUrlOverride: options.firestoreApiBaseUrlOverride,
      });
    }

    return null;
  };

  const repositoryFactory =
    options.repositoryFactory ?? defaultRepositoryFactory;

  const canonicalResource = config.publicUrl.toString().replace(/\/+$/, '');

  // 1. Safe MCP health check (never exposes secrets, file paths, or tokens)
  app.get('/api/mcp/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      enabled: config.enabled,
      mode: 'read_only_v1.1',
      endpoint: '/mcp',
      resource: canonicalResource,
      toolCount: MCP_READ_ONLY_TOOL_NAMES.length,
      tools: [...MCP_READ_ONLY_TOOL_NAMES],
      auth: {
        firebaseIdTokenEnabled: config.allowFirebaseIdToken,
        oauthConfigured: Boolean(config.oauth),
        identityLinkMode: config.oauth?.identityLinkMode ?? null,
        identityLinksConfigured: identityLinker.isConfigured,
        requiredScope: config.requiredScope,
      },
      firestoreBridge: {
        mode: firestoreBridge.mode,
        ready: firestoreBridge.ready,
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

  // 2. RFC 9728 OAuth 2.0 Protected Resource Metadata
  // Always serves accurate resource + real IdP issuer(s) without inventing AS capabilities.
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
    config.publicUrl
  );
  const protectedResourceMetadata = {
    resource: canonicalResource,
    authorization_servers: config.oauth ? [config.oauth.issuer] : [],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ['header'],
    resource_name: config.resourceName,
  };

  const suffix = getResourceMetadataPathSuffix(config.publicUrl);
  const prmPaths = suffix
    ? [
        '/.well-known/oauth-protected-resource',
        `/.well-known/oauth-protected-resource${suffix}`,
      ]
    : ['/.well-known/oauth-protected-resource'];

  for (const metadataPath of prmPaths) {
    app.get(metadataPath, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.json(protectedResourceMetadata);
    });
  }

  // Optional RFC 8414 verbatim passthrough ONLY when explicitly enabled.
  // Default (`proxyAsMetadata: false`) returns explicit JSON 404 (never SPA HTML 200 and
  // never fabricated AS metadata on TBHGN's domain), ensuring ChatGPT reads the genuine
  // discovery document directly from `authorization_servers[0]` in RFC 9728.
  if (config.oauth?.proxyAsMetadata) {
    const oauthIssuer = config.oauth.issuer;
    app.get('/.well-known/oauth-authorization-server', async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const verifiedMeta = await discoverAuthorizationServerMetadata(
          oauthIssuer,
          { allowLocalhostHttp: options.allowLocalhostDiscovery }
        );
        res.json(verifiedMeta);
      } catch {
        res.status(502).json({
          error: 'as_metadata_unavailable',
          error_description:
            'Không thể tải metadata chính thức từ Authorization Server đã cấu hình.',
        });
      }
    });
  } else {
    app.get(
      [
        '/.well-known/oauth-authorization-server',
        '/.well-known/openid-configuration',
      ],
      (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(404).json({
          error: 'not_found',
          error_description:
            'Authorization Server metadata is hosted by the external IdP listed in /.well-known/oauth-protected-resource/mcp.',
        });
      }
    );
  }

  // 3. Dedicated Express router for `/mcp` with defense-in-depth security
  const mcpRouter = express.Router();

  mcpRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // DNS rebinding & cross-origin protection
  mcpRouter.use(hostHeaderValidation(config.allowedHosts));
  mcpRouter.use(originValidation(config.allowedOrigins));

  // Sliding-window rate limiting
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
        message:
          'TBHGN MCP V1.1 chạy ở chế độ stateless, chỉ hỗ trợ phương thức POST.',
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
        message:
          'TBHGN MCP V1.1 chạy ở chế độ stateless, không dùng phiên DELETE.',
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

    // Step 1: Verify identity link to a real TBHGN Firebase UID BEFORE touching Firestore or requesting bridge tokens
    try {
      resolveVerifiedFirebaseUid(authInfo, identityLinker);
    } catch (err) {
      if (
        err instanceof McpIdentityLinkError ||
        err instanceof McpActorForbiddenError
      ) {
        res.status(403).json({
          error: err.code,
          error_description: err.message,
        });
        return;
      }
      res.status(403).json({
        error: 'oauth_identity_not_linked',
        error_description: 'Không thể xác minh liên kết tài khoản TBHGN.',
      });
      return;
    }

    // Step 2: Build strictly read-only Firestore repository (fail-closed on missing/broken bridge)
    let repo: McpReadRepository | null;
    try {
      repo = await repositoryFactory(authInfo, config, firestoreBridge);
    } catch (err) {
      if (err instanceof McpFirestoreBridgeError) {
        res.status(err.statusCode).json({
          error: err.code,
          error_description: err.message,
        });
        return;
      }
      res.status(503).json({
        error: 'firestore_read_bridge_unavailable',
        error_description:
          'Không thể khởi tạo kết nối đọc chỉ đọc tới cơ sở dữ liệu TBHGN.',
      });
      return;
    }

    if (!repo) {
      res.status(503).json({
        error: 'firestore_read_bridge_unconfigured',
        error_description:
          'Xác thực thành công nhưng máy chủ chưa có kênh đọc Firestore chỉ đọc khả dụng.',
      });
      return;
    }

    // Step 3: Live check against `/users/{uid}` (must exist, isActive === true, valid role)
    let actor;
    try {
      actor = await resolveActiveMcpActor(authInfo, repo, identityLinker);
    } catch (err) {
      if (
        err instanceof McpActorForbiddenError ||
        err instanceof McpIdentityLinkError
      ) {
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

    // Step 4: Execute stateless per-request Read-Only MCP Server bound to verified `actor`
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
