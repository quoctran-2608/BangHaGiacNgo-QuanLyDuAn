import {
  CategoryItem,
  DocumentLink,
  ProjectMember,
  ReviewFlag,
  TaskItem,
  TaskStatus,
} from '../types/project';

export interface StatusStyleMeta {
  label: string;
  bg: string;
  text: string;
  border: string;
}

/** Strictly the 5 core workflow statuses */
export const ALL_STATUSES: TaskStatus[] = [
  'Đang làm',
  'Chờ duyệt',
  'Tạm dừng',
  'Hoàn thành',
  'Chưa bắt đầu',
];

export const STATUS_META: Record<TaskStatus, StatusStyleMeta> = {
  'Đang làm': {
    label: 'Đang làm',
    bg: '#BDD7EE',
    text: '#103A5C',
    border: '#9CC2E5',
  },
  'Chờ duyệt': {
    label: 'Chờ duyệt',
    bg: '#FFE699',
    text: '#5C4300',
    border: '#E8C868',
  },
  'Tạm dừng': {
    label: 'Tạm dừng',
    bg: '#FFC7CE',
    text: '#6B111C',
    border: '#F0A4AE',
  },
  'Hoàn thành': {
    label: 'Hoàn thành',
    bg: '#A9D08E',
    text: '#1E4612',
    border: '#8BBC6B',
  },
  'Chưa bắt đầu': {
    label: 'Chưa bắt đầu',
    bg: '#EDEDED',
    text: '#404040',
    border: '#D4D4D4',
  },
};

/** Display-only warning badge style when source task.status is null */
export const UNSET_STATUS_META: StatusStyleMeta = {
  label: 'Thiếu trạng thái',
  bg: '#FFF8E7',
  text: '#7C4D00',
  border: '#D9A84E',
};

export function getStatusMeta(status: TaskStatus | null): StatusStyleMeta {
  if (!status) return UNSET_STATUS_META;
  return STATUS_META[status] ?? UNSET_STATUS_META;
}

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  missing_assignee: 'Thiếu người phụ trách',
  missing_status: 'Thiếu trạng thái (null)',
  missing_hyperlink_url: 'Thiếu URL thực',
};

export interface TaskDataReviewSummary {
  isMissingStatus: boolean;
  /** Deduplicated data-quality flags not already represented by the Thiếu trạng thái badge */
  dataFlags: ReviewFlag[];
  /** Human-readable reasons for dataFlags */
  dataFlagLabels: string[];
  /** True when status is null or any reviewFlag is present */
  hasAnyIssue: boolean;
}

/**
 * Separates workflow status === null ("Thiếu trạng thái") from data-quality reviewFlags
 * ("Cần rà soát dữ liệu") so the UI never duplicates two warning badges for one cause.
 */
export function getTaskDataReviewSummary(
  task: Pick<TaskItem, 'status' | 'reviewFlags'>
): TaskDataReviewSummary {
  const isMissingStatus = task.status === null;
  const rawFlags = Array.isArray(task.reviewFlags) ? task.reviewFlags : [];
  const uniqueFlags = Array.from(new Set(rawFlags));
  const dataFlags = uniqueFlags.filter(
    (flag) => !(isMissingStatus && flag === 'missing_status')
  );
  const dataFlagLabels = dataFlags.map(
    (flag) => REVIEW_FLAG_LABELS[flag] ?? flag
  );

  return {
    isMissingStatus,
    dataFlags,
    dataFlagLabels,
    hasAnyIssue: isMissingStatus || dataFlags.length > 0,
  };
}

export interface CategoryVisualTheme {
  accent: string;
  text: string;
  softBg: string;
  softBorder: string;
}

export function getCategoryVisualTheme(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  fallbackColor?: string
): CategoryVisualTheme {
  const nameKey = (categoryName ?? '').trim().toLowerCase();
  if (categoryId === 'cat_outline' || nameKey.includes('đề cương')) {
    return {
      accent: '#477FAE',
      text: '#23527A',
      softBg: '#EFF6FB',
      softBorder: '#C7DDF0',
    };
  }
  if (categoryId === 'cat_foundation' || nameKey.includes('nền tảng')) {
    return {
      accent: '#328578',
      text: '#1D5950',
      softBg: '#ECF6F3',
      softBorder: '#BEE0D8',
    };
  }
  if (categoryId === 'cat_research' || nameKey.includes('truy nguồn')) {
    return {
      accent: '#C9A14B',
      text: '#7A5410',
      softBg: '#FCF7EA',
      softBorder: '#E5D1A0',
    };
  }
  if (!nameKey || nameKey === 'chưa phân hạng mục') {
    return {
      accent: '#8D95A3',
      text: '#586272',
      softBg: '#F4F1EA',
      softBorder: '#DFD8CA',
    };
  }
  return {
    accent: fallbackColor || '#477FAE',
    text: '#14243F',
    softBg: '#F5F2EA',
    softBorder: '#DFD8C8',
  };
}

export function computeParentProgress(
  parentId: string,
  tasks: TaskItem[]
): { completed: number; total: number; percentage: number } {
  const children = tasks.filter(
    (t) => t.parentId === parentId && !t.archivedAt
  );
  const total = children.length;
  const completed = children.filter((c) => c.status === 'Hoàn thành').length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percentage };
}

export function isTaskOverdue(task: TaskItem, referenceDate?: Date): boolean {
  if (!task.dueDate || task.status === 'Hoàn thành' || task.archivedAt) {
    return false;
  }
  const now = referenceDate ? new Date(referenceDate) : new Date();
  const todayStr = now.toISOString().slice(0, 10);
  return task.dueDate < todayStr;
}

/**
 * Enforces max 2 levels and prevents circular parent-child relationships.
 */
