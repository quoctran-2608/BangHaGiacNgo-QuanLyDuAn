export type TaskStatus =
  | 'Đang làm'
  | 'Chờ duyệt'
  | 'Tạm dừng'
  | 'Hoàn thành'
  | 'Chưa bắt đầu';

export type TaskCategory =
  | 'Đề cương'
  | 'Nền tảng & quy chuẩn'
  | 'Truy nguồn & nghiên cứu'
  | string;

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export type UserRole = 'admin' | 'moderator' | 'member' | 'viewer';

export type ReviewFlag =
  | 'missing_assignee'
  | 'missing_status'
  | 'missing_hyperlink_url';

export interface DocumentLink {
  id: string;
  label: string;
  url: string | null;
  type: 'reference' | 'result' | 'google_drive_link';
  needsUrlExtraction?: boolean;
}

export interface TaskItem {
  /** Deterministic stable document ID independent of displayCode */
  id: string;
  /** Editable display code e.g. "1", "3.1", "4.5" */
  displayCode: string;
  /** Parent task stable ID, null for top-level parent tasks (max 2 levels in V1) */
  parentId: string | null;
  /** Ordering weight */
  sortOrder: number;
  title: string;
  /** Stable category document ID in /categories/{categoryId} */
  categoryId?: string | null;
  /** Display name fallback/cache */
  category: TaskCategory | null;
  /** Original alias labels preserved for display e.g. ["Quốc", "Khả Tuệ"] */
  assignees: string[];
  /** Approved member UIDs mapped by Admin (authoritative for permissions) */
  assigneeUids: string[];
  /** Optional approver UIDs scoped for approval actions */
  approverUids?: string[];
  /** Five workflow statuses, or null when unset in source (displayed as "Cần rà soát") */
  status: TaskStatus | null;
  nextStep: string | null;
  /** ISO date string YYYY-MM-DD or null */
  dueDate: string | null;
  lastCheckedAt?: string | null;
  /** ISO timestamp string or null before first edit */
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByUid?: string | null;
  /** Monotonic version for optimistic concurrency & conflict detection */
  version: number;
  referenceLinks: DocumentLink[];
  resultLinks: DocumentLink[];
  notes: string | null;
  /** Flags raised during source import for fields that must not be guessed */
  reviewFlags: ReviewFlag[];
  /** Soft archive fields (never hard delete in normal workflow) */
  archivedAt: string | null;
  archivedBy: string | null;
  migrationSourceRow?: number;
  isTestRecord?: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorUid: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  taskId: string;
  actorUid: string;
  actorName: string;
  action: 'create' | 'update' | 'status_change' | 'approve' | 'comment' | 'archive' | 'restore';
  summary: string;
  changes?: Record<string, { from: string; to: string }>;
  createdAt: string;
}

export interface ProjectMember {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  canApprove: boolean;
  isActive: boolean;
  /** Matches original alias used in the spreadsheet (e.g., "Khánh", "Quốc") */
  sheetAlias: string;
  createdAt: string;
  updatedAt?: string;
}

export interface MemberDirectoryEntry {
  uid: string;
  displayName: string;
  isActive: boolean;
  updatedAt?: string;
}

export type MemberDirectoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MemberDirectorySyncResult {
  totalUsers: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  directoryCount: number;
}

export interface MemberInvite {
  email: string;
  displayName: string;
  sheetAlias: string;
  role: UserRole;
  canApprove: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSettings {
  allowOpenGoogleLogin: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type AppRoute =
  | 'overview'
  | 'tasks'
  | 'my-tasks'
  | 'documents'
  | 'categories'
  | 'members'
  | 'admin-settings';
