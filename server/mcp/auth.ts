import crypto from 'node:crypto';
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type {
  McpAuthenticatedActor,
  McpAuthMethod,
  McpConfig,
  McpReadRepository,
} from './types.js';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const ALLOWED_OAUTH_ALGS = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'EdDSA',
];

let cachedFirebaseCerts: Record<string, string> = {};
let firebaseCertsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < firebaseCertsExpiresAt && Object.keys(cachedFirebaseCerts).length > 0) {
    return cachedFirebaseCerts;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const resp = await fetch(FIREBASE_CERTS_URL, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Failed to fetch Firebase public certs: ${resp.status}`);
    }
    const cacheControl = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
    cachedFirebaseCerts = (await resp.json()) as Record<string, string>;
    firebaseCertsExpiresAt = now + maxAgeSec * 1000;
    return cachedFirebaseCerts;
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  exp: number;
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64');
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string
): Promise<VerifiedFirebaseToken> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Token không đúng định dạng JWT.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  try {
    header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
  } catch {
    throw new Error('Token không thể giải mã.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Thuật toán hoặc key ID của token không hợp lệ.');
  }

  const certs = await getFirebasePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('Không tìm thấy chứng chỉ công khai khớp với token.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = decodeBase64Url(sigB64);
  if (!verifier.verify(certPem, signature)) {
    throw new Error('Chữ ký Firebase ID Token không hợp lệ.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId) {
    throw new Error('Token audience không khớp với dự án TBHGN.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Token issuer không hợp lệ.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token thiếu UID.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Phiên đăng nhập đã hết hạn.');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Thời gian phát hành token không hợp lệ.');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Tài khoản Google chưa xác minh email.');
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: payload.name || payload.email.split('@')[0],
    exp: payload.exp,
  };
}

function extractScopesFromJwtPayload(payload: Record<string, unknown>): string[] {
  const scopes = new Set<string>();
  if (typeof payload.scope === 'string') {
    for (const part of payload.scope.split(/\s+/)) {
      if (part.trim()) scopes.add(part.trim());
    }
  }
  if (Array.isArray(payload.scp)) {
    for (const item of payload.scp) {
      if (typeof item === 'string' && item.trim()) {
        scopes.add(item.trim());
      }
    }
  }
  return Array.from(scopes);
}

export interface CreateMcpTokenVerifierOptions {
  verifyFirebaseIdTokenFn?: (
    idToken: string,
    projectId: string
  ) => Promise<VerifiedFirebaseToken>;
  oauthJwks?: JWTVerifyGetKey;
}

/**
 * Cryptographic Bearer Token verifier for TBHGN MCP V1.0.
 *
 * Supports:
 * 1. OAuth 2.1 JWT access tokens verified via JWKS (strict asymmetric algorithms,
 *    issuer, audience/resource binding, exp/nbf/iat, required scope, and verified UID claim).
 * 2. Firebase ID Tokens (RS256 verified against Google's official public x509 certs)
 *    when `config.allowFirebaseIdToken` is true.
 *
 * Fail-closed: rejects any missing, unsigned, expired, wrong-issuer, or wrong-audience token.
 */
export function createMcpTokenVerifier(
  config: McpConfig,
  options: CreateMcpTokenVerifierOptions = {}
): OAuthTokenVerifier {
  const firebaseVerifier =
    options.verifyFirebaseIdTokenFn ?? verifyFirebaseIdToken;
  const firebaseIssuer = `https://securetoken.google.com/${config.firebaseProjectId}`;
  const jwks: JWTVerifyGetKey | null = config.oauth
    ? options.oauthJwks ?? createRemoteJWKSet(new URL(config.oauth.jwksUri))
    : null;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const trimmed = token.trim();
      if (!trimmed || trimmed.split('.').length !== 3) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Token xác thực không hợp lệ.'
        );
      }

      // Inspect unverified `iss` ONLY to select which cryptographic verifier to run.
      // Never trust any claim until signature + issuer + audience + expiry pass verification.
      let unverifiedIss: string | undefined;
      try {
        const unverified = decodeJwt(trimmed);
        unverifiedIss =
          typeof unverified.iss === 'string' ? unverified.iss : undefined;
      } catch {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Token xác thực không đúng định dạng JWT.'
        );
      }

      // Path A: Firebase ID Token
      if (
        config.allowFirebaseIdToken &&
        unverifiedIss === firebaseIssuer
      ) {
        try {
          const verified = await firebaseVerifier(
            trimmed,
            config.firebaseProjectId
          );
          return {
            token: trimmed,
            clientId: `firebase:${config.firebaseProjectId}`,
            scopes: [config.requiredScope],
            expiresAt: verified.exp,
            resource: new URL(config.publicUrl.toString()),
            extra: {
              authMethod: 'firebase_id_token' satisfies McpAuthMethod,
              uid: verified.uid,
            },
          };
        } catch {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            'Firebase ID Token không hợp lệ hoặc đã hết hạn.'
          );
        }
      }

      // Path B: OAuth 2.1 JWT via JWKS
      if (config.oauth && jwks) {
        try {
          const { payload } = await jwtVerify(trimmed, jwks, {
            issuer: config.oauth.issuer,
            audience: config.oauth.audience,
            algorithms: ALLOWED_OAUTH_ALGS,
          });

          const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
          if (!exp) {
            throw new OAuthError(
              OAuthErrorCode.InvalidToken,
              'Access token thiếu thời hạn (exp).'
            );
          }

          const rawUid = payload[config.oauth.uidClaim];
          if (typeof rawUid !== 'string' || !rawUid.trim()) {
            throw new OAuthError(
              OAuthErrorCode.InvalidToken,
              'Access token không chứa định danh thành viên TBHGN hợp lệ.'
            );
          }

          const scopes = extractScopesFromJwtPayload(
            payload as Record<string, unknown>
          );
          const clientId =
            typeof payload.azp === 'string'
              ? payload.azp
              : typeof payload.client_id === 'string'
                ? payload.client_id
                : 'oauth-client';

          return {
            token: trimmed,
            clientId,
            scopes,
            expiresAt: exp,
            resource: new URL(config.publicUrl.toString()),
            extra: {
              authMethod: 'oauth_jwt' satisfies McpAuthMethod,
              uid: rawUid.trim(),
            },
          };
        } catch (err) {
          if (err instanceof OAuthError) {
            throw err;
          }
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            'OAuth access token không hợp lệ, sai chữ ký, sai audience hoặc đã hết hạn.'
          );
        }
      }

      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        'Nguồn phát hành token không được máy chủ TBHGN MCP chấp nhận.'
      );
    },
  };
}