export function canBeParent(
  candidateParentId: string | null,
  targetTaskId: string | null,
  tasks: TaskItem[]
): { ok: boolean; reason?: string } {
  if (!candidateParentId) {
    return { ok: true };
  }
  if (targetTaskId && candidateParentId === targetTaskId) {
    return { ok: false, reason: 'Không thể chọn chính công việc này làm việc cha.' };
  }
  const parent = tasks.find((t) => t.id === candidateParentId);
  if (!parent) {
    return { ok: false, reason: 'Không tìm thấy công việc cha.' };
  }
  if (parent.parentId !== null) {
    return {
      ok: false,
      reason: 'V1 chỉ hỗ trợ tối đa 2 cấp (việc con không thể có việc con).',
    };
  }
  if (parent.archivedAt) {
    return {
      ok: false,
      reason: 'Không thể thêm việc con vào nhóm đã lưu trữ.',
    };
  }
  if (targetTaskId) {
    const targetHasChildren = tasks.some(
      (t) => t.parentId === targetTaskId && !t.archivedAt
    );
    if (targetHasChildren) {
      return {
        ok: false,
        reason: 'Công việc đang có việc con, không thể chuyển thành việc con của nhóm khác.',
      };
    }
  }
  return { ok: true };
}

export function getEffectiveCategory(
  task: TaskItem,
  tasks: TaskItem[],
  categories: CategoryItem[] = []
): {
  categoryId: string | null;
  category: string;
  color?: string;
  isActive?: boolean;
  inherited: boolean;
} {
  const resolveByIdOrName = (
    catId: string | null | undefined,
    catName: string | null | undefined,
    inherited: boolean
  ) => {
    if (catId) {
      const matched = categories.find((c) => c.id === catId);
      if (matched) {
        return {
          categoryId: matched.id,
          category: matched.name,
          color: matched.color,
          isActive: matched.isActive,
          inherited,
        };
      }
      return {
        categoryId: catId,
        category: catName || catId,
        inherited,
      };
    }
    if (catName) {
      const matched = categories.find(
        (c) => c.name.toLowerCase() === catName.toLowerCase()
      );
      return {
        categoryId: matched?.id ?? null,
        category: matched?.name ?? catName,
        color: matched?.color,
        isActive: matched?.isActive,
        inherited,
      };
    }
    return null;
  };

  const own = resolveByIdOrName(task.categoryId, task.category, false);
  if (own) return own;

  if (task.parentId) {
    const parent = tasks.find((t) => t.id === task.parentId);
    if (parent) {
      const fromParent = resolveByIdOrName(
        parent.categoryId,
        parent.category,
        true
      );
      if (fromParent) return fromParent;
    }
  }

  return { categoryId: null, category: '', inherited: false };
}

export function isTaskManagerRole(member: ProjectMember): boolean {
  return (
    member.isActive &&
    (member.role === 'admin' || member.role === 'moderator')
  );
}

/**
 * Strictly UID-based task edit check (never uses text display names for permissions).
 */
export function canUserEditTask(
  member: ProjectMember,
  task: TaskItem
): boolean {
  if (!member.isActive) return false;
  if (isTaskManagerRole(member)) return true;
  if (member.role === 'viewer') return false;
  return task.assigneeUids.includes(member.uid);
}

/**
 * Checks if user can create a child task under a given parent task.
 */
export function canUserCreateSubtaskInParent(
  member: ProjectMember,
  parentTask: TaskItem
): boolean {
  if (!member.isActive || parentTask.parentId !== null || parentTask.archivedAt) {
    return false;
  }
  if (isTaskManagerRole(member)) return true;
  if (member.role === 'member') {
    return parentTask.assigneeUids.includes(member.uid);
  }
  return false;
}

export function canUserApproveTask(
  member: ProjectMember,
  task?: TaskItem
): boolean {
  if (!member.isActive) return false;
  if (isTaskManagerRole(member)) return true;
  if (!member.canApprove) return false;
  if (!task) return true;
  return (
    canUserEditTask(member, task) ||
    (task.approverUids?.includes(member.uid) ?? false)
  );
}

export function canUserCreateSubtask(member: ProjectMember): boolean {
  return (
    member.isActive &&
    (member.role === 'admin' ||
      member.role === 'moderator' ||
      member.role === 'member')
  );
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Chưa có cập nhật';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function isB1TestTask(
  task: Pick<TaskItem, 'id' | 'isTestRecord'>
): boolean {
  if (task.id.startsWith('tbhgn_')) return false;
  return (
    Boolean(task.isTestRecord) ||
    task.id.startsWith('b1_test_') ||
    task.id.startsWith('test_task_')
  );
}

export interface ResolvedAssigneeMember {
  uid: string;
  displayName: string;
  isActive: boolean;
}

export interface ResolvedTaskAssignees {
  assignedMembers: ResolvedAssigneeMember[];
  unknownUidCount: number;
  isCollectiveGroup: boolean;
  isUnlinkedAccount: boolean;
  isUnassigned: boolean;
  labels: string[];
  displayText: string;
  searchText: string;
}

/**
 * Single authoritative Project Display Name source for daily UI.
 * Reads `/users/{uid}.displayName` directly (falls back to email local-part only if empty).
 */
export function getOfficialMemberDisplayName(
  member: Pick<ProjectMember, 'displayName' | 'email'>
): string {
  const dn = (member.displayName ?? '').trim();
  if (dn) return dn;
  const prefix = (member.email ?? '').split('@')[0]?.trim();
  return prefix || 'Thành viên';
}

/**
 * Resolves task assignees strictly from `task.assigneeUids` matched against loaded project members.
 * Never surfaces legacy spreadsheet names (`task.assignees` personal aliases) or raw UIDs in daily UI.
 * Collective `"Nhóm"` tags render distinctly as `Việc nhóm`.
 */
