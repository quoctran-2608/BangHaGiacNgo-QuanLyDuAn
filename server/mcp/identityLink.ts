import fs from 'node:fs';
import path from 'node:path';
import type {
  McpOAuthConfig,
  McpOAuthIdentityLinkEntry,
} from './types.js';

export class McpIdentityLinkError extends Error {
  public readonly statusCode = 403;
  public readonly code: string;

  constructor(message: string, code = 'oauth_identity_not_linked') {
    super(message);
    this.name = 'McpIdentityLinkError';
    this.code = code;
  }
}

export interface OAuthIdentityLinker {
  /** Number of verified `(issuer, sub) -> firebaseUid` entries currently loaded */
  readonly mappingCount: number;
  /** Whether the configured identity linking mode has sufficient configuration to operate */
  readonly isConfigured: boolean;
  /**
   * Resolves a verified TBHGN Firebase UID strictly from cryptographically verified
   * OAuth token claims (`iss`, `sub`, and optional IdP-signed UID claim).
   *
   * NEVER uses email matching. NEVER trusts unverified client arguments.
   */
  resolveFirebaseUid(verifiedToken: {
    issuer: string;
    subject: string;
    claims: Record<string, unknown>;
  }): string;
}

const VALID_FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

export function isValidFirebaseUid(uid: unknown): uid is string {
  return (
    typeof uid === 'string' &&
    VALID_FIREBASE_UID_PATTERN.test(uid.trim())
  );
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

function makePairKey(issuer: string, subject: string): string {
  return `${normalizeIssuer(issuer)}\0${subject.trim()}`;
}

function assertSafeServerFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(filePath)) {
    throw new Error('MCP_OAUTH_UID_MAP_FILE must be an absolute path.');
  }
  const cwd = process.cwd();
  const forbiddenDirs = [
    path.resolve(cwd, 'dist'),
    path.resolve(cwd, 'public'),
    path.resolve(cwd, 'src'),
  ];
  for (const dir of forbiddenDirs) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) {
      throw new Error(
        'MCP_OAUTH_UID_MAP_FILE must not reside inside web-servable directories (dist/public/src).'
      );
    }
  }
  return resolved;
}

interface RawMappingDocument {
  version?: unknown;
  links?: unknown;
}

export function parseIdentityLinkEntries(
  rawJson: string
): Map<string, McpOAuthIdentityLinkEntry> {
  let parsed: RawMappingDocument;
  try {
    parsed = JSON.parse(rawJson) as RawMappingDocument;
  } catch {
    throw new Error('Invalid JSON in OAuth identity link map.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.links)) {
    throw new Error('OAuth identity link map must contain a "links" array.');
  }

  const byPair = new Map<string, McpOAuthIdentityLinkEntry>();
  for (const rawEntry of parsed.links) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const issuer =
      typeof entry.issuer === 'string' ? normalizeIssuer(entry.issuer) : '';
    const sub = typeof entry.sub === 'string' ? entry.sub.trim() : '';
    const firebaseUid =
      typeof entry.firebaseUid === 'string' ? entry.firebaseUid.trim() : '';
    const verifiedByAdmin = entry.verifiedByAdmin === true;

    if (!issuer || !sub || !isValidFirebaseUid(firebaseUid)) {
      throw new Error(
        'Invalid OAuth identity link entry (issuer, sub, or firebaseUid malformed).'
      );
    }
    // Only explicitly admin/owner-verified links are accepted
    if (!verifiedByAdmin) {
      continue;
    }

    const key = makePairKey(issuer, sub);
    if (byPair.has(key)) {
      throw new Error(
        'Duplicate (issuer, sub) entry detected in OAuth identity link map.'
      );
    }

    byPair.set(key, {
      issuer,
      sub,
      firebaseUid,
      verifiedByAdmin: true,
      linkedAt:
        typeof entry.linkedAt === 'string' ? entry.linkedAt : undefined,
    });
  }

  return byPair;
}

export function loadOAuthIdentityLinkMap(
  oauthConfig: Pick<McpOAuthConfig, 'uidMapFile' | 'uidMapJson'>
): Map<string, McpOAuthIdentityLinkEntry> {
  if (oauthConfig.uidMapJson?.trim()) {
    return parseIdentityLinkEntries(oauthConfig.uidMapJson);
  }
  if (oauthConfig.uidMapFile?.trim()) {
    const safePath = assertSafeServerFilePath(oauthConfig.uidMapFile.trim());
    if (!fs.existsSync(safePath)) {
      throw new Error(
        'OAuth identity link map file does not exist at configured path.'
      );
    }
    const content = fs.readFileSync(safePath, 'utf8');
    return parseIdentityLinkEntries(content);
  }
  return new Map();
}

