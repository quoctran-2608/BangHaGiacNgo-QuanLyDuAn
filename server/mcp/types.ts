import type { CategoryItem, TaskItem, UserRole } from '../../src/types/project.js';

export type McpAuthMethod = 'firebase_id_token' | 'oauth_jwt';

export const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set([
  'admin',
  'moderator',
  'member',
  'viewer',
]);

export function isValidUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    VALID_USER_ROLES.has(value as UserRole)
  );
}

/**
 * Minimal user profile loaded from `/users/{uid}` for MCP authorization.
 * Intentionally omits PII such as `email` and `sheetAlias` so tool handlers
 * cannot leak personal information to external AI models.
 */
export interface McpUserRecord {
  uid: string;
  displayName: string;
  role: UserRole;
  canApprove: boolean;
  isActive: boolean;
}

/**
 * Verified active TBHGN member bound to a single MCP request.
 * Derived strictly from cryptographic token verification + live `/users/{uid}` check.
 */
export interface McpAuthenticatedActor {
  uid: string;
  displayName: string;
  role: UserRole;
  canApprove: boolean;
  isActive: true;
  authMethod: McpAuthMethod;
  scopes: string[];
}

/**
 * Non-PII official member directory entry used to resolve assignee names by UID.
 */
export interface McpMemberDirectoryItem {
  uid: string;
  displayName: string;
  isActive: boolean;
}

/**
 * Strictly READ-ONLY repository contract for MCP Server V1.0.
 * Contains ZERO write, update, approve, archive, or delete operations.
 */
export interface McpReadRepository {
  getUserProfile(uid: string): Promise<McpUserRecord | null>;
  listTasks(): Promise<TaskItem[]>;
  listCategories(): Promise<CategoryItem[]>;
  listMemberDirectory(actorRole: UserRole): Promise<McpMemberDirectoryItem[]>;
}

export interface McpAuditEntry {
  timestamp: string;
  uid: string;
  role: UserRole;
  tool: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string;
}

export interface McpOAuthConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  requiredScope: string;
  uidClaim: string;
}

export interface McpConfig {
  enabled: boolean;
  publicUrl: URL;
  resourceName: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowFirebaseIdToken: boolean;
  requiredScope: string;
  oauth: McpOAuthConfig | null;
  rateLimitPerMinute: number;
  toolTimeoutMs: number;
  maxBodyBytes: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
}

export function encodePaginationCursor(offset: number): string {
  const safeOffset = Math.max(0, Math.floor(offset));
  const payload = JSON.stringify({ o: safeOffset });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodePaginationCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  if (cursor.length > 128) {
    throw new Error('Cursor phân trang không hợp lệ.');
  }
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { o?: unknown };
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.o !== 'number' ||
      !Number.isInteger(parsed.o) ||
      parsed.o < 0 ||
      parsed.o > 100_000
    ) {
      throw new Error('Invalid cursor offset');
    }
    return parsed.o;
  } catch {
    throw new Error('Cursor phân trang không hợp lệ.');
  }
}