export function resolveTaskAssignees(
  task: Pick<TaskItem, 'assigneeUids' | 'assignees'>,
  members: Array<
    Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>
  > = []
): ResolvedTaskAssignees {
  const uniqueUids = Array.from(
    new Set((task.assigneeUids ?? []).filter(Boolean))
  );
  const rawAssignees = (task.assignees ?? [])
    .map((a) => a.trim())
    .filter(Boolean);

  const isCollectiveGroup = rawAssignees.some(
    (a) => a.toLowerCase() === 'nhóm'
  );
  const hasLegacyPersonalAlias = rawAssignees.some(
    (a) => a.toLowerCase() !== 'nhóm'
  );

  const memberByUid = new Map(members.map((m) => [m.uid, m]));
  const assignedMembers: ResolvedAssigneeMember[] = [];
  let unknownUidCount = 0;

  for (const uid of uniqueUids) {
    const m = memberByUid.get(uid);
    if (m) {
      assignedMembers.push({
        uid: m.uid,
        displayName: getOfficialMemberDisplayName(m),
        isActive: m.isActive,
      });
    } else {
      unknownUidCount++;
    }
  }

  const isUnlinkedAccount = uniqueUids.length === 0 && hasLegacyPersonalAlias;
  const isUnassigned =
    uniqueUids.length === 0 && !hasLegacyPersonalAlias && !isCollectiveGroup;

  const labels: string[] = [];
  for (const am of assignedMembers) {
    labels.push(am.isActive ? am.displayName : `${am.displayName} (Đã khóa)`);
  }
  if (unknownUidCount > 0) {
    labels.push(
      unknownUidCount === 1
        ? 'Tài khoản không xác định'
        : `Tài khoản không xác định (${unknownUidCount})`
    );
  }
  if (isUnlinkedAccount) {
    labels.push('Chưa liên kết tài khoản');
  }
  if (isCollectiveGroup) {
    labels.push('Việc nhóm');
  }
  if (labels.length === 0) {
    labels.push('Chưa phân công');
  }

  const displayText = labels.join(', ');
  const searchText = [
    ...assignedMembers.map((am) => am.displayName),
    isCollectiveGroup ? 'Việc nhóm Nhóm' : '',
    isUnlinkedAccount ? 'Chưa liên kết tài khoản' : '',
    isUnassigned ? 'Chưa phân công' : '',
    unknownUidCount > 0 ? 'Tài khoản không xác định' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    assignedMembers,
    unknownUidCount,
    isCollectiveGroup,
    isUnlinkedAccount,
    isUnassigned,
    labels,
    displayText,
    searchText,
  };
}

export const MAX_LINKS_PER_GROUP = 20;

const GENERIC_DOCUMENT_LABELS = new Set([
  '',
  'mở tài liệu',
  'tài liệu',
  'link',
  'url',
  'tài liệu chưa đặt tên',
]);

export function isGenericDocumentLabel(
  label: string | null | undefined
): boolean {
  const normalized = (label ?? '').trim().toLowerCase();
  return GENERIC_DOCUMENT_LABELS.has(normalized);
}

export function getDocumentDisplayLabel(
  link: Pick<DocumentLink, 'label'>
): { text: string; isPlaceholder: boolean } {
  const trimmed = (link.label ?? '').trim();
  if (isGenericDocumentLabel(trimmed)) {
    return { text: 'Tài liệu chưa đặt tên', isPlaceholder: true };
  }
  return { text: trimmed, isPlaceholder: false };
}

export function getDocumentSourceLabel(
  url: string | null | undefined
): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return 'Chưa gắn đường dẫn';
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    if (host === 'docs.google.com') {
      if (path.startsWith('/document')) return 'Google Docs';
      if (path.startsWith('/spreadsheets')) return 'Google Sheets';
      if (path.startsWith('/presentation')) return 'Google Slides';
      if (path.startsWith('/forms')) return 'Google Forms';
      return 'Google Docs';
    }
    if (host === 'drive.google.com') {
      return 'Google Drive';
    }
    return host || 'Liên kết ngoài';
  } catch {
    return 'Liên kết ngoài';
  }
}

export function validateHttpUrl(
  rawUrl: string
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'Vui lòng nhập đường dẫn (URL).' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: 'Đường dẫn phải bắt đầu bằng http:// hoặc https://.',
      };
    }
    if (
      !parsed.hostname ||
      (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')
    ) {
      return { ok: false, error: 'Tên miền trong đường dẫn không hợp lệ.' };
    }
    return { ok: true, normalizedUrl: trimmed };
  } catch {
    return {
      ok: false,
      error: 'Đường dẫn chưa đúng định dạng URL (ví dụ: https://drive.google.com/...).',
    };
  }
}

export function normalizeLinkUrlForComparison(
  url: string | null | undefined
): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function hasDuplicateUrlInGroup(
  links: DocumentLink[],
  candidateUrl: string | null | undefined,
  excludeLinkId?: string
): boolean {
  const target = normalizeLinkUrlForComparison(candidateUrl);
  if (!target) return false;
  return links.some(
    (l) =>
      l.id !== excludeLinkId &&
      normalizeLinkUrlForComparison(l.url) === target
  );
}

export type DocumentLinkGroup = 'reference' | 'result';

export type DocumentReviewReason =
  | 'missing_label'
  | 'missing_url'
  | 'invalid_url';

export interface ProjectDocumentOccurrence {
  key: string;
  taskId: string;
  linkId: string;
  taskCode: string;
  taskTitle: string;
  group: DocumentLinkGroup;
}

export type ProjectDocumentAssigneeStatusKind =
  | 'named'
  | 'collective'
  | 'unlinked'
  | 'unknown_account'
  | 'unassigned';