/**
 * Builds a fail-closed OAuth Identity Linker bound to the configured OAuth policy.
 *
 * Modes:
 * - `mapping_file` (default): strictly matches verified `(iss, sub)` against an
 *   admin-verified server-side mapping file/JSON. Ignores any client/IdP `firebase_uid` claim.
 * - `idp_claim`: trusts the configured claim ONLY from the cryptographically verified JWT
 *   signed by `config.oauth.issuer` (never email, never request parameters).
 * - `both_strict`: requires BOTH server-side `(iss, sub)` mapping AND IdP-signed claim
 *   to exist and match the exact same Firebase UID.
 */
export function createOAuthIdentityLinker(
  oauthConfig: McpOAuthConfig | null
): OAuthIdentityLinker {
  if (!oauthConfig) {
    return {
      mappingCount: 0,
      isConfigured: false,
      resolveFirebaseUid() {
        throw new McpIdentityLinkError(
          'OAuth chưa được cấu hình trên máy chủ TBHGN MCP.',
          'oauth_not_configured'
        );
      },
    };
  }

  let linkMap = new Map<string, McpOAuthIdentityLinkEntry>();
  let mapLoadedOk = false;

  if (
    oauthConfig.identityLinkMode === 'mapping_file' ||
    oauthConfig.identityLinkMode === 'both_strict'
  ) {
    if (oauthConfig.uidMapFile || oauthConfig.uidMapJson) {
      try {
        linkMap = loadOAuthIdentityLinkMap(oauthConfig);
        mapLoadedOk = true;
      } catch {
        // Fail closed: keep map empty and mark unconfigured without crashing server startup
        linkMap = new Map();
        mapLoadedOk = false;
      }
    }
  }

  const isConfigured =
    oauthConfig.identityLinkMode === 'idp_claim'
      ? Boolean(oauthConfig.uidClaim)
      : mapLoadedOk && linkMap.size > 0;

  return {
    get mappingCount() {
      return linkMap.size;
    },
    get isConfigured() {
      return isConfigured;
    },
    resolveFirebaseUid({ issuer, subject, claims }): string {
      const normalizedIss = normalizeIssuer(issuer);
      const normalizedSub = subject.trim();

      if (!normalizedIss || !normalizedSub) {
        throw new McpIdentityLinkError(
          'Token OAuth thiếu định danh issuer hoặc subject hợp lệ.',
          'missing_oauth_subject'
        );
      }

      const expectedIssuer = normalizeIssuer(oauthConfig.issuer);
      if (normalizedIss !== expectedIssuer) {
        throw new McpIdentityLinkError(
          'Issuer của token không khớp cấu hình TBHGN.',
          'issuer_mismatch'
        );
      }

      const extractClaimUid = (): string | null => {
        const raw = claims[oauthConfig.uidClaim];
        if (!isValidFirebaseUid(raw)) return null;
        return raw.trim();
      };

      const lookupMappedUid = (): string | null => {
        const entry = linkMap.get(makePairKey(normalizedIss, normalizedSub));
        if (!entry || !entry.verifiedByAdmin) return null;
        return entry.firebaseUid;
      };

      if (oauthConfig.identityLinkMode === 'mapping_file') {
        const mappedUid = lookupMappedUid();
        if (!mappedUid) {
          throw new McpIdentityLinkError(
            'Tài khoản OAuth này chưa được liên kết xác minh với UID thành viên TBHGN.',
            'oauth_identity_not_linked'
          );
        }
        return mappedUid;
      }

      if (oauthConfig.identityLinkMode === 'idp_claim') {
        const claimUid = extractClaimUid();
        if (!claimUid) {
          throw new McpIdentityLinkError(
            'Access token không chứa claim liên kết Firebase UID hợp lệ từ IdP.',
            'oauth_uid_claim_missing'
          );
        }
        return claimUid;
      }

      // both_strict
      const mappedUid = lookupMappedUid();
      const claimUid = extractClaimUid();
      if (!mappedUid || !claimUid) {
        throw new McpIdentityLinkError(
          'Tài khoản OAuth chưa hoàn tất xác minh liên kết hai chiều với TBHGN.',
          'oauth_identity_not_linked'
        );
      }
      if (mappedUid !== claimUid) {
        throw new McpIdentityLinkError(
          'Liên kết UID giữa IdP và máy chủ TBHGN không khớp.',
          'oauth_identity_mismatch'
        );
      }
      return mappedUid;
    },
  };
}
