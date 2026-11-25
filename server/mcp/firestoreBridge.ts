import fs from 'node:fs';
import path from 'node:path';
import { importPKCS8, SignJWT } from 'jose';
import type {
  McpFirestoreBridgeConfig,
  McpFirestoreBridgeMode,
} from './types.js';

/**
 * Firestore REST API v1 OAuth scope.
 * IMPORTANT: Read-only restriction is enforced at TWO independent layers:
 * 1. Google Cloud IAM role MUST be strictly `roles/datastore.viewer` (read-only).
 * 2. `firestoreReadRepo.ts` issues strictly HTTP `GET` requests and exposes zero write methods.
 * 3. Every MCP tool enforces TBHGN server-side RBAC against `/users/{uid}` before returning data.
 */
export const FIRESTORE_REST_OAUTH_SCOPE =
  'https://www.googleapis.com/auth/datastore';

const GOOGLE_OAUTH2_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GCP_METADATA_TOKEN_URL = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(
  FIRESTORE_REST_OAUTH_SCOPE
)}`;

const TOKEN_FETCH_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

export class McpFirestoreBridgeError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(
    message: string,
    code = 'firestore_read_bridge_unavailable',
    statusCode = 503
  ) {
    super(message);
    this.name = 'McpFirestoreBridgeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface McpFirestoreBridge {
  readonly mode: McpFirestoreBridgeMode;
  readonly ready: boolean;
  getAccessToken(): Promise<string>;
}

interface ParsedServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
}

function assertSafeCredentialsPath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new Error('MCP_FIRESTORE_CREDENTIALS_FILE must be an absolute path.');
  }
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  const forbiddenDirs = [
    path.resolve(cwd, 'dist'),
    path.resolve(cwd, 'public'),
    path.resolve(cwd, 'src'),
  ];
  for (const dir of forbiddenDirs) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) {
      throw new Error(
        'MCP_FIRESTORE_CREDENTIALS_FILE must not reside inside dist/public/src.'
      );
    }
  }
  return resolved;
}

function validateAllowedTokenUri(
  rawUri: string | undefined,
  allowLoopbackForTest: boolean
): string {
  const candidate = (rawUri || GOOGLE_OAUTH2_TOKEN_URI).trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid service account token_uri.');
  }
  if (candidate === GOOGLE_OAUTH2_TOKEN_URI) {
    return candidate;
  }
  if (
    allowLoopbackForTest &&
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  ) {
    return candidate;
  }
  throw new Error(
    `Untrusted token_uri in credentials. Only ${GOOGLE_OAUTH2_TOKEN_URI} is allowed.`
  );
}

function loadServiceAccountFromFile(
  filePath: string,
  tokenUriOverride?: string,
  allowLoopbackForTest = false
): ParsedServiceAccount {
  const safePath = assertSafeCredentialsPath(filePath);
  if (!fs.existsSync(safePath)) {
    throw new Error('Configured Firestore bridge credentials file not found.');
  }
  const raw = JSON.parse(fs.readFileSync(safePath, 'utf8')) as Record<
    string,
    unknown
  >;
  if (raw.type !== 'service_account') {
    throw new Error('Credentials file must have type "service_account".');
  }
  const clientEmail =
    typeof raw.client_email === 'string' ? raw.client_email.trim() : '';
  const privateKeyPem =
    typeof raw.private_key === 'string' ? raw.private_key.trim() : '';

  if (
    !clientEmail ||
    !privateKeyPem.includes('BEGIN PRIVATE KEY')
  ) {
    throw new Error('Credentials file is missing valid service account fields.');
  }

  const tokenUri = validateAllowedTokenUri(
    tokenUriOverride ??
      (typeof raw.token_uri === 'string' ? raw.token_uri : undefined),
    allowLoopbackForTest
  );

  return {
    clientEmail,
    privateKeyPem,
    tokenUri,
  };
}

interface TokenCacheState {
  accessToken: string;
  expiresAtMs: number;
}

export interface CreateFirestoreReadBridgeOptions {
  /** Strictly for non-production automated tests */
  allowLoopbackTokenEndpoint?: boolean;
  /** Optional pre-parsed service account strictly for automated tests */
  testServiceAccount?: ParsedServiceAccount;
}

/**
 * Creates a strictly READ-ONLY Google OAuth2 token bridge for server-side
 * Firestore REST API v1 calls when authenticating via an external OAuth 2.1 IdP.
 *
 * Fail-closed: if credentials are missing, malformed, or token exchange fails,
 * throws `McpFirestoreBridgeError` (503) and NEVER falls back to unauthenticated reads.
 */
export function createFirestoreReadBridge(
  config: McpFirestoreBridgeConfig,
  options: CreateFirestoreReadBridgeOptions = {}
): McpFirestoreBridge {
  const allowLoopback =
    Boolean(options.allowLoopbackTokenEndpoint) &&
    process.env.NODE_ENV !== 'production';

  if (config.mode === 'disabled') {
    return {
      mode: 'disabled',
      ready: false,
      async getAccessToken(): Promise<string> {
        throw new McpFirestoreBridgeError(
          'Xác thực OAuth thành công nhưng cầu nối đọc Firestore chỉ đọc chưa được bật trên máy chủ.',
          'firestore_read_bridge_unconfigured',
          503
        );
      },
    };
  }

  let cache: TokenCacheState | null = null;
  let inFlight: Promise<string> | null = null;

  if (config.mode === 'metadata') {
    const metadataUrl =
      allowLoopback && config.metadataUrlOverride
        ? config.metadataUrlOverride
        : GCP_METADATA_TOKEN_URL;

    async function fetchMetadataToken(): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(metadataUrl, {
          method: 'GET',
          headers: {
            'Metadata-Flavor': 'Google',
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (!resp.ok) {
          throw new McpFirestoreBridgeError(
            'Không thể lấy ngắn hạn access token từ GCP Metadata Server.',
            'firestore_read_bridge_token_failed',
            503
          );
        }
        const data = (await resp.json()) as {
          access_token?: unknown;
          expires_in?: unknown;
        };
        if (typeof data.access_token !== 'string' || !data.access_token) {
          throw new McpFirestoreBridgeError(
            'Phản hồi token từ Metadata Server không hợp lệ.',
            'firestore_read_bridge_token_failed',
            503
          );
        }
        const expiresInSec =
          typeof data.expires_in === 'number' && data.expires_in > 0
            ? data.expires_in
            : 300;
        cache = {
          accessToken: data.access_token,
          expiresAtMs: Date.now() + expiresInSec * 1000,
        };
        return data.access_token;
      } catch (err) {
        if (err instanceof McpFirestoreBridgeError) throw err;
        throw new McpFirestoreBridgeError(
          'Không thể kết nối cầu nối đọc Firestore qua GCP Metadata Server.',
          'firestore_read_bridge_unavailable',
          503
        );
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      mode: 'metadata',
      ready: true,
      async getAccessToken(): Promise<string> {
        if (cache && Date.now() < cache.expiresAtMs - TOKEN_REFRESH_SKEW_MS) {
          return cache.accessToken;
        }
        if (!inFlight) {
          inFlight = fetchMetadataToken().finally(() => {
            inFlight = null;
          });
        }
        return inFlight;
      },
    };
  }

  // Mode: service_account_file (Read-only IAM `roles/datastore.viewer` JSON outside webroot)
  let parsedSa: ParsedServiceAccount | null = null;
  if (options.testServiceAccount) {
    try {
      const validatedUri = validateAllowedTokenUri(
        options.testServiceAccount.tokenUri,
        allowLoopback
      );
      parsedSa = {
        ...options.testServiceAccount,
        tokenUri: validatedUri,
      };
    } catch {
      parsedSa = null;
    }
  } else if (config.credentialsFile) {
    try {
      parsedSa = loadServiceAccountFromFile(
        config.credentialsFile,
        config.tokenUriOverride,
        allowLoopback
      );
    } catch {
      // Fail closed without crashing the web app
      parsedSa = null;
    }
  }

  if (!parsedSa) {
    return {
      mode: 'service_account_file',
      ready: false,
      async getAccessToken(): Promise<string> {
        throw new McpFirestoreBridgeError(
          'Cầu nối đọc Firestore chỉ đọc chưa có chứng thực hợp lệ trên máy chủ.',
          'firestore_read_bridge_unconfigured',
          503
        );
      },
    };
  }

  const sa = parsedSa;

  async function exchangeServiceAccountToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);
    try {
      const privateKey = await importPKCS8(sa.privateKeyPem, 'RS256');
      const nowSec = Math.floor(Date.now() / 1000);
      const assertion = await new SignJWT({
        scope: FIRESTORE_REST_OAUTH_SCOPE,
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(sa.clientEmail)
        .setSubject(sa.clientEmail)
        .setAudience(sa.tokenUri)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 3600)
        .sign(privateKey);

      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });

      const resp = await fetch(sa.tokenUri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new McpFirestoreBridgeError(
          'Không thể trao đổi access token đọc Firestore từ Google OAuth2.',
          'firestore_read_bridge_token_failed',
          503
        );
      }

      const data = (await resp.json()) as {
        access_token?: unknown;
        expires_in?: unknown;
      };
      if (typeof data.access_token !== 'string' || !data.access_token) {
        throw new McpFirestoreBridgeError(
          'Phản hồi access token cho cầu nối Firestore không hợp lệ.',
          'firestore_read_bridge_token_failed',
          503
        );
      }

      const expiresInSec =
        typeof data.expires_in === 'number' && data.expires_in > 0
          ? data.expires_in
          : 3600;
      cache = {
        accessToken: data.access_token,
        expiresAtMs: Date.now() + expiresInSec * 1000,
      };
      return data.access_token;
    } catch (err) {
      if (err instanceof McpFirestoreBridgeError) throw err;
      throw new McpFirestoreBridgeError(
        'Lỗi kết nối khi khởi tạo phiên đọc Firestore chỉ đọc.',
        'firestore_read_bridge_unavailable',
        503
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    mode: 'service_account_file',
    ready: true,
    async getAccessToken(): Promise<string> {
      if (cache && Date.now() < cache.expiresAtMs - TOKEN_REFRESH_SKEW_MS) {
        return cache.accessToken;
      }
      if (!inFlight) {
        inFlight = exchangeServiceAccountToken().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