export interface ProjectDocumentEntry {
  key: string;
  taskId: string;
  linkId: string;
  group: DocumentLinkGroup;
  link: DocumentLink;
  displayLabel: string;
  isPlaceholderLabel: boolean;
  sourceLabel: string;
  hasValidUrl: boolean;
  isMissingUrl: boolean;
  isInvalidUrl: boolean;
  needsReview: boolean;
  reviewReasons: DocumentReviewReason[];
  taskPendingApproval: boolean;
  taskNeedsReview: boolean;
  needsAttention: boolean;
  normalizedUrl: string;
  duplicateOccurrences: ProjectDocumentOccurrence[];
  taskCode: string;
  taskTitle: string;
  taskStatus: TaskItem['status'];
  taskVersion: number;
  categoryId: string | null;
  categoryName: string;
  categoryColor?: string;
  assigneeNamesText: string;
  assigneeSearchText: string;
  officialAssigneeText: string | null;
  assigneeStatusKind: ProjectDocumentAssigneeStatusKind;
  neutralAssigneeHint: string | null;
  task: TaskItem;
}

export interface ProjectDocumentsSummary {
  entries: ProjectDocumentEntry[];
  totalLinks: number;
  referenceCount: number;
  resultCount: number;
  reviewNeededCount: number;
  attentionNeededCount: number;
  uniqueValidUrlCount: number;
  validUrlLinkCount: number;
  duplicateEntryCount: number;
  duplicateCrossTaskUrlCount: number;
}

export function buildProjectDocumentEntries(
  tasks: TaskItem[],
  categories: CategoryItem[] = [],
  members: Array<
    Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>
  > = []
): ProjectDocumentsSummary {
  const activeTasks = tasks
    .filter((t) => !t.archivedAt && !isB1TestTask(t))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rawEntries: ProjectDocumentEntry[] = [];
  const occurrencesByUrl = new Map<string, ProjectDocumentOccurrence[]>();

  for (const task of activeTasks) {
    const effCat = getEffectiveCategory(task, activeTasks, categories);
    const resolvedAssignees = resolveTaskAssignees(task, members);
    const taskPendingApproval = task.status === 'Chờ duyệt';
    const taskNeedsReview =
      task.status === null || (task.reviewFlags?.length ?? 0) > 0;

    const officialParts: string[] = resolvedAssignees.assignedMembers.map(
      (am) => (am.isActive ? am.displayName : `${am.displayName} (Đã khóa)`)
    );
    if (resolvedAssignees.isCollectiveGroup) {
      officialParts.push('Việc nhóm');
    }
    const officialAssigneeText =
      officialParts.length > 0 ? officialParts.join(', ') : null;

    let assigneeStatusKind: ProjectDocumentAssigneeStatusKind = 'unassigned';
    let neutralAssigneeHint: string | null = 'Chưa phân công';

    if (resolvedAssignees.assignedMembers.length > 0) {
      assigneeStatusKind = 'named';
      neutralAssigneeHint = null;
    } else if (resolvedAssignees.isCollectiveGroup) {
      assigneeStatusKind = 'collective';
      neutralAssigneeHint = null;
    } else if (resolvedAssignees.unknownUidCount > 0) {
      assigneeStatusKind = 'unknown_account';
      neutralAssigneeHint = 'TK chưa xác định';
    } else if (resolvedAssignees.isUnlinkedAccount) {
      assigneeStatusKind = 'unlinked';
      neutralAssigneeHint = 'Chưa liên kết TK';
    }

    const groups: Array<{ group: DocumentLinkGroup; links: DocumentLink[] }> = [
      { group: 'reference', links: task.referenceLinks ?? [] },
      { group: 'result', links: task.resultLinks ?? [] },
    ];

    for (const { group, links } of groups) {
      for (const link of links) {
        const key = `${task.id}:${group}:${link.id}`;
        const labelInfo = getDocumentDisplayLabel(link);
        const trimmedUrl = (link.url ?? '').trim();
        const isMissingUrl = trimmedUrl === '';
        const urlCheck = isMissingUrl ? null : validateHttpUrl(trimmedUrl);
        const hasValidUrl = Boolean(urlCheck && urlCheck.ok);
        const isInvalidUrl = !isMissingUrl && !hasValidUrl;

        const reviewReasons: DocumentReviewReason[] = [];
        if (labelInfo.isPlaceholder) reviewReasons.push('missing_label');
        if (isMissingUrl) reviewReasons.push('missing_url');
        if (isInvalidUrl) reviewReasons.push('invalid_url');

        const needsReview = reviewReasons.length > 0;
        const needsAttention =
          needsReview || taskPendingApproval || taskNeedsReview;

        const normalizedUrl = hasValidUrl
          ? normalizeLinkUrlForComparison(trimmedUrl)
          : '';

        if (normalizedUrl) {
          const list = occurrencesByUrl.get(normalizedUrl) ?? [];
          list.push({
            key,
            taskId: task.id,
            linkId: link.id,
            taskCode: task.displayCode,
            taskTitle: task.title,
            group,
          });
          occurrencesByUrl.set(normalizedUrl, list);
        }

        rawEntries.push({
          key,
          taskId: task.id,
          linkId: link.id,
          group,
          link,
          displayLabel: labelInfo.text,
          isPlaceholderLabel: labelInfo.isPlaceholder,
          sourceLabel: getDocumentSourceLabel(link.url),
          hasValidUrl,
          isMissingUrl,
          isInvalidUrl,
          needsReview,
          reviewReasons,
          taskPendingApproval,
          taskNeedsReview,
          needsAttention,
          normalizedUrl,
          duplicateOccurrences: [],
          taskCode: task.displayCode,
          taskTitle: task.title,
          taskStatus: task.status,
          taskVersion: task.version,
          categoryId: effCat.categoryId,
          categoryName: effCat.category || 'Chưa phân hạng mục',
          categoryColor: effCat.color,
          assigneeNamesText: resolvedAssignees.displayText,
          assigneeSearchText: resolvedAssignees.searchText,
          officialAssigneeText,
          assigneeStatusKind,
          neutralAssigneeHint,
          task,
        });
      }
    }
  }

  let referenceCount = 0;
  let resultCount = 0;
  let reviewNeededCount = 0;
  let attentionNeededCount = 0;
  let validUrlLinkCount = 0;
  let duplicateEntryCount = 0;
  let duplicateCrossTaskUrlCount = 0;

  for (const [, occs] of occurrencesByUrl) {
    const distinctTasks = new Set(occs.map((o) => o.taskId));
    if (distinctTasks.size > 1) {
      duplicateCrossTaskUrlCount++;
    }
  }

  const entries = rawEntries.map((entry) => {
    if (entry.group === 'reference') referenceCount++;
    else resultCount++;
    if (entry.needsReview) reviewNeededCount++;
    if (entry.needsAttention) attentionNeededCount++;
    if (entry.hasValidUrl) validUrlLinkCount++;

    const allOccs = entry.normalizedUrl
      ? occurrencesByUrl.get(entry.normalizedUrl) ?? []
      : [];
    const others = allOccs.filter((o) => o.key !== entry.key);
    if (others.length > 0) duplicateEntryCount++;

    return {
      ...entry,
      duplicateOccurrences: others,
    };
  });

  return {
    entries,
    totalLinks: entries.length,
    referenceCount,
    resultCount,
    reviewNeededCount,
    attentionNeededCount,
    uniqueValidUrlCount: occurrencesByUrl.size,
    validUrlLinkCount,
    duplicateEntryCount,
    duplicateCrossTaskUrlCount,
  };
}

