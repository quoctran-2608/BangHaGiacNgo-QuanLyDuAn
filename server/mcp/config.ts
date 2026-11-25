import type {
  McpConfig,
  McpFirestoreBridgeConfig,
  McpFirestoreBridgeMode,
  McpIdentityLinkMode,
  McpOAuthConfig,
} from './types.js';

export const TBHGN_OFFICIAL_PROD_ORIGIN = 'https://duan.banghadengiacngo.io.vn';
export const TBHGN_OFFICIAL_PROD_MCP_URL = `${TBHGN_OFFICIAL_PROD_ORIGIN}/mcp`;

export interface LoadMcpConfigOptions {
  firebaseProjectId: string;
  firestoreDatabaseId?: string;
  env?: NodeJS.ProcessEnv;
}

function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]';
}

function parseSafeHttpUrl(
  rawValue: string,
  fieldName: string,
  allowInsecureLocalhost: boolean
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    throw new Error(`Invalid URL in ${fieldName}`);
  }
  if (parsed.protocol === 'https:') {
    return parsed;
  }
  if (
    parsed.protocol === 'http:' &&
    allowInsecureLocalhost &&
    isLocalhostHostname(parsed.hostname)
  ) {
    return parsed;
  }
  throw new Error(
    `${fieldName} must use HTTPS (only localhost may use HTTP in non-production).`
  );
}

function parseHostnameList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        try {
          return new URL(entry).hostname.toLowerCase();
        } catch {
          return entry;
        }
      }
      if (entry.startsWith('[')) {
        const endIdx = entry.indexOf(']');
        return endIdx !== -1 ? entry.slice(0, endIdx + 1) : entry;
      }
      return entry.split(':')[0];
    })
    .filter(Boolean);
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseIdentityLinkMode(raw: string | undefined): McpIdentityLinkMode {
  const normalized = (raw ?? 'mapping_file').trim().toLowerCase();
  if (
    normalized === 'mapping_file' ||
    normalized === 'idp_claim' ||
    normalized === 'both_strict'
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported MCP_OAUTH_IDENTITY_LINK_MODE: "${raw}". Allowed: mapping_file, idp_claim, both_strict.`
  );
}

function parseBridgeMode(raw: string | undefined): McpFirestoreBridgeMode {
  const normalized = (raw ?? 'disabled').trim().toLowerCase();
  if (
    normalized === 'disabled' ||
    normalized === 'service_account_file' ||
    normalized === 'metadata'
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported MCP_FIRESTORE_BRIDGE_MODE: "${raw}". Allowed: disabled, service_account_file, metadata.`
  );
}

export function loadMcpConfig(options: LoadMcpConfigOptions): McpConfig {
  const env = options.env ?? process.env;
  const isProd = env.NODE_ENV === 'production';
  const enabled = (env.MCP_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const port = Number(env.PORT || 3000);

  const defaultPublicUrl = isProd
    ? TBHGN_OFFICIAL_PROD_MCP_URL
    : `http://127.0.0.1:${port}/mcp`;

  const publicUrl = parseSafeHttpUrl(
    env.MCP_PUBLIC_URL?.trim() || defaultPublicUrl,
    'MCP_PUBLIC_URL',
    !isProd
  );

  const requiredScope =
    env.MCP_OAUTH_REQUIRED_SCOPE?.trim() || 'mcp:read';

  const allowFirebaseIdToken =
    (env.MCP_ALLOW_FIREBASE_ID_TOKEN ?? 'true').trim().toLowerCase() !== 'false';

  let oauth: McpOAuthConfig | null = null;
  const rawIssuer = env.MCP_OAUTH_ISSUER?.trim();
  if (rawIssuer) {
    const issuerUrl = parseSafeHttpUrl(rawIssuer, 'MCP_OAUTH_ISSUER', !isProd);
    const normalizedIssuer = issuerUrl.toString().replace(/\/+$/, '');

    let jwksUri: string | undefined;
    if (env.MCP_OAUTH_JWKS_URI?.trim()) {
      jwksUri = parseSafeHttpUrl(
        env.MCP_OAUTH_JWKS_URI.trim(),
        'MCP_OAUTH_JWKS_URI',
        !isProd
      ).toString();
    }

    const identityLinkMode = parseIdentityLinkMode(
      env.MCP_OAUTH_IDENTITY_LINK_MODE
    );
    const proxyAsMetadata =
      (env.MCP_OAUTH_PROXY_AS_METADATA ?? 'false').trim().toLowerCase() ===
      'true';

    oauth = {
      issuer: normalizedIssuer,
      audience:
        env.MCP_OAUTH_AUDIENCE?.trim() ||
        publicUrl.toString().replace(/\/+$/, ''),
      jwksUri,
      requiredScope,
      identityLinkMode,
      uidClaim: env.MCP_OAUTH_UID_CLAIM?.trim() || 'firebase_uid',
      uidMapFile: env.MCP_OAUTH_UID_MAP_FILE?.trim() || undefined,
      uidMapJson: env.MCP_OAUTH_UID_MAP_JSON?.trim() || undefined,
      proxyAsMetadata,
    };
  }

  const bridgeMode = parseBridgeMode(env.MCP_FIRESTORE_BRIDGE_MODE);
  const credentialsFile =
    env.MCP_FIRESTORE_CREDENTIALS_FILE?.trim() ||
    (bridgeMode === 'service_account_file'
      ? env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || undefined
      : undefined);

  const firestoreBridge: McpFirestoreBridgeConfig = {
    mode: bridgeMode,
    credentialsFile,
  };

  const hostSet = new Set<string>();
  hostSet.add(publicUrl.hostname.toLowerCase());
  for (const h of parseHostnameList(env.MCP_ALLOWED_HOSTS)) {
    hostSet.add(h);
  }
  if (env.APP_URL?.trim()) {
    try {
      hostSet.add(new URL(env.APP_URL.trim()).hostname.toLowerCase());
    } catch {
      // ignore invalid APP_URL
    }
  }
  if (!isProd) {
    hostSet.add('localhost');
    hostSet.add('127.0.0.1');
    hostSet.add('[::1]');
  }

  const originSet = new Set<string>(hostSet);
  for (const o of parseHostnameList(env.MCP_ALLOWED_ORIGINS)) {
    originSet.add(o);
  }

  return {
    enabled,
    publicUrl,
    resourceName: 'TBHGN Project MCP Server (Read-Only V1.1)',
    allowedHosts: Array.from(hostSet),
    allowedOrigins: Array.from(originSet),
    allowFirebaseIdToken,
    requiredScope,
    oauth,
    firestoreBridge,
    rateLimitPerMinute: parsePositiveInt(
      env.MCP_RATE_LIMIT_PER_MIN,
      60,
      5,
      600
    ),
    toolTimeoutMs: parsePositiveInt(
      env.MCP_TOOL_TIMEOUT_MS,
      10_000,
      1_000,
      30_000
    ),
    maxBodyBytes: '100kb',
    firebaseProjectId: options.firebaseProjectId,
    firestoreDatabaseId: options.firestoreDatabaseId || '(default)',
  };
}
