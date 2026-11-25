import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type {
  CategoryItem,
  ProjectMember,
  TaskItem,
  TaskStatus,
  UserRole,
} from '../../src/types/project.js';
import {
  buildOverviewWatchlist,
  buildProjectDocumentEntries,
  canUserApproveTask,
  computeOverviewStats,
  computeParentProgress,
  getDocumentDisplayLabel,
  getDocumentSourceLabel,
  getEffectiveCategory,
  getTaskDataReviewSummary,
  isB1TestTask,
  isTaskOverdue,
  resolveTaskAssignees,
  validateHttpUrl,
} from '../../src/utils/taskHelpers.js';
import {
  decodePaginationCursor,
  encodePaginationCursor,
  type McpAuditEntry,
  type McpAuthenticatedActor,
  type McpMemberDirectoryItem,
  type McpReadRepository,
} from './types.js';

export const MCP_READ_ONLY_TOOL_NAMES = [
  'get_project_summary',
  'list_tasks',
  'get_task',
  'search_documents',
  'list_pending_approvals',
  'whoami',
] as const;

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Quản trị viên (Admin)',
  moderator: 'Điều phối viên (Moderator)',
  member: 'Thành viên (Member)',
  viewer: 'Người xem (Viewer)',
};

const TASK_STATUS_VALUES = [
  'Đang làm',
  'Chờ duyệt',
  'Tạm dừng',
  'Hoàn thành',
  'Chưa bắt đầu',
] as const;

export interface CreateTbhgnMcpServerOptions {
  actor: McpAuthenticatedActor;
  repo: McpReadRepository;
  toolTimeoutMs?: number;
  referenceDate?: Date;
  auditLogger?: (entry: McpAuditEntry) => void;
}

function defaultAuditLogger(entry: McpAuditEntry): void {
  console.info('[TBHGN-MCP]', JSON.stringify(entry));
}

function actorToProjectMember(actor: McpAuthenticatedActor): ProjectMember {
  // Synthetic non-PII ProjectMember strictly for domain RBAC helpers (`canUserApproveTask`, `buildOverviewWatchlist`)
  return {
    uid: actor.uid,
    displayName: actor.displayName,
    email: '',
    role: actor.role,
    canApprove: actor.canApprove,
    isActive: actor.isActive,
    sheetAlias: '',
    createdAt: '',
  };
}

function directoryToHelperMembers(
  directory: McpMemberDirectoryItem[]
): Array<Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>> {
  return directory.map((item) => ({
    uid: item.uid,
    displayName: item.displayName,
    email: '',
    isActive: item.isActive,
  }));
}

function getActiveOfficialTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks
    .filter((t) => !t.archivedAt && !isB1TestTask(t))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      const byCode = a.displayCode.localeCompare(b.displayCode, 'vi', {
        numeric: true,
        sensitivity: 'base',
      });
      if (byCode !== 0) return byCode;
      return a.id.localeCompare(b.id);
    });
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeOptionalText(value: string | null | undefined, maxLen = 1200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function formatLinkItem(
  link: TaskItem['referenceLinks'][number],
  group: 'reference' | 'result'
) {
  const checkedUrl = link.url ? validateHttpUrl(link.url) : null;
  const normalizedUrl = checkedUrl?.ok ? checkedUrl.normalizedUrl : null;
  return {
    id: link.id,
    group,
    label: getDocumentDisplayLabel(link).text,
    url: normalizedUrl,
    hasValidUrl: Boolean(normalizedUrl),
    sourceLabel: getDocumentSourceLabel(normalizedUrl ?? link.url ?? ''),
    needsUrlExtraction: Boolean(link.needsUrlExtraction),
  };
}

function buildCompactTaskSummary(
  task: TaskItem,
  allActiveTasks: TaskItem[],
  categories: CategoryItem[],
  helperMembers: Array<
    Pick<ProjectMember, 'uid' | 'displayName' | 'email' | 'isActive'>
  >,
  referenceDate?: Date
) {
  const effCat = getEffectiveCategory(task, allActiveTasks, categories);
  const resolvedAssignees = resolveTaskAssignees(task, helperMembers);
  const review = getTaskDataReviewSummary(task);
  const overdue = isTaskOverdue(task, referenceDate);
  const childProgressRaw =
    task.parentId === null
      ? computeParentProgress(task.id, allActiveTasks)
      : null;
  const childProgress =
    childProgressRaw && childProgressRaw.total > 0
      ? {
          completed: childProgressRaw.completed,
          total: childProgressRaw.total,
          percent: childProgressRaw.percentage,
        }
      : null;

  return {
    id: task.id,
    displayCode: task.displayCode,
    parentId: task.parentId,
    level: (task.parentId === null ? 'parent' : 'child') as 'parent' | 'child',
    title: task.title,
    categoryId: effCat.categoryId,
    categoryName: effCat.category,
    status: task.status,
    statusLabel: task.status ?? 'Thiếu trạng thái (null)',
    assignees: resolvedAssignees.assignedMembers.map((m) => ({
      uid: m.uid,
      displayName: m.displayName,
      isActive: m.isActive,
    })),
    assigneeText: resolvedAssignees.displayText,
    dueDate: task.dueDate,
    isOverdue: overdue,
    nextStep: sanitizeOptionalText(task.nextStep, 400),
    needsReview: review.hasAnyIssue,
    dataWarnings: [
      ...(review.isMissingStatus ? ['Thiếu trạng thái (null)'] : []),
      ...review.dataFlagLabels,
    ],
    childProgress,
    referenceLinkCount: task.referenceLinks?.length ?? 0,
    resultLinkCount: task.resultLinks?.length ?? 0,
    updatedAt: task.updatedAt,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Yêu cầu tra cứu dữ liệu vượt quá thời gian cho phép.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const AssigneeSchema = z.object({
  uid: z.string(),
  displayName: z.string(),
  isActive: z.boolean(),
});

const ChildProgressSchema = z
  .object({
    completed: z.number(),
    total: z.number(),
    percent: z.number(),
  })
  .nullable();

const TaskStatusSchema = z.enum(TASK_STATUS_VALUES).nullable();

const CompactTaskSchema = z.object({
  id: z.string(),
  displayCode: z.string(),
  parentId: z.string().nullable(),
  level: z.enum(['parent', 'child']),
  title: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string(),
  status: TaskStatusSchema,
  statusLabel: z.string(),
  assignees: z.array(AssigneeSchema),
  assigneeText: z.string(),
  dueDate: z.string().nullable(),
  isOverdue: z.boolean(),
  nextStep: z.string().nullable(),
  needsReview: z.boolean(),
  dataWarnings: z.array(z.string()),
  childProgress: ChildProgressSchema,
  referenceLinkCount: z.number(),
  resultLinkCount: z.number(),
  updatedAt: z.string().nullable(),
});

const DocumentLinkSummarySchema = z.object({
  id: z.string(),
  group: z.enum(['reference', 'result']),
  label: z.string(),
  url: z.string().nullable(),
  hasValidUrl: z.boolean(),
  sourceLabel: z.string(),
  needsUrlExtraction: z.boolean(),
});

/**
 * Creates a stateless, per-request TBHGN MCP Server V1.0 instance bound to a
 * single cryptographically verified, active project member.
 *
 * Strictly exposes ONLY the 6 read-only tools.
 */
export function createTbhgnMcpServer(
  options: CreateTbhgnMcpServerOptions
): McpServer {
  const { actor, repo } = options;
  const toolTimeoutMs = options.toolTimeoutMs ?? 10_000;
  const auditLogger = options.auditLogger ?? defaultAuditLogger;
  const actorMember = actorToProjectMember(actor);

  const server = new McpServer(
    {
      name: 'tbhgn-project-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'TBHGN MCP Server V1.0 là giao diện CHỈ ĐỌC (read-only) cho dự án Tu Biểu Hướng Giác Ngộ. Không hỗ trợ tạo, sửa, xóa hoặc duyệt công việc qua MCP.',
    }
  );

  async function executeReadOnlyTool<T extends Record<string, unknown>>(
    toolName: (typeof MCP_READ_ONLY_TOOL_NAMES)[number],
    fn: () => Promise<{ text: string; structuredContent: T }>
  ) {
    const startedAt = Date.now();
    try {
      const result = await withTimeout(fn(), toolTimeoutMs);
      auditLogger({
        timestamp: new Date().toISOString(),
        uid: actor.uid,
        role: actor.role,
        tool: toolName,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [{ type: 'text' as const, text: result.text }],
        structuredContent: result.structuredContent,
      };
    } catch (err) {
      const safeMessage =
        err instanceof Error &&
        (err.message.includes('Cursor') ||
          err.message.includes('thời gian') ||
          err.message.includes('taskId') ||
          err.message.includes('displayCode'))
          ? err.message
          : 'Không thể hoàn tất truy vấn chỉ đọc trên dữ liệu dự án TBHGN.';
      auditLogger({
        timestamp: new Date().toISOString(),
        uid: actor.uid,
        role: actor.role,
        tool: toolName,
        ok: false,
        durationMs: Date.now() - startedAt,
        errorCode:
          err instanceof Error && err.message.includes('thời gian')
            ? 'timeout'
            : 'tool_error',
      });
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: safeMessage }],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Tool 1: get_project_summary
  // -------------------------------------------------------------------------
  const ProjectSummaryOutputSchema = z.object({
    totalTasks: z.number(),
    parentTasksCount: z.number(),
    childTasksCount: z.number(),
    completionPercent: z.number(),
    statusCounts: z.object({
      inProgress: z.number(),
      pendingApproval: z.number(),
      paused: z.number(),
      completed: z.number(),
      notStarted: z.number(),
      missingStatus: z.number(),
    }),
    overdueCount: z.number(),
    watchlistUniqueCount: z.number(),
    overlapOverdueAndPendingCount: z.number(),
    needsReviewCount: z.number(),
    actionableApprovalsForMeCount: z.number(),
    categoriesCount: z.number(),
    documentsCount: z.object({
      total: z.number(),
      reference: z.number(),
      result: z.number(),
      validUrlCount: z.number(),
    }),
    flaggedTasks: z.array(
      z.object({
        id: z.string(),
        displayCode: z.string(),
        title: z.string(),
        warnings: z.array(z.string()),
      })
    ),
  });

  server.registerTool(
    'get_project_summary',
    {
      title: 'Tổng quan dự án TBHGN',
      description:
        'Trả về thống kê tổng quan chỉ đọc của dự án TBHGN: tổng công việc đang hoạt động (đã loại bỏ việc lưu trữ và bản ghi thử nghiệm), số việc cha/con, đủ 5 trạng thái quy trình, số việc thiếu trạng thái (null), quá hạn, chờ duyệt, danh sách cần theo dõi không đếm trùng và tài liệu.',
      inputSchema: z.object({
        includeFlaggedList: z
          .boolean()
          .optional()
          .describe(
            'Bao gồm danh sách tối đa 20 công việc cần rà soát dữ liệu (mặc định: true).'
          ),
      }),
      outputSchema: ProjectSummaryOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeReadOnlyTool('get_project_summary', async () => {
        const [rawTasks, categories, directory] = await Promise.all([
          repo.listTasks(),
          repo.listCategories(),
          repo.listMemberDirectory(actor.role),
        ]);
        const helperMembers = directoryToHelperMembers(directory);
        const stats = computeOverviewStats(rawTasks, options.referenceDate);
        const watchlist = buildOverviewWatchlist(
          rawTasks,
          actorMember,
          options.referenceDate
        );
        const docsSummary = buildProjectDocumentEntries(
          rawTasks,
          categories,
          helperMembers
        );

        const actionableApprovalsForMeCount = watchlist.items.filter(
          (item) => item.canCurrentUserApprove
        ).length;

        const includeFlagged = args.includeFlaggedList !== false;
        const flaggedTasks = includeFlagged
          ? stats.flaggedTasks.slice(0, 20).map((t) => {
              const rev = getTaskDataReviewSummary(t);
              return {
                id: t.id,
                displayCode: t.displayCode,
                title: t.title,
                warnings: [
                  ...(rev.isMissingStatus ? ['Thiếu trạng thái (null)'] : []),
                  ...rev.dataFlagLabels,
                ],
              };
            })
          : [];

        const structuredContent = {
          totalTasks: stats.total,
          parentTasksCount: stats.parentTasks.length,
          childTasksCount: stats.childTasks.length,
          completionPercent: stats.completionPercent,
          statusCounts: {
            inProgress: stats.inProgress,
            pendingApproval: stats.pendingApproval,
            paused: stats.paused,
            completed: stats.completed,
            notStarted: stats.notStarted,
            missingStatus: stats.missingStatus,
          },
          overdueCount: stats.overdue,
          watchlistUniqueCount: watchlist.items.length,
          overlapOverdueAndPendingCount: watchlist.overlapCount,
          needsReviewCount: stats.flaggedTasks.length,
          actionableApprovalsForMeCount,
          categoriesCount: categories.filter((c) => c.isActive).length,
          documentsCount: {
            total: docsSummary.totalLinks,
            reference: docsSummary.referenceCount,
            result: docsSummary.resultCount,
            validUrlCount: docsSummary.validUrlLinkCount,
          },
          flaggedTasks,
        };

        const lines = [
          `Tổng quan dự án TBHGN: ${stats.total} công việc đang hoạt động (${stats.parentTasks.length} việc cha, ${stats.childTasks.length} việc con), hoàn thành ${stats.completionPercent}%.`,
          `- Trạng thái: Đang làm ${stats.inProgress} | Chờ duyệt ${stats.pendingApproval} | Tạm dừng ${stats.paused} | Hoàn thành ${stats.completed} | Chưa bắt đầu ${stats.notStarted} | Thiếu trạng thái (null) ${stats.missingStatus}.`,
          `- Cần theo dõi: ${watchlist.items.length} việc duy nhất (Quá hạn: ${stats.overdue}, Chờ duyệt: ${stats.pendingApproval}, trùng nhau: ${watchlist.overlapCount}).`,
          `- Cần bạn duyệt: ${actionableApprovalsForMeCount} | Cần rà soát dữ liệu: ${stats.flaggedTasks.length}.`,
          `- Tài liệu: ${docsSummary.totalLinks} liên kết (${docsSummary.referenceCount} tham khảo, ${docsSummary.resultCount} kết quả, ${docsSummary.validUrlLinkCount} URL hợp lệ).`,
        ];

        return {
          text: lines.join('\n'),
          structuredContent,
        };
      })
  );

  // -------------------------------------------------------------------------
  // Tool 2: list_tasks
  // -------------------------------------------------------------------------
  const ListTasksOutputSchema = z.object({
    totalMatched: z.number(),
    returnedCount: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    tasks: z.array(CompactTaskSchema),
  });

  server.registerTool(
    'list_tasks',
    {
      title: 'Danh sách công việc TBHGN',
      description:
        'Lọc và phân trang danh sách công việc đang hoạt động của dự án TBHGN (chỉ đọc). Hỗ trợ lọc theo 5 trạng thái hoặc "missing_status" (null), hạng mục, UID người phụ trách, từ khóa, cấp cha/con, việc quá hạn và việc cần rà soát.',
      inputSchema: z.object({
        status: z
          .enum([
            'Đang làm',
            'Chờ duyệt',
            'Tạm dừng',
            'Hoàn thành',
            'Chưa bắt đầu',
            'missing_status',
          ])
          .optional()
          .describe(
            'Lọc theo trạng thái quy trình hoặc "missing_status" cho công việc chưa có trạng thái (null).'
          ),
        category: z
          .string()
          .max(120)
          .optional()
          .describe('Mã categoryId hoặc tên hạng mục (không phân biệt hoa thường).'),
        assigneeUid: z
          .string()
          .max(128)
          .optional()
          .describe('Lọc công việc theo UID người phụ trách chính thức.'),
        query: z
          .string()
          .max(160)
          .optional()
          .describe('Từ khóa tìm trong mã, tiêu đề, bước tiếp theo, hạng mục hoặc tên người phụ trách.'),
        level: z
          .enum(['all', 'parent', 'child'])
          .optional()
          .describe('Lọc theo cấp công việc: all (mặc định), parent hoặc child.'),
        parentId: z
          .string()
          .max(128)
          .optional()
          .describe('Chỉ lấy các công việc con thuộc parentId này.'),
        overdueOnly: z
          .boolean()
          .optional()
          .describe('Chỉ lấy công việc đang quá hạn.'),
        needsReviewOnly: z
          .boolean()
          .optional()
          .describe('Chỉ lấy công việc cần rà soát dữ liệu (thiếu trạng thái hoặc có reviewFlags).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Số lượng trả về mỗi trang (1–50, mặc định 20).'),
        cursor: z
          .string()
          .max(128)
          .optional()
          .describe('Cursor phân trang từ lần gọi trước.'),
      }),
      outputSchema: ListTasksOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeReadOnlyTool('list_tasks', async () => {
        const offset = decodePaginationCursor(args.cursor);
        const limit = args.limit ?? 20;

        const [rawTasks, categories, directory] = await Promise.all([
          repo.listTasks(),
          repo.listCategories(),
          repo.listMemberDirectory(actor.role),
        ]);

        const activeTasks = getActiveOfficialTasks(rawTasks);
        const helperMembers = directoryToHelperMembers(directory);

        const categoryQuery = args.category ? normalizeSearch(args.category) : null;
        const textQuery = args.query ? normalizeSearch(args.query) : null;
        const assigneeUidFilter = args.assigneeUid?.trim() || null;
        const parentIdFilter = args.parentId?.trim() || null;
        const levelFilter = args.level ?? 'all';

        const filtered = activeTasks.filter((task) => {
          if (args.status === 'missing_status') {
            if (task.status !== null) return false;
          } else if (args.status) {
            if (task.status !== (args.status as TaskStatus)) return false;
          }

          if (levelFilter === 'parent' && task.parentId !== null) return false;
          if (levelFilter === 'child' && task.parentId === null) return false;
          if (parentIdFilter && task.parentId !== parentIdFilter) return false;

          if (assigneeUidFilter && !task.assigneeUids.includes(assigneeUidFilter)) {
            return false;
          }

          if (args.overdueOnly && !isTaskOverdue(task, options.referenceDate)) {
            return false;
          }

          if (
            args.needsReviewOnly &&
            !getTaskDataReviewSummary(task).hasAnyIssue
          ) {
            return false;
          }

          const effCat = getEffectiveCategory(task, activeTasks, categories);
          if (categoryQuery) {
            const matchesCatId =
              effCat.categoryId?.toLowerCase() === categoryQuery;
            const matchesCatName = effCat.category
              .toLowerCase()
              .includes(categoryQuery);
            if (!matchesCatId && !matchesCatName) return false;
          }

          if (textQuery) {
            const resolved = resolveTaskAssignees(task, helperMembers);
            const haystack = [
              task.displayCode,
              task.title,
              task.nextStep ?? '',
              effCat.category,
              resolved.searchText,
            ]
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(textQuery)) return false;
          }

          return true;
        });

        const pageSlice = filtered.slice(offset, offset + limit);
        const hasMore = offset + pageSlice.length < filtered.length;
        const nextCursor = hasMore
          ? encodePaginationCursor(offset + pageSlice.length)
          : null;

        const tasksOut = pageSlice.map((task) =>
          buildCompactTaskSummary(
            task,
            activeTasks,
            categories,
            helperMembers,
            options.referenceDate
          )
        );

        const summaryLines = [
          `Tìm thấy ${filtered.length} công việc khớp bộ lọc (hiển thị ${tasksOut.length}${hasMore ? ', còn trang tiếp theo' : ''}).`,
          ...tasksOut.map(
            (t) =>
              `- [${t.displayCode}] ${t.title} | ${t.statusLabel} | Phụ trách: ${t.assigneeText}${t.isOverdue ? ' | QUÁ HẠN' : ''}`
          ),
        ];

        return {
          text: summaryLines.join('\n'),
          structuredContent: {
            totalMatched: filtered.length,
            returnedCount: tasksOut.length,
            hasMore,
            nextCursor,
            tasks: tasksOut,
          },
        };
      })
  );

  // -------------------------------------------------------------------------
  // Tool 3: get_task
  // -------------------------------------------------------------------------
  const GetTaskOutputSchema = z.object({
    lookupStatus: z.enum(['found', 'not_found', 'ambiguous']),
    message: z.string(),
    task: z
      .object({
        id: z.string(),
        displayCode: z.string(),
        parentId: z.string().nullable(),
        level: z.enum(['parent', 'child']),
        title: z.string(),
        categoryId: z.string().nullable(),
        categoryName: z.string(),
        status: TaskStatusSchema,
        statusLabel: z.string(),
        assignees: z.array(AssigneeSchema),
        assigneeText: z.string(),
        dueDate: z.string().nullable(),
        isOverdue: z.boolean(),
        nextStep: z.string().nullable(),
        notes: z.string().nullable(),
        needsReview: z.boolean(),
        dataWarnings: z.array(z.string()),
        canCurrentUserApprove: z.boolean(),
        approvalLabel: z.string().nullable(),
        referenceLinks: z.array(DocumentLinkSummarySchema),
        resultLinks: z.array(DocumentLinkSummarySchema),
        version: z.number(),
        updatedAt: z.string().nullable(),
        updatedBy: z.string().nullable(),
      })
      .nullable(),
    parentTask: CompactTaskSchema.nullable(),
    childTasks: z.array(CompactTaskSchema),
    childProgress: ChildProgressSchema,
    candidates: z.array(
      z.object({
        id: z.string(),
        displayCode: z.string(),
        parentId: z.string().nullable(),
        title: z.string(),
        status: TaskStatusSchema,
        categoryName: z.string(),
        assigneeText: z.string(),
      })
    ),
  });

  server.registerTool(
    'get_task',
    {
      title: 'Chi tiết công việc TBHGN',
      description:
        'Xem chi tiết đầy đủ một công việc đang hoạt động theo taskId hoặc displayCode, gồm người phụ trách chính thức, công việc cha, danh sách việc con, tài liệu tham khảo và tài liệu kết quả tách biệt. Nếu displayCode trùng nhiều công việc, sẽ trả về danh sách ứng viên để chọn chính xác thay vì tự đoán.',
      inputSchema: z.object({
        taskId: z
          .string()
          .max(128)
          .optional()
          .describe('ID ổn định của công việc (ưu tiên dùng khi có).'),
        displayCode: z
          .string()
          .max(40)
          .optional()
          .describe('Mã hiển thị của công việc (ví dụ: "1", "3.1", "4.5").'),
      }),
      outputSchema: GetTaskOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeReadOnlyTool<z.infer<typeof GetTaskOutputSchema>>(
        'get_task',
        async () => {
        const taskId = args.taskId?.trim() || '';
        const displayCode = args.displayCode?.trim() || '';
        if (!taskId && !displayCode) {
          throw new Error(
            'Vui lòng cung cấp taskId hoặc displayCode để tra cứu công việc.'
          );
        }

        const [rawTasks, categories, directory] = await Promise.all([
          repo.listTasks(),
          repo.listCategories(),
          repo.listMemberDirectory(actor.role),
        ]);
        const activeTasks = getActiveOfficialTasks(rawTasks);
        const helperMembers = directoryToHelperMembers(directory);

        let matched: TaskItem[] = [];
        if (taskId) {
          const found = activeTasks.find((t) => t.id === taskId);
          if (found) matched = [found];
        } else {
          const codeLower = displayCode.toLowerCase();
          matched = activeTasks.filter(
            (t) => t.displayCode.trim().toLowerCase() === codeLower
          );
        }

        if (matched.length === 0) {
          const msg = taskId
            ? `Không tìm thấy công việc đang hoạt động với taskId "${taskId}".`
            : `Không tìm thấy công việc đang hoạt động với mã "${displayCode}".`;
          return {
            text: msg,
            structuredContent: {
              lookupStatus: 'not_found' as const,
              message: msg,
              task: null,
              parentTask: null,
              childTasks: [],
              childProgress: null,
              candidates: [],
            },
          };
        }

        if (matched.length > 1) {
          const candidates = matched.map((t) => {
            const effCat = getEffectiveCategory(t, activeTasks, categories);
            const resolved = resolveTaskAssignees(t, helperMembers);
            return {
              id: t.id,
              displayCode: t.displayCode,
              parentId: t.parentId,
              title: t.title,
              status: t.status,
              categoryName: effCat.category,
              assigneeText: resolved.displayText,
            };
          });
          const msg = `Mã "${displayCode}" khớp với ${candidates.length} công việc đang hoạt động. Vui lòng gọi lại get_task với taskId cụ thể để tránh nhầm lẫn.`;
          return {
            text: [
              msg,
              ...candidates.map(
                (c) =>
                  `- taskId=${c.id} | [${c.displayCode}] ${c.title} (${c.status ?? 'Thiếu trạng thái'})`
              ),
            ].join('\n'),
            structuredContent: {
              lookupStatus: 'ambiguous' as const,
              message: msg,
              task: null,
              parentTask: null,
              childTasks: [],
              childProgress: null,
              candidates,
            },
          };
        }

        const target = matched[0];
        const effCat = getEffectiveCategory(target, activeTasks, categories);
        const resolved = resolveTaskAssignees(target, helperMembers);
        const review = getTaskDataReviewSummary(target);
        const overdue = isTaskOverdue(target, options.referenceDate);
        const canApproveThis =
          target.status === 'Chờ duyệt' &&
          canUserApproveTask(actorMember, target);
        const approvalLabel =
          target.status === 'Chờ duyệt'
            ? canApproveThis
              ? 'Cần bạn duyệt'
              : 'Đang chờ duyệt'
            : null;

        const parentRaw = target.parentId
          ? activeTasks.find((t) => t.id === target.parentId) ?? null
          : null;
        const parentTask = parentRaw
          ? buildCompactTaskSummary(
              parentRaw,
              activeTasks,
              categories,
              helperMembers,
              options.referenceDate
            )
          : null;

        const childRaw = activeTasks.filter((t) => t.parentId === target.id);
        const childTasks = childRaw.map((c) =>
          buildCompactTaskSummary(
            c,
            activeTasks,
            categories,
            helperMembers,
            options.referenceDate
          )
        );
        const childProgressRaw = computeParentProgress(target.id, activeTasks);
        const childProgress =
          childProgressRaw.total > 0
            ? {
                completed: childProgressRaw.completed,
                total: childProgressRaw.total,
                percent: childProgressRaw.percentage,
              }
            : null;

        const referenceLinks = (target.referenceLinks ?? []).map((l) =>
          formatLinkItem(l, 'reference')
        );
        const resultLinks = (target.resultLinks ?? []).map((l) =>
          formatLinkItem(l, 'result')
        );

        const taskDetail = {
          id: target.id,
          displayCode: target.displayCode,
          parentId: target.parentId,
          level: (target.parentId === null ? 'parent' : 'child') as
            | 'parent'
            | 'child',
          title: target.title,
          categoryId: effCat.categoryId,
          categoryName: effCat.category,
          status: target.status,
          statusLabel: target.status ?? 'Thiếu trạng thái (null)',
          assignees: resolved.assignedMembers.map((m) => ({
            uid: m.uid,
            displayName: m.displayName,
            isActive: m.isActive,
          })),
          assigneeText: resolved.displayText,
          dueDate: target.dueDate,
          isOverdue: overdue,
          nextStep: sanitizeOptionalText(target.nextStep, 600),
          notes: sanitizeOptionalText(target.notes, 2000),
          needsReview: review.hasAnyIssue,
          dataWarnings: [
            ...(review.isMissingStatus ? ['Thiếu trạng thái (null)'] : []),
            ...review.dataFlagLabels,
          ],
          canCurrentUserApprove: canApproveThis,
          approvalLabel,
          referenceLinks,
          resultLinks,
          version: target.version,
          updatedAt: target.updatedAt,
          updatedBy: target.updatedBy,
        };

        const lines = [
          `[${taskDetail.displayCode}] ${taskDetail.title} (taskId: ${taskDetail.id})`,
          `- Hạng mục: ${taskDetail.categoryName} | Trạng thái: ${taskDetail.statusLabel}${approvalLabel ? ` (${approvalLabel})` : ''}${overdue ? ' | QUÁ HẠN' : ''}`,
          `- Phụ trách: ${taskDetail.assigneeText}${taskDetail.dueDate ? ` | Hạn: ${taskDetail.dueDate}` : ''}`,
          taskDetail.nextStep ? `- Bước tiếp theo: ${taskDetail.nextStep}` : null,
          parentTask
            ? `- Công việc cha: [${parentTask.displayCode}] ${parentTask.title}`
            : null,
          childProgress
            ? `- Việc con: ${childProgress.completed}/${childProgress.total} hoàn thành (${childProgress.percent}%).`
            : null,
          `- Tài liệu: ${referenceLinks.length} tham khảo, ${resultLinks.length} kết quả.`,
        ].filter(Boolean);

        return {
          text: lines.join('\n'),
          structuredContent: {
            lookupStatus: 'found' as const,
            message: 'Đã tìm thấy công việc.',
            task: taskDetail,
            parentTask,
            childTasks,
            childProgress,
            candidates: [],
          },
        };
      })
  );

  // -------------------------------------------------------------------------
  // Tool 4: search_documents
  // -------------------------------------------------------------------------
  const SearchDocumentsOutputSchema = z.object({
    totalMatched: z.number(),
    returnedCount: z.number(),
    referenceMatchedCount: z.number(),
    resultMatchedCount: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    documents: z.array(
      z.object({
        key: z.string(),
        linkId: z.string(),
        group: z.enum(['reference', 'result']),
        groupLabel: z.string(),
        label: z.string(),
        url: z.string().nullable(),
        hasValidUrl: z.boolean(),
        sourceLabel: z.string(),
        needsReview: z.boolean(),
        reviewReasons: z.array(z.string()),
        taskId: z.string(),
        taskCode: z.string(),
        taskTitle: z.string(),
        taskStatus: TaskStatusSchema,
        categoryName: z.string(),
        officialAssigneeText: z.string().nullable(),
      })
    ),
  });

  server.registerTool(
    'search_documents',
    {
      title: 'Tra cứu kho tài liệu TBHGN',
      description:
        'Tìm kiếm siêu dữ liệu liên kết tài liệu gắn với các công việc đang hoạt động (chỉ đọc). Luôn tách rõ nhóm "reference" (Tài liệu tham khảo) và "result" (Tài liệu kết quả), không tự tải nội dung tệp bên ngoài.',
      inputSchema: z.object({
        query: z
          .string()
          .max(160)
          .optional()
          .describe('Từ khóa tìm trong nhãn tài liệu, URL, mã/tên công việc, nguồn hoặc người phụ trách.'),
        group: z
          .enum(['all', 'reference', 'result'])
          .optional()
          .describe('Nhóm tài liệu: all (mặc định), reference (tham khảo) hoặc result (kết quả).'),
        taskId: z
          .string()
          .max(128)
          .optional()
          .describe('Lọc tài liệu theo taskId.'),
        taskCode: z
          .string()
          .max(40)
          .optional()
          .describe('Lọc tài liệu theo mã công việc (displayCode).'),
        category: z
          .string()
          .max(120)
          .optional()
          .describe('Lọc theo categoryId hoặc tên hạng mục.'),
        source: z
          .string()
          .max(80)
          .optional()
          .describe('Lọc theo nguồn tài liệu (ví dụ: Google Docs, Google Sheets, Google Drive).'),
        validUrlOnly: z
          .boolean()
          .optional()
          .describe('Chỉ trả về liên kết có URL http/https hợp lệ.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Số lượng trả về mỗi trang (1–50, mặc định 20).'),
        cursor: z
          .string()
          .max(128)
          .optional()
          .describe('Cursor phân trang từ lần gọi trước.'),
      }),
      outputSchema: SearchDocumentsOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeReadOnlyTool('search_documents', async () => {
        const offset = decodePaginationCursor(args.cursor);
        const limit = args.limit ?? 20;

        const [rawTasks, categories, directory] = await Promise.all([
          repo.listTasks(),
          repo.listCategories(),
          repo.listMemberDirectory(actor.role),
        ]);
        const helperMembers = directoryToHelperMembers(directory);
        const summary = buildProjectDocumentEntries(
          rawTasks,
          categories,
          helperMembers
        );

        const groupFilter = args.group ?? 'all';
        const q = args.query ? normalizeSearch(args.query) : null;
        const taskIdFilter = args.taskId?.trim() || null;
        const taskCodeFilter = args.taskCode
          ? normalizeSearch(args.taskCode)
          : null;
        const categoryFilter = args.category
          ? normalizeSearch(args.category)
          : null;
        const sourceFilter = args.source ? normalizeSearch(args.source) : null;

        const filtered = summary.entries.filter((entry) => {
          if (groupFilter !== 'all' && entry.group !== groupFilter) {
            return false;
          }
          if (taskIdFilter && entry.taskId !== taskIdFilter) return false;
          if (
            taskCodeFilter &&
            entry.taskCode.trim().toLowerCase() !== taskCodeFilter
          ) {
            return false;
          }
          if (args.validUrlOnly && !entry.hasValidUrl) return false;
          if (categoryFilter) {
            const matchId = entry.categoryId?.toLowerCase() === categoryFilter;
            const matchName = entry.categoryName
              .toLowerCase()
              .includes(categoryFilter);
            if (!matchId && !matchName) return false;
          }
          if (
            sourceFilter &&
            !entry.sourceLabel.toLowerCase().includes(sourceFilter)
          ) {
            return false;
          }
          if (q) {
            const haystack = [
              entry.displayLabel,
              entry.link.url ?? '',
              entry.sourceLabel,
              entry.taskCode,
              entry.taskTitle,
              entry.categoryName,
              entry.officialAssigneeText ?? '',
            ]
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });

        const referenceMatchedCount = filtered.filter(
          (e) => e.group === 'reference'
        ).length;
        const resultMatchedCount = filtered.filter(
          (e) => e.group === 'result'
        ).length;

        const pageSlice = filtered.slice(offset, offset + limit);
        const hasMore = offset + pageSlice.length < filtered.length;
        const nextCursor = hasMore
          ? encodePaginationCursor(offset + pageSlice.length)
          : null;

        const documents = pageSlice.map((entry) => {
          const checkedUrl = entry.link.url
            ? validateHttpUrl(entry.link.url)
            : null;
          return {
            key: entry.key,
            linkId: entry.linkId,
            group: entry.group,
            groupLabel:
              entry.group === 'reference'
                ? 'Tài liệu tham khảo'
                : 'Tài liệu kết quả',
            label: entry.displayLabel,
            url: checkedUrl?.ok ? checkedUrl.normalizedUrl : null,
            hasValidUrl: entry.hasValidUrl,
            sourceLabel: entry.sourceLabel,
            needsReview: entry.needsReview,
            reviewReasons: entry.reviewReasons,
            taskId: entry.taskId,
            taskCode: entry.taskCode,
            taskTitle: entry.taskTitle,
            taskStatus: entry.taskStatus,
            categoryName: entry.categoryName,
            officialAssigneeText: entry.officialAssigneeText,
          };
        });

        const lines = [
          `Tìm thấy ${filtered.length} tài liệu (${referenceMatchedCount} tham khảo, ${resultMatchedCount} kết quả; hiển thị ${documents.length}).`,
          ...documents.map(
            (d) =>
              `- [${d.groupLabel}] ${d.label} (${d.sourceLabel}) — Việc [${d.taskCode}] ${d.taskTitle}${d.url ? ` — ${d.url}` : ' — (Chưa có URL hợp lệ)'}`
          ),
        ];

        return {
          text: lines.join('\n'),
          structuredContent: {
            totalMatched: filtered.length,
            returnedCount: documents.length,
            referenceMatchedCount,
            resultMatchedCount,
            hasMore,
            nextCursor,
            documents,
          },
        };
      })
  );

  // -------------------------------------------------------------------------
  // Tool 5: list_pending_approvals
  // -------------------------------------------------------------------------
  const ListPendingApprovalsOutputSchema = z.object({
    scope: z.enum(['all_visible', 'actionable_by_me']),
    actorCanApproveAny: z.boolean(),
    totalPendingVisible: z.number(),
    actionableByMeCount: z.number(),
    viewOnlyPendingCount: z.number(),
    returnedCount: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.string(),
        displayCode: z.string(),
        title: z.string(),
        categoryName: z.string(),
        assignees: z.array(AssigneeSchema),
        assigneeText: z.string(),
        dueDate: z.string().nullable(),
        isOverdue: z.boolean(),
        canCurrentUserApprove: z.boolean(),
        approvalLabel: z.enum(['Cần bạn duyệt', 'Đang chờ duyệt']),
        nextStep: z.string().nullable(),
        updatedAt: z.string().nullable(),
      })
    ),
  });

  server.registerTool(
    'list_pending_approvals',
    {
      title: 'Danh sách công việc chờ duyệt',
      description:
        'Liệt kê công việc đang ở trạng thái "Chờ duyệt" (chỉ đọc, không thực hiện duyệt). Phân biệt chính xác theo quyền hiện tại giữa "Cần bạn duyệt" và "Đang chờ duyệt".',
      inputSchema: z.object({
        scope: z
          .enum(['all_visible', 'actionable_by_me'])
          .optional()
          .describe(
            'all_visible (mặc định): tất cả việc Chờ duyệt trong dự án; actionable_by_me: chỉ những việc mà người dùng hiện tại có quyền duyệt.'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Số lượng trả về mỗi trang (1–50, mặc định 20).'),
        cursor: z
          .string()
          .max(128)
          .optional()
          .describe('Cursor phân trang từ lần gọi trước.'),
      }),
      outputSchema: ListPendingApprovalsOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) =>
      executeReadOnlyTool('list_pending_approvals', async () => {
        const scope = args.scope ?? 'all_visible';
        const offset = decodePaginationCursor(args.cursor);
        const limit = args.limit ?? 20;

        const [rawTasks, categories, directory] = await Promise.all([
          repo.listTasks(),
          repo.listCategories(),
          repo.listMemberDirectory(actor.role),
        ]);
        const activeTasks = getActiveOfficialTasks(rawTasks);
        const helperMembers = directoryToHelperMembers(directory);

        const pendingTasks = activeTasks.filter(
          (t) => t.status === 'Chờ duyệt'
        );

        const enriched = pendingTasks.map((task) => {
          const effCat = getEffectiveCategory(task, activeTasks, categories);
          const resolved = resolveTaskAssignees(task, helperMembers);
          const overdue = isTaskOverdue(task, options.referenceDate);
          const canApproveThis = canUserApproveTask(actorMember, task);
          return {
            id: task.id,
            displayCode: task.displayCode,
            title: task.title,
            categoryName: effCat.category,
            assignees: resolved.assignedMembers.map((m) => ({
              uid: m.uid,
              displayName: m.displayName,
              isActive: m.isActive,
            })),
            assigneeText: resolved.displayText,
            dueDate: task.dueDate,
            isOverdue: overdue,
            canCurrentUserApprove: canApproveThis,
            approvalLabel: (canApproveThis
              ? 'Cần bạn duyệt'
              : 'Đang chờ duyệt') as 'Cần bạn duyệt' | 'Đang chờ duyệt',
            nextStep: sanitizeOptionalText(task.nextStep, 400),
            updatedAt: task.updatedAt,
          };
        });

        // Sort: actionable first, then overdue, then displayCode
        enriched.sort((a, b) => {
          if (a.canCurrentUserApprove !== b.canCurrentUserApprove) {
            return a.canCurrentUserApprove ? -1 : 1;
          }
          if (a.isOverdue !== b.isOverdue) {
            return a.isOverdue ? -1 : 1;
          }
          return a.displayCode.localeCompare(b.displayCode, 'vi', {
            numeric: true,
            sensitivity: 'base',
          });
        });

        const totalPendingVisible = enriched.length;
        const actionableByMeCount = enriched.filter(
          (i) => i.canCurrentUserApprove
        ).length;
        const viewOnlyPendingCount = totalPendingVisible - actionableByMeCount;

        const scopedList =
          scope === 'actionable_by_me'
            ? enriched.filter((i) => i.canCurrentUserApprove)
            : enriched;

        const pageSlice = scopedList.slice(offset, offset + limit);
        const hasMore = offset + pageSlice.length < scopedList.length;
        const nextCursor = hasMore
          ? encodePaginationCursor(offset + pageSlice.length)
          : null;

        const headerLine =
          scope === 'actionable_by_me'
            ? actionableByMeCount > 0
              ? `Có ${actionableByMeCount} công việc đang chờ bạn duyệt (trên tổng ${totalPendingVisible} việc Chờ duyệt). Lưu ý: MCP V1 chỉ đọc, không thể bấm duyệt qua AI.`
              : `Hiện không có công việc nào cần bạn duyệt (tổng ${totalPendingVisible} việc đang chờ duyệt bởi người có thẩm quyền).`
            : `Có ${totalPendingVisible} công việc đang ở trạng thái Chờ duyệt (Cần bạn duyệt: ${actionableByMeCount}, Đang chờ duyệt: ${viewOnlyPendingCount}).`;

        const lines = [
          headerLine,
          ...pageSlice.map(
            (item) =>
              `- [${item.displayCode}] ${item.title} | ${item.approvalLabel} | Phụ trách: ${item.assigneeText}${item.isOverdue ? ' | QUÁ HẠN' : ''}`
          ),
        ];

        return {
          text: lines.join('\n'),
          structuredContent: {
            scope,
            actorCanApproveAny: canUserApproveTask(actorMember),
            totalPendingVisible,
            actionableByMeCount,
            viewOnlyPendingCount,
            returnedCount: pageSlice.length,
            hasMore,
            nextCursor,
            items: pageSlice,
          },
        };
      })
  );

  // -------------------------------------------------------------------------
  // Tool 6: whoami
  // -------------------------------------------------------------------------
  const WhoamiOutputSchema = z.object({
    uid: z.string(),
    displayName: z.string(),
    role: z.enum(['admin', 'moderator', 'member', 'viewer']),
    roleLabel: z.string(),
    isActive: z.literal(true),
    canApprove: z.boolean(),
    authMethod: z.enum(['firebase_id_token', 'oauth_jwt']),
    scopes: z.array(z.string()),
    mcpMode: z.literal('read_only_v1'),
    capabilities: z.object({
      canReadProject: z.literal(true),
      canApproveTasksInWebApp: z.boolean(),
      canWriteViaMcp: z.literal(false),
    }),
  });

  server.registerTool(
    'whoami',
    {
      title: 'Thông tin quyền truy cập hiện tại',
      description:
        'Trả về danh tính chính thức và phạm vi quyền chỉ đọc của tài khoản đang xác thực qua MCP (không tiết lộ email hay thông tin nhạy cảm).',
      inputSchema: z.object({}),
      outputSchema: WhoamiOutputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () =>
      executeReadOnlyTool('whoami', async () => {
        const canApproveTasksInWebApp = canUserApproveTask(actorMember);
        const roleLabel = ROLE_LABELS[actor.role];

        const structuredContent = {
          uid: actor.uid,
          displayName: actor.displayName,
          role: actor.role,
          roleLabel,
          isActive: true as const,
          canApprove: actor.canApprove,
          authMethod: actor.authMethod,
          scopes: [...actor.scopes],
          mcpMode: 'read_only_v1' as const,
          capabilities: {
            canReadProject: true as const,
            canApproveTasksInWebApp,
            canWriteViaMcp: false as const,
          },
        };

        const text = [
          `Đang kết nối với tư cách: ${actor.displayName} (${roleLabel}).`,
          `- UID: ${actor.uid} | Trạng thái: Đang hoạt động | Chế độ MCP: Chỉ đọc (V1.0).`,
          `- Quyền duyệt trên ứng dụng web: ${canApproveTasksInWebApp ? 'Có' : 'Không'} | Quyền ghi qua MCP: Không.`,
        ].join('\n');

        return {
          text,
          structuredContent,
        };
      })
  );

  return server;
}