export function buildTaskLinkAddPatch(
  task: TaskItem,
  group: DocumentLinkGroup,
  newLink: DocumentLink
): { ok: true; patch: Partial<TaskItem> } | { ok: false; error: string } {
  const existing = group === 'reference' ? task.referenceLinks : task.resultLinks;
  if (existing.length >= MAX_LINKS_PER_GROUP) {
    return {
      ok: false,
      error: `Công việc ${task.displayCode} đã đạt giới hạn ${MAX_LINKS_PER_GROUP} liên kết trong nhóm này.`,
    };
  }
  const normalizedItem: DocumentLink = {
    ...newLink,
    type: group === 'reference' ? 'reference' : 'result',
    needsUrlExtraction: !newLink.url,
  };
  if (group === 'reference') {
    return {
      ok: true,
      patch: { referenceLinks: [...task.referenceLinks, normalizedItem] },
    };
  }
  return {
    ok: true,
    patch: { resultLinks: [...task.resultLinks, normalizedItem] },
  };
}

export function buildTaskLinkUpdatePatch(
  task: TaskItem,
  fromGroup: DocumentLinkGroup,
  linkId: string,
  updates: {
    label: string;
    url: string | null;
    toGroup: DocumentLinkGroup;
  }
): { ok: true; patch: Partial<TaskItem> } | { ok: false; error: string } {
  const fromList =
    fromGroup === 'reference' ? task.referenceLinks : task.resultLinks;
  const target = fromList.find((l) => l.id === linkId);
  if (!target) {
    return {
      ok: false,
      error: 'Liên kết này không còn tồn tại trong công việc gốc.',
    };
  }

  const cleanUrl = updates.url ? updates.url.trim() || null : null;
  const nextType: DocumentLink['type'] =
    updates.toGroup === 'reference'
      ? 'reference'
      : target.type === 'google_drive_link'
      ? 'google_drive_link'
      : 'result';

  const updatedItem: DocumentLink = {
    ...target,
    label: updates.label.trim(),
    url: cleanUrl,
    type: nextType,
    needsUrlExtraction: !cleanUrl,
  };

  if (updates.toGroup === fromGroup) {
    const nextList = fromList.map((l) => (l.id === linkId ? updatedItem : l));
    return {
      ok: true,
      patch:
        fromGroup === 'reference'
          ? { referenceLinks: nextList }
          : { resultLinks: nextList },
    };
  }

  const toList =
    updates.toGroup === 'reference' ? task.referenceLinks : task.resultLinks;
  if (toList.length >= MAX_LINKS_PER_GROUP) {
    return {
      ok: false,
      error: `Nhóm đích trên công việc ${task.displayCode} đã đạt giới hạn ${MAX_LINKS_PER_GROUP} liên kết.`,
    };
  }

  const nextFromList = fromList.filter((l) => l.id !== linkId);
  const nextToList = [...toList, updatedItem];

  return {
    ok: true,
    patch:
      fromGroup === 'reference'
        ? { referenceLinks: nextFromList, resultLinks: nextToList }
        : { resultLinks: nextFromList, referenceLinks: nextToList },
  };
}

export function buildTaskLinkRemovePatch(
  task: TaskItem,
  group: DocumentLinkGroup,
  linkId: string
): { ok: true; patch: Partial<TaskItem> } | { ok: false; error: string } {
  const fromList =
    group === 'reference' ? task.referenceLinks : task.resultLinks;
  if (!fromList.some((l) => l.id === linkId)) {
    return {
      ok: false,
      error: 'Liên kết này không còn tồn tại trong công việc gốc.',
    };
  }
  const nextList = fromList.filter((l) => l.id !== linkId);
  return {
    ok: true,
    patch:
      group === 'reference'
        ? { referenceLinks: nextList }
        : { resultLinks: nextList },
  };
}

