import type { McpConfig, McpOAuthConfig } from './types.js';

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
      // Strip scheme or trailing slash if someone passed a full URL by mistake
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        try {
          return new URL(entry).hostname.toLowerCase();
        } catch {
          return entry;
        }
      }
      // Strip port for IPv4 / domain names (preserve bracketed IPv6 like [::1])
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

export function loadMcpConfig(options: LoadMcpConfigOptions): McpConfig {
  const env = options.env ?? process.env;
  const isProd = env.NODE_ENV === 'production';
  const enabled = (env.MCP_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const port = Number(env.PORT || 3000);

  const defaultPublicUrl = isProd
    ? 'https://giacngo.nhamycali.com/mcp'
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

    const rawJwks =
      env.MCP_OAUTH_JWKS_URI?.trim() ||
      `${normalizedIssuer}/.well-known/jwks.json`;
    const jwksUrl = parseSafeHttpUrl(rawJwks, 'MCP_OAUTH_JWKS_URI', !isProd);

    const rawAuthEndpoint =
      env.MCP_OAUTH_AUTHORIZATION_ENDPOINT?.trim() ||
      `${normalizedIssuer}/authorize`;
    const authUrl = parseSafeHttpUrl(
      rawAuthEndpoint,
      'MCP_OAUTH_AUTHORIZATION_ENDPOINT',
      !isProd
    );

    const rawTokenEndpoint =
      env.MCP_OAUTH_TOKEN_ENDPOINT?.trim() || `${normalizedIssuer}/oauth/token`;
    const tokenUrl = parseSafeHttpUrl(
      rawTokenEndpoint,
      'MCP_OAUTH_TOKEN_ENDPOINT',
      !isProd
    );

    let registrationEndpoint: string | undefined;
    if (env.MCP_OAUTH_REGISTRATION_ENDPOINT?.trim()) {
      registrationEndpoint = parseSafeHttpUrl(
        env.MCP_OAUTH_REGISTRATION_ENDPOINT.trim(),
        'MCP_OAUTH_REGISTRATION_ENDPOINT',
        !isProd
      ).toString();
    }

    oauth = {
      issuer: normalizedIssuer,
      audience:
        env.MCP_OAUTH_AUDIENCE?.trim() ||
        publicUrl.toString().replace(/\/+$/, ''),
      jwksUri: jwksUrl.toString(),
      authorizationEndpoint: authUrl.toString(),
      tokenEndpoint: tokenUrl.toString(),
      registrationEndpoint,
      requiredScope,
      uidClaim: env.MCP_OAUTH_UID_CLAIM?.trim() || 'firebase_uid',
    };
  }

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
    resourceName: 'TBHGN Project MCP Server (Read-Only V1)',
    allowedHosts: Array.from(hostSet),
    allowedOrigins: Array.from(originSet),
    allowFirebaseIdToken,
    requiredScope,
    oauth,
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
