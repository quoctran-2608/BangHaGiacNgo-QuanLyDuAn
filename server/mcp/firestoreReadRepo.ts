import type {
  CategoryItem,
  DocumentLink,
  ReviewFlag,
  TaskCategory,
  TaskItem,
  TaskStatus,
  UserRole,
} from '../../src/types/project.js';
import {
  isValidUserRole,
  type McpMemberDirectoryItem,
  type McpReadRepository,
  type McpUserRecord,
} from './types.js';

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null | 'NULL_VALUE';
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreListResponse {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
}

const VALID_REVIEW_FLAGS: ReadonlySet<string> = new Set([
  'missing_assignee',
  'missing_status',
  'missing_hyperlink_url',
]);

const VALID_TASK_STATUSES: ReadonlySet<string> = new Set([
  'Đang làm',
  'Chờ duyệt',
  'Tạm dừng',
  'Hoàn thành',
  'Chưa bắt đầu',
]);

const MAX_LIST_PAGES = 20;
const FIRESTORE_FETCH_TIMEOUT_MS = 10_000;

export function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue ?? '';
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue ?? null;
  if ('arrayValue' in value) {
    const arr = value.arrayValue?.values ?? [];
    return arr.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    const fields = value.mapValue?.fields ?? {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function decodeFirestoreFields(
  fields: Record<string, FirestoreValue> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

function extractDocumentId(name: string | undefined): string {
  if (!name) return '';
  const parts = name.split('/');
  return parts[parts.length - 1] ?? '';
}

function sanitizeDocumentLinks(
  raw: unknown,
  fallbackType: 'reference' | 'result'
): DocumentLink[] {
  if (!Array.isArray(raw)) return [];
  const results: DocumentLink[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawType = obj.type;
    const type: DocumentLink['type'] =
      rawType === 'reference' ||
      rawType === 'result' ||
      rawType === 'google_drive_link'
        ? rawType
        : fallbackType;
    results.push({
      id: typeof obj.id === 'string' && obj.id ? obj.id : `${fallbackType}_${i}`,
      label: typeof obj.label === 'string' ? obj.label : '',
      url: typeof obj.url === 'string' ? obj.url : null,
      type,
      needsUrlExtraction:
        typeof obj.needsUrlExtraction === 'boolean'
          ? obj.needsUrlExtraction
          : undefined,
    });
  }
  return results;
}

function mapRestTaskDoc(id: string, data: Record<string, unknown>): TaskItem {
  const rawStatus = typeof data.status === 'string' ? data.status : null;
  const status: TaskStatus | null =
    rawStatus && VALID_TASK_STATUSES.has(rawStatus)
      ? (rawStatus as TaskStatus)
      : null;

  const reviewFlags: ReviewFlag[] = Array.isArray(data.reviewFlags)
    ? data.reviewFlags.filter(
        (flag): flag is ReviewFlag =>
          typeof flag === 'string' && VALID_REVIEW_FLAGS.has(flag)
      )
    : [];

  return {
    id,
    displayCode: String(data.displayCode ?? ''),
    parentId: typeof data.parentId === 'string' ? data.parentId : null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    title: String(data.title ?? ''),
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
    category:
      typeof data.category === 'string' ? (data.category as TaskCategory) : null,
    assignees: Array.isArray(data.assignees)
      ? data.assignees.filter((v): v is string => typeof v === 'string')
      : [],
    assigneeUids: Array.isArray(data.assigneeUids)
      ? data.assigneeUids.filter((v): v is string => typeof v === 'string')
      : [],
    approverUids: Array.isArray(data.approverUids)
      ? data.approverUids.filter((v): v is string => typeof v === 'string')
      : undefined,
    status,
    nextStep: typeof data.nextStep === 'string' ? data.nextStep : null,
    dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    referenceLinks: sanitizeDocumentLinks(data.referenceLinks, 'reference'),
    resultLinks: sanitizeDocumentLinks(data.resultLinks, 'result'),
    reviewFlags,
    version: typeof data.version === 'number' ? data.version : 1,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    updatedByUid:
      typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
    archivedAt: typeof data.archivedAt === 'string' ? data.archivedAt : null,
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : null,
    isTestRecord: Boolean(data.isTestRecord),
  };
}

function mapRestCategoryDoc(
  id: string,
  data: Record<string, unknown>
): CategoryItem {
  return {
    id,
    name: String(data.name ?? ''),
    color: typeof data.color === 'string' ? data.color : '#13294B',
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    isActive: data.isActive !== false,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
}

function mapRestUserRecord(
  uid: string,
  data: Record<string, unknown>
): McpUserRecord | null {
  if (!isValidUserRole(data.role)) return null;
  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim()
      : 'Thành viên';
  return {
    uid,
    displayName,
    role: data.role,
    canApprove: Boolean(data.canApprove),
    isActive: data.isActive === true,
  };
}

function mapRestMemberDirectoryDoc(
  uid: string,
  data: Record<string, unknown>
): McpMemberDirectoryItem {
  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim()
      : 'Thành viên';
  return {
    uid,
    displayName,
    isActive: data.isActive !== false,
  };
}

export interface FirestoreRestRepoOptions {
  projectId: string;
  databaseId: string;
  /** Verified Bearer token forwarded to Firestore REST API v1 */
  bearerToken: string;
  timeoutMs?: number;
  /** Strictly for non-production automated tests targeting a local mock Firestore server */
  apiBaseUrlOverride?: string;
}

function resolveFirestoreApiBase(override?: string): string {
  const official = 'https://firestore.googleapis.com/v1';
  if (!override || process.env.NODE_ENV === 'production') {
    return official;
  }
  const parsed = new URL(override);
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  ) {
    return override.replace(/\/+$/, '');
  }
  throw new Error('apiBaseUrlOverride is only permitted for local loopback tests.');
}

/**
 * Strictly READ-ONLY Firestore REST API v1 repository.
 * Uses HTTP GET exclusively and targets the exact TBHGN named database.
 */
export function createFirestoreReadRepository(
  options: FirestoreRestRepoOptions
): McpReadRepository {
  const apiBase = resolveFirestoreApiBase(options.apiBaseUrlOverride);
  const baseUrl = `${apiBase}/projects/${encodeURIComponent(
    options.projectId
  )}/databases/${encodeURIComponent(options.databaseId)}/documents`;
  const timeoutMs = options.timeoutMs ?? FIRESTORE_FETCH_TIMEOUT_MS;

  async function firestoreGetJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.bearerToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Firestore read failed (${response.status})`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function listCollectionDocs(
    collectionName: 'tasks' | 'categories' | 'memberDirectory' | 'users'
  ): Promise<FirestoreDocument[]> {
    const docs: FirestoreDocument[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url = new URL(`${baseUrl}/${encodeURIComponent(collectionName)}`);
      url.searchParams.set('pageSize', '300');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }
      const data = await firestoreGetJson<FirestoreListResponse>(
        url.toString()
      );
      if (!data) break;
      if (Array.isArray(data.documents)) {
        docs.push(...data.documents);
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return docs;
  }

  return {
    async getUserProfile(uid: string): Promise<McpUserRecord | null> {
      const trimmedUid = uid.trim();
      if (!trimmedUid || trimmedUid.includes('/') || trimmedUid.includes('..')) {
        return null;
      }
      const url = `${baseUrl}/users/${encodeURIComponent(trimmedUid)}`;
      const doc = await firestoreGetJson<FirestoreDocument>(url);
      if (!doc || !doc.fields) return null;
      return mapRestUserRecord(trimmedUid, decodeFirestoreFields(doc.fields));
    },

    async listTasks(): Promise<TaskItem[]> {
      const docs = await listCollectionDocs('tasks');
      return docs.map((doc) =>
        mapRestTaskDoc(
          extractDocumentId(doc.name),
          decodeFirestoreFields(doc.fields)
        )
      );
    },

    async listCategories(): Promise<CategoryItem[]> {
      const docs = await listCollectionDocs('categories');
      return docs
        .map((doc) =>
          mapRestCategoryDoc(
            extractDocumentId(doc.name),
            decodeFirestoreFields(doc.fields)
          )
        )
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async listMemberDirectory(
      actorRole: UserRole
    ): Promise<McpMemberDirectoryItem[]> {
      // Member and Viewer strictly read /memberDirectory (zero access to /users)
      if (actorRole === 'member' || actorRole === 'viewer') {
        const docs = await listCollectionDocs('memberDirectory');
        return docs.map((doc) =>
          mapRestMemberDirectoryDoc(
            extractDocumentId(doc.name),
            decodeFirestoreFields(doc.fields)
          )
        );
      }

      // Admin and Moderator may read /users and immediately strip PII (email, sheetAlias)
      try {
        const userDocs = await listCollectionDocs('users');
        const byUid = new Map<string, McpMemberDirectoryItem>();
        for (const doc of userDocs) {
          const uid = extractDocumentId(doc.name);
          const fields = decodeFirestoreFields(doc.fields);
          const displayName =
            typeof fields.displayName === 'string' && fields.displayName.trim()
              ? fields.displayName.trim()
              : 'Thành viên';
          byUid.set(uid, {
            uid,
            displayName,
            isActive: fields.isActive === true,
          });
        }
        return Array.from(byUid.values());
      } catch {
        // Fallback safely to /memberDirectory if /users list fails
        const docs = await listCollectionDocs('memberDirectory');
        return docs.map((doc) =>
          mapRestMemberDirectoryDoc(
            extractDocumentId(doc.name),
            decodeFirestoreFields(doc.fields)
          )
        );
      }
    },
  };
}

export interface InMemoryMcpFixture {
  users: McpUserRecord[];
  tasks: TaskItem[];
  categories: CategoryItem[];
  memberDirectory?: McpMemberDirectoryItem[];
}

/**
 * Strictly READ-ONLY in-memory repository for automated unit & integration tests.
 */
export function createInMemoryMcpRepository(
  fixture: InMemoryMcpFixture
): McpReadRepository {
  const userMap = new Map(fixture.users.map((u) => [u.uid, u]));
  const directory: McpMemberDirectoryItem[] =
    fixture.memberDirectory ??
    fixture.users.map((u) => ({
      uid: u.uid,
      displayName: u.displayName,
      isActive: u.isActive,
    }));

  return {
    async getUserProfile(uid: string): Promise<McpUserRecord | null> {
      const found = userMap.get(uid);
      return found ? { ...found } : null;
    },
    async listTasks(): Promise<TaskItem[]> {
      return fixture.tasks.map((t) => ({
        ...t,
        assignees: [...t.assignees],
        assigneeUids: [...t.assigneeUids],
        approverUids: t.approverUids ? [...t.approverUids] : undefined,
        referenceLinks: t.referenceLinks.map((l) => ({ ...l })),
        resultLinks: t.resultLinks.map((l) => ({ ...l })),
        reviewFlags: [...t.reviewFlags],
      }));
    },
    async listCategories(): Promise<CategoryItem[]> {
      return fixture.categories.map((c) => ({ ...c }));
    },
    async listMemberDirectory(
      actorRole: UserRole
    ): Promise<McpMemberDirectoryItem[]> {
      if (actorRole === 'member' || actorRole === 'viewer') {
        return directory.map((d) => ({ ...d }));
      }
      return fixture.users.map((u) => ({
        uid: u.uid,
        displayName: u.displayName,
        isActive: u.isActive,
      }));
    },
  };
}