export class McpActorForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code: string;

  constructor(message: string, code = 'forbidden_actor') {
    super(message);
    this.name = 'McpActorForbiddenError';
    this.code = code;
  }
}

/**
 * Resolves the verified token's UID against `/users/{uid}` in Firestore.
 * Rejects missing profiles and locked (`isActive !== true`) accounts.
 */
export async function resolveActiveMcpActor(
  authInfo: AuthInfo,
  repo: McpReadRepository
): Promise<McpAuthenticatedActor> {
  const extra = authInfo.extra ?? {};
  const uid = typeof extra.uid === 'string' ? extra.uid.trim() : '';
  const authMethod: McpAuthMethod =
    extra.authMethod === 'oauth_jwt' ? 'oauth_jwt' : 'firebase_id_token';

  if (!uid) {
    throw new McpActorForbiddenError(
      'Không xác định được UID hợp lệ từ phiên xác thực.',
      'missing_uid'
    );
  }

  const profile = await repo.getUserProfile(uid);
  if (!profile) {
    throw new McpActorForbiddenError(
      'Tài khoản này chưa được cấp quyền truy cập dự án TBHGN.',
      'user_not_found'
    );
  }

  if (!profile.isActive) {
    throw new McpActorForbiddenError(
      'Tài khoản TBHGN của bạn hiện đang bị khóa hoặc chưa kích hoạt.',
      'user_inactive'
    );
  }

  return {
    uid: profile.uid,
    displayName: profile.displayName,
    role: profile.role,
    canApprove: profile.canApprove,
    isActive: true,
    authMethod,
    scopes: [...authInfo.scopes],
  };
}