export function exportTasksToCSV(
  tasks: TaskItem[],
  categories: CategoryItem[] = [],
  members: Array<
    Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>
  > = []
): string {
  const headers = [
    'ID',
    'STT',
    'ParentID',
    'Tên đầu việc',
    'Hạng mục',
    'Người thực hiện',
    'Trạng thái hiện tại',
    'Bước tiếp theo',
    'Hạn xử lý',
    'Cập nhật gần nhất',
    'Tiến độ việc con',
    'Tài liệu phục vụ nghiên cứu',
    'Kết quả nghiên cứu hiện tại (link)',
    'Ghi chú',
    'Cờ rà soát',
  ];

  const escapeCsv = (val: string) => {
    const safe = val.replace(/"/g, '""');
    return /[",\n]/.test(safe) ? `"${safe}"` : safe;
  };

  const formatLinksForCsv = (links: TaskItem['resultLinks']) =>
    links
      .map((l) => {
        if (!l.url) return `${l.label} [Chưa có URL]`;
        return isGenericDocumentLabel(l.label)
          ? l.url
          : `${l.label.trim()}: ${l.url}`;
      })
      .join('; ');

  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));
  const rows = activeTasks.map((t) => {
    const progress =
      t.parentId === null
        ? (() => {
            const p = computeParentProgress(t.id, activeTasks);
            return p.total > 0 ? `${p.completed}/${p.total}` : '';
          })()
        : '';
    const effCat = getEffectiveCategory(t, activeTasks, categories);
    const resolvedAssignees = resolveTaskAssignees(t, members);

    return [
      t.id,
      t.displayCode,
      t.parentId ?? '',
      t.title,
      effCat.category ?? '',
      resolvedAssignees.displayText,
      t.status ?? '',
      t.nextStep ?? '',
      t.dueDate ?? '',
      t.updatedAt ?? '',
      progress,
      formatLinksForCsv(t.referenceLinks),
      formatLinksForCsv(t.resultLinks),
      t.notes ?? '',
      t.reviewFlags.join('; '),
    ]
      .map(escapeCsv)
      .join(',');
  });

  return '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\n');
}

export type MyWorkSortOption = 'priority' | 'due_date' | 'code';

export interface MyWorkAttentionSummary {
  needsAttention: boolean;
  isOverdue: boolean;
  pendingApprovalAction: boolean;
  missingNextStep: boolean;
  hasDataIssue: boolean;
  reasons: string[];
}

/**
 * Computes data-driven attention signals for a task in "Việc của tôi".
 * Uses strictly real task state (dueDate, approval action, missing nextStep while active, data review flags).
 */
export function evaluateMyWorkAttention(
  task: TaskItem,
  currentUser: ProjectMember,
  referenceDate?: Date
): MyWorkAttentionSummary {
  const isOverdue = isTaskOverdue(task, referenceDate);
  const pendingApprovalAction =
    task.status === 'Chờ duyệt' && canUserApproveTask(currentUser, task);
  const missingNextStep =
    task.status === 'Đang làm' && !(task.nextStep ?? '').trim();
  const dataReview = getTaskDataReviewSummary(task);
  const hasDataIssue = dataReview.hasAnyIssue;

  const reasons: string[] = [];
  if (isOverdue) reasons.push('Quá hạn xử lý');
  if (pendingApprovalAction) reasons.push('Chờ bạn phê duyệt');
  if (missingNextStep) reasons.push('Thiếu bước tiếp theo');
  if (dataReview.isMissingStatus) reasons.push('Thiếu trạng thái');
  if (dataReview.dataFlags.length > 0) reasons.push('Cần rà soát dữ liệu');

  return {
    needsAttention:
      isOverdue || pendingApprovalAction || missingNextStep || hasDataIssue,
    isOverdue,
    pendingApprovalAction,
    missingNextStep,
    hasDataIssue,
    reasons,
  };
}

/**
 * Deterministic, stable comparator for "Việc của tôi".
 */
export function compareTasksForMyWork(
  a: TaskItem,
  b: TaskItem,
  sortBy: MyWorkSortOption,
  currentUser: ProjectMember,
  referenceDate?: Date
): number {
  const compareDueDates = () => {
    if (a.dueDate && b.dueDate) {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    } else if (a.dueDate && !b.dueDate) {
      return -1;
    } else if (!a.dueDate && b.dueDate) {
      return 1;
    }
    return 0;
  };

  const compareDisplayCodes = () => {
    const byCode = a.displayCode.localeCompare(b.displayCode, 'vi', {
      numeric: true,
      sensitivity: 'base',
    });
    if (byCode !== 0) return byCode;
    return a.sortOrder - b.sortOrder;
  };

  if (sortBy === 'priority') {
    const attA = evaluateMyWorkAttention(a, currentUser, referenceDate);
    const attB = evaluateMyWorkAttention(b, currentUser, referenceDate);
    if (attA.needsAttention !== attB.needsAttention) {
      return attA.needsAttention ? -1 : 1;
    }
    const dueCmp = compareDueDates();
    if (dueCmp !== 0) return dueCmp;
    const aDone = a.status === 'Hoàn thành';
    const bDone = b.status === 'Hoàn thành';
    if (aDone !== bDone) return aDone ? 1 : -1;
    return compareDisplayCodes();
  }

  if (sortBy === 'due_date') {
    const dueCmp = compareDueDates();
    if (dueCmp !== 0) return dueCmp;
    return compareDisplayCodes();
  }

  return compareDisplayCodes();
}

export interface MyWorkPartitionResult {
  activeTasks: TaskItem[];
  directTasks: TaskItem[];
  collectiveOnlyTasks: TaskItem[];
}

/**
 * Strictly partitions UID-assigned personal tasks from unassigned collective "Nhóm" tasks.
 * Never mixes unassigned group tasks into directTasks and never double counts tasks assigned to both.
 */
export function partitionMyWorkTasks(
  tasks: TaskItem[],
  currentUserUid: string
): MyWorkPartitionResult {
  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));
  const directTasks = activeTasks.filter((t) =>
    t.assigneeUids.includes(currentUserUid)
  );
  const collectiveOnlyTasks = activeTasks.filter(
    (t) =>
      t.assignees.includes('Nhóm') && !t.assigneeUids.includes(currentUserUid)
  );
  return { activeTasks, directTasks, collectiveOnlyTasks };
}

export interface MyWorkCoAssigneesInfo {
  coAssigneeNames: string[];
  unknownUidCount: number;
  isCollectiveGroup: boolean;
  hasExtraContext: boolean;
}

/**
 * Resolves official project display names for other collaborators on a task,
 * suppressing redundant self-attribution on single-owner personal cards.
 */
export function getMyWorkCoAssigneesInfo(
  task: Pick<TaskItem, 'assigneeUids' | 'assignees'>,
  currentUserUid: string,
  members: Array<
    Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>
  > = []
): MyWorkCoAssigneesInfo {
  const resolved = resolveTaskAssignees(task, members);
  const coAssigneeNames = resolved.assignedMembers
    .filter((m) => m.uid !== currentUserUid)
    .map((m) => (m.isActive ? m.displayName : `${m.displayName} (Đã khóa)`));

  return {
    coAssigneeNames,
    unknownUidCount: resolved.unknownUidCount,
    isCollectiveGroup: resolved.isCollectiveGroup,
    hasExtraContext:
      coAssigneeNames.length > 0 || resolved.unknownUidCount > 0,
  };
}

export type ChildAttentionSignalKind =
  | 'overdue'
  | 'pending_approval'
  | 'data_review';

export interface ChildAttentionSignal {
  kind: ChildAttentionSignalKind;
  count: number;
  label: string;
}

export interface ChildAttentionSummary {
  overdueCount: number;
  pendingApprovalCount: number;
  dataReviewCount: number;
  signals: ChildAttentionSignal[];
  visibleSignals: ChildAttentionSignal[];
  hiddenSignals: ChildAttentionSignal[];
  tooltipText: string;
}

/**
 * Summarizes real child attention signals for a collapsed parent group.
 * Strictly separates business status ("Chờ duyệt"), due date ("Quá hạn"),
 * and data verification flags ("Cần rà soát"). Never mutates parent status.
 */
export function summarizeChildAttention(
  children: TaskItem[],
  referenceDate?: Date
): ChildAttentionSummary {
  let overdueCount = 0;
  let pendingApprovalCount = 0;
  let dataReviewCount = 0;

  for (const child of children) {
    if (isTaskOverdue(child, referenceDate)) {
      overdueCount += 1;
    }
    if (child.status === 'Chờ duyệt') {
      pendingApprovalCount += 1;
    }
    if (getTaskDataReviewSummary(child).dataFlags.length > 0) {
      dataReviewCount += 1;
    }
  }

  const signals: ChildAttentionSignal[] = [];
  if (overdueCount > 0) {
    signals.push({
      kind: 'overdue',
      count: overdueCount,
      label: `${overdueCount} quá hạn`,
    });
  }
  if (pendingApprovalCount > 0) {
    signals.push({
      kind: 'pending_approval',
      count: pendingApprovalCount,
      label: `${pendingApprovalCount} chờ duyệt`,
    });
  }
  if (dataReviewCount > 0) {
    signals.push({
      kind: 'data_review',
      count: dataReviewCount,
      label: `${dataReviewCount} cần rà soát`,
    });
  }

  return {
    overdueCount,
    pendingApprovalCount,
    dataReviewCount,
    signals,
    visibleSignals: signals.slice(0, 2),
    hiddenSignals: signals.slice(2),
    tooltipText: signals.map((s) => s.label).join(' · '),
  };
}

/**
 * Computes whether a parent group is expanded, supporting smart auto-expansion
 * during active filtering while allowing the user to manually collapse/expand
 * individual or all matched groups without losing unfiltered preferences.
 */
export function resolveParentExpandedState(params: {
  parentId: string;
  hasVisibleChildren: boolean;
  hasActiveFilter: boolean;
  autoExpand: boolean;
  expandedParents: Record<string, boolean>;
  filterOverrides: Record<string, boolean>;
}): boolean {
  const {
    parentId,
    hasVisibleChildren,
    hasActiveFilter,
    autoExpand,
    expandedParents,
    filterOverrides,
  } = params;

  if (!hasVisibleChildren) return false;

  if (hasActiveFilter) {
    if (Object.prototype.hasOwnProperty.call(filterOverrides, parentId)) {
      return Boolean(filterOverrides[parentId]);
    }
    return autoExpand ? true : Boolean(expandedParents[parentId]);
  }

  return Boolean(expandedParents[parentId]);
}

export interface OverviewStatsSummary {
  activeTasks: TaskItem[];
  parentTasks: TaskItem[];
  childTasks: TaskItem[];
  total: number;
  inProgress: number;
  pendingApproval: number;
  paused: number;
  completed: number;
  notStarted: number;
  missingStatus: number;
  overdue: number;
  tasksWithDueDate: number;
  flaggedTasks: TaskItem[];
  completionPercent: number;
}

/**
 * Computes exact project-wide statistics for the Smart Overview Dashboard.
 * Strictly excludes archived and B1 test tasks, keeps status === null
 * separate from "Chưa bắt đầu", and guarantees:
 * total === inProgress + pendingApproval + paused + completed + notStarted + missingStatus
 * for all valid TaskStatus | null records.
 */
export function computeOverviewStats(
  tasks: TaskItem[],
  referenceDate?: Date
): OverviewStatsSummary {
  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));
  const parentTasks = activeTasks
    .filter((t) => t.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const childTasks = activeTasks.filter((t) => t.parentId !== null);

  let inProgress = 0;
  let pendingApproval = 0;
  let paused = 0;
  let completed = 0;
  let notStarted = 0;
  let missingStatus = 0;
  let overdue = 0;
  let tasksWithDueDate = 0;
  const flaggedTasks: TaskItem[] = [];

  for (const task of activeTasks) {
    if (task.status === 'Đang làm') {
      inProgress += 1;
    } else if (task.status === 'Chờ duyệt') {
      pendingApproval += 1;
    } else if (task.status === 'Tạm dừng') {
      paused += 1;
    } else if (task.status === 'Hoàn thành') {
      completed += 1;
    } else if (task.status === 'Chưa bắt đầu') {
      notStarted += 1;
    } else if (task.status === null) {
      missingStatus += 1;
    }

    if (task.dueDate) {
      tasksWithDueDate += 1;
    }
    if (isTaskOverdue(task, referenceDate)) {
      overdue += 1;
    }
    if (getTaskDataReviewSummary(task).hasAnyIssue) {
      flaggedTasks.push(task);
    }
  }

  flaggedTasks.sort((a, b) => {
    const byCode = a.displayCode.localeCompare(b.displayCode, 'vi', {
      numeric: true,
      sensitivity: 'base',
    });
    if (byCode !== 0) return byCode;
    return a.sortOrder - b.sortOrder;
  });

  const total = activeTasks.length;
  const completionPercent =
    total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    activeTasks,
    parentTasks,
    childTasks,
    total,
    inProgress,
    pendingApproval,
    paused,
    completed,
    notStarted,
    missingStatus,
    overdue,
    tasksWithDueDate,
    flaggedTasks,
    completionPercent,
  };
}

export type OverviewWatchlistReasonKind =
  | 'overdue'
  | 'pending_approval_action'
  | 'pending_approval';

export interface OverviewWatchlistReason {
  kind: OverviewWatchlistReasonKind;
  label: string;
}

export interface OverviewWatchlistItem {
  task: TaskItem;
  isOverdue: boolean;
  isPendingApproval: boolean;
  canCurrentUserApprove: boolean;
  reasons: OverviewWatchlistReason[];
}

export interface OverviewWatchlistResult {
  items: OverviewWatchlistItem[];
  overdueCount: number;
  pendingApprovalCount: number;
  overlapCount: number;
}

/**
 * Builds the deduplicated "Công việc cần theo dõi" list from overdue and
 * "Chờ duyệt" active tasks.
 *
 * - Never duplicates a taskId when a task is both overdue and pending approval.
 * - Priority order: 1) Overdue (earliest dueDate first), 2) Chờ duyệt, 3) displayCode / sortOrder.
 * - RBAC-safe: only marks "Cần bạn duyệt" when canUserApproveTask(currentUser, task) is true;
 *   never suggests approval duties to non-approvers.
 */
export function buildOverviewWatchlist(
  tasks: TaskItem[],
  currentUser: ProjectMember,
  referenceDate?: Date
): OverviewWatchlistResult {
  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));
  const seenIds = new Set<string>();
  const items: OverviewWatchlistItem[] = [];
  let overdueCount = 0;
  let pendingApprovalCount = 0;
  let overlapCount = 0;

  for (const task of activeTasks) {
    if (seenIds.has(task.id)) continue;

    const overdue = isTaskOverdue(task, referenceDate);
    const pendingApproval = task.status === 'Chờ duyệt';

    if (!overdue && !pendingApproval) continue;

    seenIds.add(task.id);
    if (overdue) overdueCount += 1;
    if (pendingApproval) pendingApprovalCount += 1;
    if (overdue && pendingApproval) overlapCount += 1;

    const canCurrentUserApprove =
      pendingApproval && canUserApproveTask(currentUser, task);

    const reasons: OverviewWatchlistReason[] = [];
    if (overdue) {
      reasons.push({
        kind: 'overdue',
        label: task.dueDate
          ? `Quá hạn (${formatShortDate(task.dueDate)})`
          : 'Quá hạn',
      });
    }
    if (pendingApproval) {
      if (canCurrentUserApprove) {
        reasons.push({
          kind: 'pending_approval_action',
          label: 'Cần bạn duyệt',
        });
      } else {
        reasons.push({
          kind: 'pending_approval',
          label: 'Đang chờ duyệt',
        });
      }
    }

    items.push({
      task,
      isOverdue: overdue,
      isPendingApproval: pendingApproval,
      canCurrentUserApprove,
      reasons,
    });
  }

  items.sort((a, b) => {
    // 1. Overdue first
    if (a.isOverdue !== b.isOverdue) {
      return a.isOverdue ? -1 : 1;
    }
    // Among overdue tasks, earliest due date first
    if (a.isOverdue && b.isOverdue) {
      const dueA = a.task.dueDate ?? '';
      const dueB = b.task.dueDate ?? '';
      if (dueA !== dueB) return dueA.localeCompare(dueB);
    }
    // 2. Pending approval next
    if (a.isPendingApproval !== b.isPendingApproval) {
      return a.isPendingApproval ? -1 : 1;
    }
    // 3. Stable displayCode + sortOrder fallback
    const byCode = a.task.displayCode.localeCompare(b.task.displayCode, 'vi', {
      numeric: true,
      sensitivity: 'base',
    });
    if (byCode !== 0) return byCode;
    if (a.task.sortOrder !== b.task.sortOrder) {
      return a.task.sortOrder - b.task.sortOrder;
    }
    return a.task.id.localeCompare(b.task.id);
  });

  return {
    items,
    overdueCount,
    pendingApprovalCount,
    overlapCount,
  };
}
