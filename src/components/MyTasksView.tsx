import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileCheck2,
  Info,
  Lock,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { CategoryItem, ProjectMember, TaskItem, TaskStatus } from '../types/project';
import {
  ALL_STATUSES,
  canUserApproveTask,
  canUserEditTask,
  compareTasksForMyWork,
  evaluateMyWorkAttention,
  formatShortDate,
  getDocumentDisplayLabel,
  getDocumentSourceLabel,
  getEffectiveCategory,
  getMyWorkCoAssigneesInfo,
  getOfficialMemberDisplayName,
  getStatusMeta,
  MyWorkSortOption,
  partitionMyWorkTasks,
  resolveTaskAssignees,
} from '../utils/taskHelpers';
import { CategoryChip } from './CategoryChip';
import { ReviewBadge } from './ReviewBadge';
import { StatusBadge } from './StatusBadge';

interface MyTasksViewProps {
  tasks: TaskItem[];
  categories: CategoryItem[];
  members?: ProjectMember[];
  currentUser: ProjectMember;
  directoryUnavailable?: boolean;
  onSelectTask: (taskId: string) => void;
  onNavigateToTasks?: () => void;
  onQuickUpdate: (
    taskId: string,
    patch: Partial<Pick<TaskItem, 'status' | 'nextStep'>>,
    expectedVersion: number
  ) => Promise<{ ok: boolean; error?: string }>;
}

type StatusFilterValue = 'all' | TaskStatus | '__unset__';

interface CardFeedback {
  taskId: string;
  type: 'success' | 'error';
  message: string;
}

export const MyTasksView: React.FC<MyTasksViewProps> = ({
  tasks,
  categories,
  members = [],
  currentUser,
  directoryUnavailable = false,
  onSelectTask,
  onNavigateToTasks,
  onQuickUpdate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sortBy, setSortBy] = useState<MyWorkSortOption>('priority');
  const [showGroupTasks, setShowGroupTasks] = useState(false);

  const [editingNextStepId, setEditingNextStepId] = useState<string | null>(
    null
  );
  const [nextStepDraft, setNextStepDraft] = useState('');
  const [savingNextStepId, setSavingNextStepId] = useState<string | null>(null);

  const [editingStatusTaskId, setEditingStatusTaskId] = useState<string | null>(
    null
  );
  const [statusDraft, setStatusDraft] = useState<TaskStatus | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const [quickFeedback, setQuickFeedback] = useState<CardFeedback | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const [openLinkMenu, setOpenLinkMenu] = useState<{
    taskId: string;
    group: 'reference' | 'result';
  } | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openLinkMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-link-popover-root]')) {
        return;
      }
      setOpenLinkMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenLinkMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openLinkMenu]);

  const showCardFeedback = (
    taskId: string,
    type: 'success' | 'error',
    message: string
  ) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setQuickFeedback({ taskId, type, message });
    if (type === 'success') {
      feedbackTimerRef.current = window.setTimeout(() => {
        setQuickFeedback((curr) =>
          curr?.taskId === taskId && curr.type === 'success' ? null : curr
        );
      }, 3600);
    }
  };

  const officialDisplayName = getOfficialMemberDisplayName(currentUser);

  const { activeTasks, directTasks, collectiveOnlyTasks } = useMemo(
    () => partitionMyWorkTasks(tasks, currentUser.uid),
    [tasks, currentUser.uid]
  );

  // Attention map & personal summary strictly derived from directTasks
  const attentionByTaskId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateMyWorkAttention>>();
    for (const t of activeTasks) {
      map.set(t.id, evaluateMyWorkAttention(t, currentUser));
    }
    return map;
  }, [activeTasks, currentUser]);

  const stats = useMemo(() => {
    let inProgressCount = 0;
    let pendingApprovalCount = 0;
    let pausedCount = 0;
    let attentionCount = 0;
    let hasUnsetStatus = false;

    for (const t of directTasks) {
      if (t.status === 'Đang làm') inProgressCount++;
      else if (t.status === 'Chờ duyệt') pendingApprovalCount++;
      else if (t.status === 'Tạm dừng') pausedCount++;
      else if (t.status === null) hasUnsetStatus = true;

      if (attentionByTaskId.get(t.id)?.needsAttention) {
        attentionCount++;
      }
    }

    return {
      inProgressCount,
      pendingApprovalCount,
      pausedCount,
      attentionCount,
      hasUnsetStatus,
    };
  }, [directTasks, attentionByTaskId]);

  const filteredDirectTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = directTasks.filter((task) => {
      if (statusFilter === '__unset__') {
        if (task.status !== null) return false;
      } else if (statusFilter !== 'all') {
        if (task.status !== statusFilter) return false;
      }

      if (attentionOnly) {
        if (!attentionByTaskId.get(task.id)?.needsAttention) return false;
      }

      if (q) {
        const effCat = getEffectiveCategory(task, activeTasks, categories);
        const resolvedAssignees = resolveTaskAssignees(task, members);
        const hay = [
          task.displayCode,
          task.title,
          effCat.category,
          resolvedAssignees.searchText,
          task.nextStep ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    return [...list].sort((a, b) =>
      compareTasksForMyWork(a, b, sortBy, currentUser)
    );
  }, [
    directTasks,
    searchQuery,
    statusFilter,
    attentionOnly,
    sortBy,
    attentionByTaskId,
    activeTasks,
    categories,
    members,
    currentUser,
  ]);

  const sortedGroupTasks = useMemo(
    () =>
      [...collectiveOnlyTasks].sort((a, b) =>
        compareTasksForMyWork(a, b, 'code', currentUser)
      ),
    [collectiveOnlyTasks, currentUser]
  );

  const hasActiveFilter =
    searchQuery.trim() !== '' || statusFilter !== 'all' || attentionOnly;

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAttentionOnly(false);
  };

  const toggleStatusCardFilter = (target: TaskStatus) => {
    setAttentionOnly(false);
    setStatusFilter((prev) => (prev === target ? 'all' : target));
  };

  const toggleAttentionCardFilter = () => {
    setStatusFilter('all');
    setAttentionOnly((prev) => !prev);
  };

  const startEditNextStep = (task: TaskItem) => {
    if (savingNextStepId || savingStatusId) return;
    setEditingStatusTaskId(null);
    setEditingNextStepId(task.id);
    setNextStepDraft(task.nextStep ?? '');
    if (quickFeedback?.taskId === task.id) setQuickFeedback(null);
  };

  const cancelEditNextStep = () => {
    if (savingNextStepId) return;
    setEditingNextStepId(null);
  };

  const commitNextStep = async (task: TaskItem) => {
    if (savingNextStepId) return;
    const trimmed = nextStepDraft.trim();
    if (trimmed === (task.nextStep ?? '').trim()) {
      setEditingNextStepId(null);
      return;
    }

    setSavingNextStepId(task.id);
    try {
      const res = await onQuickUpdate(
        task.id,
        { nextStep: trimmed || null },
        task.version
      );
      if (res.ok) {
        setEditingNextStepId(null);
        showCardFeedback(
          task.id,
          'success',
          trimmed ? 'Đã lưu bước tiếp theo.' : 'Đã xóa nội dung bước tiếp theo.'
        );
      } else {
        // Keep editingNextStepId and nextStepDraft intact so user input is never lost
        showCardFeedback(
          task.id,
          'error',
          res.error ||
            'Không thể lưu bước tiếp theo. Nội dung bạn nhập vẫn được giữ lại để thử lại.'
        );
      }
    } finally {
      setSavingNextStepId(null);
    }
  };

  const toggleStatusEditor = (task: TaskItem) => {
    if (savingStatusId) return;
    if (editingStatusTaskId === task.id) {
      setEditingStatusTaskId(null);
      return;
    }
    setEditingNextStepId(null);
    setEditingStatusTaskId(task.id);
    setStatusDraft(task.status);
    if (quickFeedback?.taskId === task.id) setQuickFeedback(null);
  };

  const cancelStatusEditor = () => {
    if (savingStatusId) return;
    setEditingStatusTaskId(null);
  };

  const commitStatusChange = async (task: TaskItem) => {
    if (savingStatusId || statusDraft === null || statusDraft === task.status) {
      return;
    }
    setSavingStatusId(task.id);
    try {
      const res = await onQuickUpdate(
        task.id,
        { status: statusDraft },
        task.version
      );
      if (res.ok) {
        setEditingStatusTaskId(null);
        showCardFeedback(
          task.id,
          'success',
          `Đã lưu trạng thái "${statusDraft}".`
        );
      } else {
        // Keep editingStatusTaskId & statusDraft intact so selected draft is preserved
        showCardFeedback(
          task.id,
          'error',
          res.error ||
            'Không thể cập nhật trạng thái. Lựa chọn của bạn vẫn được giữ lại để thử lại.'
        );
      }
    } finally {
      setSavingStatusId(null);
    }
  };

  const renderTaskCard = (task: TaskItem, isCollectiveOnly: boolean) => {
    const canEdit = canUserEditTask(currentUser, task);
    const canApproveThisTask = canUserApproveTask(currentUser, task);
    const statusLockedForNonApprover =
      task.status === 'Hoàn thành' && !canApproveThisTask;

    const effCat = getEffectiveCategory(task, activeTasks, categories);
    const statusMeta = getStatusMeta(task.status);
    const attention =
      attentionByTaskId.get(task.id) ??
      evaluateMyWorkAttention(task, currentUser);
    const coInfo = getMyWorkCoAssigneesInfo(task, currentUser.uid, members);

    const validRefLinks = task.referenceLinks.filter((l) => Boolean(l.url));
    const validResultLinks = task.resultLinks.filter((l) => Boolean(l.url));

    const isEditingNextStep = editingNextStepId === task.id && canEdit;
    const isSavingThisNextStep = savingNextStepId === task.id;
    const isStatusEditorOpen = editingStatusTaskId === task.id && canEdit;
    const isSavingThisStatus = savingStatusId === task.id;
    const cardFeedback =
      quickFeedback?.taskId === task.id ? quickFeedback : null;
    const hasOpenPopover = openLinkMenu?.taskId === task.id;

    // Pure white default card surface; never tint whole card yellow for attention flags
    const cardSurfaceClass =
      'bg-white border-[#E5DFD2] hover:border-[#CFC6B4]';

    // Top hairline strictly reflects actual workflow status via STATUS_META / UNSET_STATUS_META
    const topAccentColor = statusMeta.border;

    const renderGroupLinkTrigger = (
      links: typeof validRefLinks,
      group: 'reference' | 'result'
    ) => {
      if (links.length === 0) return null;
      const isRef = group === 'reference';
      const Icon = isRef ? BookOpen : FileCheck2;
      const colorClass = isRef
        ? 'text-lam-sang-ink hover:text-huyen-lam'
        : 'text-thanh-ngoc-ink hover:text-huyen-lam';
      const text = isRef
        ? `${links.length} tham khảo`
        : `${links.length} kết quả`;
      const heading = isRef
        ? 'Tài liệu cần đọc / tham khảo'
        : 'Kết quả nghiên cứu';

      if (links.length === 1) {
        const lnk = links[0];
        const display = getDocumentDisplayLabel(lnk);
        const source = getDocumentSourceLabel(lnk.url);
        return (
          <a
            href={lnk.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            title={`${display.text} (${source})`}
            aria-label={`${heading}: ${display.text}`}
            className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline shrink-0 min-h-[36px] px-1.5 rounded-lg hover:bg-[#F3EFE6]/70 transition-colors ${colorClass}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums whitespace-nowrap">{text}</span>
          </a>
        );
      }

      const isOpen =
        openLinkMenu?.taskId === task.id && openLinkMenu.group === group;

      return (
        <div
          className="sm:relative inline-flex items-center"
          data-link-popover-root
        >
          <button
            type="button"
            onClick={() =>
              setOpenLinkMenu((prev) =>
                prev?.taskId === task.id && prev.group === group
                  ? null
                  : { taskId: task.id, group }
              )
            }
            aria-expanded={isOpen}
            aria-haspopup="menu"
            className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1 hover:bg-[#F3EFE6] shrink-0 min-h-[36px] transition-colors ${colorClass}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums whitespace-nowrap">{text}</span>
            <ChevronDown
              className={`w-3 h-3 shrink-0 transition-transform ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isOpen && (
            <div
              role="menu"
              aria-label={heading}
              className="absolute inset-x-0 sm:inset-x-auto sm:right-0 top-full mt-1.5 z-30 sm:w-[264px] bg-white border border-nga-xam rounded-xl shadow-[0_14px_32px_-8px_rgba(20,36,63,0.22)] p-1.5 space-y-0.5"
            >
              <div className="px-2.5 py-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#5E697A] border-b border-[#EFEAE0] mb-0.5">
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isRef ? 'text-lam-sang-ink' : 'text-thanh-ngoc-ink'
                  }`}
                />
                <span>{heading}</span>
              </div>
              {links.map((lnk) => {
                const display = getDocumentDisplayLabel(lnk);
                const source = getDocumentSourceLabel(lnk.url);
                return (
                  <a
                    key={lnk.id}
                    role="menuitem"
                    href={lnk.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpenLinkMenu(null)}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-nga-thien transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs truncate ${
                          display.isPlaceholder
                            ? 'text-[#6E7889] italic'
                            : 'font-medium text-huyen-lam group-hover:text-lam-tri-tue'
                        }`}
                      >
                        {display.text}
                      </div>
                      <div className="text-[11px] text-[#7D8796] truncate">
                        {source}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[#8A94A3] shrink-0" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    return (
      <article
        key={task.id}
        className={`relative rounded-xl border transition-[border-color,box-shadow,background-color] duration-150 hover:shadow-[0_10px_24px_-14px_rgba(20,36,63,0.16)] ${cardSurfaceClass} ${
          hasOpenPopover ? 'z-20' : ''
        }`}
      >
        {/* Subtle top hairline matching actual workflow status */}
        <div
          aria-hidden="true"
          className="h-[2.5px] w-full rounded-t-[11px] overflow-hidden"
        >
          <div
            className="h-full w-full"
            style={{ backgroundColor: topAccentColor }}
          />
        </div>

        <div className="p-3.5 sm:px-4 sm:py-3.5 space-y-2.5">
          {/* Card Header: Code + Title + Category + Warnings | Status */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => onSelectTask(task.id)}
                className="text-left w-full group rounded focus-visible:outline-2 focus-visible:outline-lam-tri-tue"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono-tabular text-[11.5px] font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-huyen-lam shrink-0">
                    {task.displayCode}
                  </span>
                  <h3 className="text-[14.5px] sm:text-[15.5px] font-semibold text-huyen-lam group-hover:text-lam-tri-tue group-hover:underline leading-snug break-words">
                    {task.title}
                  </h3>
                  {isCollectiveOnly && (
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#EEF3F8] text-lam-tri-tue border border-[#CFDCEB] whitespace-nowrap">
                      Nhóm chung
                    </span>
                  )}
                </div>
              </button>

              {/* Category, Review Warning, Due Date & Relevant Collaborator Context */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <CategoryChip
                  categoryId={effCat.categoryId}
                  categoryName={effCat.category}
                  color={effCat.color}
                />

                <ReviewBadge task={task} />

                {task.dueDate && (
                  <span
                    className={
                      attention.isOverdue
                        ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-chu-sa-border bg-chu-sa-soft text-chu-sa text-xs font-semibold font-mono-tabular whitespace-nowrap'
                        : 'inline-flex items-center gap-1 text-xs font-mono-tabular text-ink-muted whitespace-nowrap'
                    }
                    title={
                      attention.isOverdue
                        ? 'Công việc đã quá hạn xử lý'
                        : undefined
                    }
                  >
                    {attention.isOverdue ? (
                      <AlertTriangle
                        className="w-3.5 h-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <Calendar
                        className="w-3.5 h-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      Hạn {formatShortDate(task.dueDate)}
                      {attention.isOverdue ? ' · Quá hạn' : ''}
                    </span>
                  </span>
                )}

                {attention.pendingApprovalAction && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-minh-kim-ink whitespace-nowrap">
                    <Clock3 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Cần bạn duyệt</span>
                  </span>
                )}

                {coInfo.coAssigneeNames.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                    <Users className="w-3.5 h-3.5 shrink-0 text-[#6B7484]" />
                    <span>Cùng làm: {coInfo.coAssigneeNames.join(', ')}</span>
                  </span>
                )}

                {isCollectiveOnly &&
                  coInfo.coAssigneeNames.length === 0 &&
                  coInfo.unknownUidCount === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                      <Users className="w-3.5 h-3.5 shrink-0 text-[#6B7484]" />
                      <span>Chưa gán thành viên riêng</span>
                    </span>
                  )}

                {coInfo.unknownUidCount > 0 && !directoryUnavailable && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-[#7C4D00] font-medium">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>
                      {coInfo.unknownUidCount === 1
                        ? '1 tài khoản chưa đối chiếu'
                        : `${coInfo.unknownUidCount} tài khoản chưa đối chiếu`}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* StatusBadge (always visible) + edit trigger for permitted users */}
            <div className="flex flex-wrap sm:flex-col items-center sm:items-end gap-1.5 shrink-0">
              {canEdit && !statusLockedForNonApprover ? (
                <button
                  type="button"
                  onClick={() => toggleStatusEditor(task)}
                  aria-expanded={isStatusEditorOpen}
                  aria-label={`Đổi trạng thái công việc ${task.displayCode}: ${statusMeta.label}`}
                  className={`inline-flex items-center gap-1 rounded-xl p-1 -m-1 transition-colors min-h-[40px] ${
                    isStatusEditorOpen
                      ? 'bg-[#F3EFE6] ring-1 ring-[#D4CBB8]'
                      : 'hover:bg-[#F5F1E8]'
                  }`}
                >
                  <StatusBadge status={task.status} soft />
                  <span className="inline-flex items-center gap-0.5 px-1.5 text-[11px] font-semibold text-lam-tri-tue whitespace-nowrap">
                    <span>Đổi</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        isStatusEditorOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </span>
                </button>
              ) : (
                <div className="flex flex-col items-start sm:items-end gap-1">
                  <StatusBadge status={task.status} soft />
                  {canEdit && statusLockedForNonApprover && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                      <Lock className="w-3 h-3 shrink-0" />
                      <span>Đã duyệt · cần quyền duyệt để đổi</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Inline Responsive Status Selector Strip (Never clipped on 375px, clearly separates Saved vs Selected) */}
          {isStatusEditorOpen && (
            <div
              role="region"
              aria-label={`Chọn trạng thái cho ${task.title}`}
              className="rounded-xl border border-[#DFD8C8] bg-[#FAF8F3] p-3 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                    <span>Đã lưu:</span>
                    <StatusBadge status={task.status} compact soft />
                  </span>
                  <ArrowRight
                    className="w-3.5 h-3.5 text-[#8A94A3] shrink-0"
                    aria-hidden="true"
                  />
                  <span className="inline-flex items-center gap-1.5 text-huyen-lam font-semibold">
                    <span>Đang chọn:</span>
                    <StatusBadge status={statusDraft} compact />
                  </span>
                </div>
                {statusDraft === task.status && (
                  <span className="text-[11px] text-ink-muted">
                    Chọn một trạng thái khác để lưu
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                {ALL_STATUSES.map((st) => {
                  const needsApprovalLock =
                    st === 'Hoàn thành' && !canApproveThisTask;
                  const isSelected = statusDraft === st;
                  const isSaved = task.status === st;
                  const meta = getStatusMeta(st);

                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={needsApprovalLock || isSavingThisStatus}
                      onClick={() => setStatusDraft(st)}
                      title={
                        needsApprovalLock
                          ? 'Chỉ Quản trị hoặc người có quyền duyệt mới được chọn Hoàn thành'
                          : `Chọn trạng thái ${st}`
                      }
                      className={`inline-flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors min-h-[40px] ${
                        isSelected
                          ? 'border-huyen-lam ring-1 ring-huyen-lam bg-white text-huyen-lam font-semibold'
                          : needsApprovalLock
                          ? 'border-nga-xam/70 bg-[#F3EFE6]/60 text-[#8A94A3] cursor-not-allowed'
                          : 'border-nga-xam bg-white/80 hover:bg-white text-huyen-lam'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-2.5 h-2.5 rounded-sm border shrink-0"
                          style={{
                            backgroundColor: meta.bg,
                            borderColor: meta.border,
                          }}
                        />
                        <span className="truncate">{st}</span>
                      </span>
                      {needsApprovalLock ? (
                        <Lock className="w-3 h-3 shrink-0" />
                      ) : isSelected ? (
                        <Check className="w-3.5 h-3.5 shrink-0 text-huyen-lam" />
                      ) : isSaved ? (
                        <span className="text-[10px] text-ink-muted shrink-0">
                          hiện tại
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={isSavingThisStatus}
                  onClick={cancelStatusEditor}
                  className="px-3 py-1.5 text-xs font-medium text-ink-muted border border-nga-xam bg-white rounded-lg hover:bg-nga-thien hover:text-huyen-lam min-h-[38px] disabled:opacity-50 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={
                    isSavingThisStatus ||
                    statusDraft === null ||
                    statusDraft === task.status
                  }
                  onClick={() => commitStatusChange(task)}
                  className="px-3.5 py-1.5 text-xs font-semibold bg-huyen-lam hover:bg-lam-tri-tue text-white rounded-lg inline-flex items-center gap-1.5 min-h-[38px] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isSavingThisStatus ? 'Đang lưu...' : 'Lưu trạng thái'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Inline Card Save Feedback (Success or Error while preserving draft) */}
          {cardFeedback && (
            <div
              role={cardFeedback.type === 'error' ? 'alert' : 'status'}
              className={`px-3 py-2 rounded-lg border text-xs flex items-start justify-between gap-2 ${
                cardFeedback.type === 'error'
                  ? 'bg-[#FAF0EE] border-[#DEB2AE] text-[#8B322F]'
                  : 'bg-[#EEF7F5] border-[#BEE0D8] text-[#1D5950]'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {cardFeedback.type === 'error' ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="break-words">{cardFeedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setQuickFeedback(null)}
                aria-label="Đóng thông báo trên thẻ"
                className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Highlighted Next Step + Links + Drawer Action */}
          <div className="relative pt-2.5 border-t border-[#EFEAE0] flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            {isEditingNextStep ? (
              <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="text"
                  maxLength={500}
                  value={nextStepDraft}
                  disabled={isSavingThisNextStep}
                  onChange={(e) => setNextStepDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitNextStep(task);
                    }
                    if (e.key === 'Escape') cancelEditNextStep();
                  }}
                  placeholder="Nhập bước tiếp theo cụ thể..."
                  autoFocus
                  className="flex-1 min-w-0 px-3 py-2 text-[13px] bg-white border border-lam-tri-tue/45 rounded-lg text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-tri-tue disabled:bg-nga-thien min-h-[40px]"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isSavingThisNextStep}
                    onClick={() => commitNextStep(task)}
                    className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold bg-huyen-lam hover:bg-lam-tri-tue text-white rounded-lg inline-flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>{isSavingThisNextStep ? 'Đang lưu...' : 'Lưu'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSavingThisNextStep}
                    onClick={cancelEditNextStep}
                    className="px-3 py-2 text-xs font-medium text-ink-muted border border-nga-xam rounded-lg hover:bg-nga-thien hover:text-huyen-lam inline-flex items-center justify-center gap-1.5 min-h-[40px] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span>Hủy</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0 flex items-start gap-2">
                {attention.missingNextStep ? (
                  <AlertCircle
                    className="w-4 h-4 shrink-0 mt-0.5 text-[#B7791F]"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowRight
                    className="w-4 h-4 shrink-0 mt-0.5 text-lam-sang-ink"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1 text-[13px] leading-snug flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <span className="font-semibold text-huyen-lam">
                    Bước tiếp theo:
                  </span>
                  {task.nextStep ? (
                    <span className="text-[#27364B] font-medium break-words">
                      {task.nextStep}
                    </span>
                  ) : attention.missingNextStep ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#FFF8E7] border border-[#EBD29B] text-[#7C4D00] text-xs font-medium leading-snug">
                      Chưa có — nên bổ sung bước tiếp theo
                    </span>
                  ) : (
                    <span className="italic text-ink-muted">Chưa ghi nhận</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
              {renderGroupLinkTrigger(validRefLinks, 'reference')}
              {renderGroupLinkTrigger(validResultLinks, 'result')}

              {canEdit && !isEditingNextStep && (
                <button
                  type="button"
                  onClick={() => startEditNextStep(task)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-huyen-lam bg-[#FAF8F3] hover:bg-[#EFE9DC] border border-nga-xam rounded-lg min-h-[36px] whitespace-nowrap transition-colors"
                >
                  <Pencil className="w-3 h-3 shrink-0" />
                  <span>{task.nextStep ? 'Sửa bước' : 'Thêm bước'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onSelectTask(task.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-lam-tri-tue hover:text-huyen-lam hover:bg-[#F3EFE6]/70 rounded-lg min-h-[36px] whitespace-nowrap transition-colors"
              >
                <span>Chi tiết</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. Compact Personal Hero Header (Huyền Lam -> Lam Trí Tuệ + Minh Kim Count) */}
      <section
        aria-label="Không gian việc của tôi"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#14243F] via-[#1C3357] to-[#274467] text-trang-nga border border-[#2C4B73] px-4 py-4 sm:px-6 sm:py-4.5 lg:min-h-[116px] flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 shadow-[0_14px_30px_-14px_rgba(20,36,63,0.42)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-12 w-52 h-52 rounded-full bg-minh-kim/12 blur-2xl"
        />

        <div className="relative flex items-start sm:items-center gap-3.5 min-w-0">
          <div
            aria-hidden="true"
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-minh-kim/15 border border-minh-kim/35 text-kim-quang flex items-center justify-center shrink-0"
          >
            <UserCheck className="w-5 h-5" />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h1 className="text-[21px] sm:text-[25px] font-bold text-white tracking-[-0.02em] leading-tight text-balance">
                Việc của tôi
              </h1>
              <span className="text-xs sm:text-[13.5px] font-semibold text-kim-quang truncate max-w-full">
                {officialDisplayName}
              </span>
            </div>
            <p className="text-xs sm:text-[13.5px] text-[#CBD6E6] leading-snug max-w-2xl">
              Theo dõi và cập nhật công việc bạn phụ trách
            </p>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center justify-between lg:justify-end gap-3 sm:gap-4 shrink-0">
          <button
            type="button"
            onClick={resetFilters}
            title="Xem toàn bộ công việc được giao cho bạn"
            className="flex items-baseline gap-2 pr-1 lg:pr-4 lg:border-r lg:border-white/15 text-left group/total focus-visible:outline-2 focus-visible:outline-kim-quang rounded-lg"
          >
            <span className="text-[26px] sm:text-[30px] leading-none font-bold font-mono-tabular text-kim-quang group-hover/total:text-white transition-colors">
              {directTasks.length}
            </span>
            <span className="text-xs text-[#D5E0EE] whitespace-nowrap">
              việc được giao
              {stats.attentionCount > 0 && (
                <span className="text-[#F1D58B] font-medium tabular-nums">
                  {' '}
                  · {stats.attentionCount} cần chú ý
                </span>
              )}
            </span>
          </button>

          {onNavigateToTasks && (
            <button
              type="button"
              onClick={onNavigateToTasks}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/18 text-white text-xs sm:text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <span>Danh sách công việc</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[#D5E0EE]" />
            </button>
          )}
        </div>
      </section>

      {/* 2. Compact 4-Metric Personal Status Strip (Strictly from directTasks) */}
      <section
        aria-label="Tổng quan trạng thái việc cá nhân"
        className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3"
      >
        {/* Đang làm — Lam Sáng */}
        <button
          type="button"
          onClick={() => toggleStatusCardFilter('Đang làm')}
          aria-pressed={statusFilter === 'Đang làm'}
          className={`rounded-2xl border p-3.5 sm:px-4 sm:py-3.5 text-left flex items-center justify-between gap-2.5 transition-[transform,background-color,border-color,box-shadow] duration-150 hover:-translate-y-[1px] min-h-[76px] ${
            statusFilter === 'Đang làm'
              ? 'bg-[#DCEBFB] border-lam-sang ring-1 ring-lam-sang/30 shadow-[0_8px_20px_-12px_rgba(71,127,174,0.35)]'
              : 'bg-[#EFF6FB] border-[#C9DFF2] hover:bg-[#E4F0FA] hover:border-lam-sang/60'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <PlayCircle
                className="w-4 h-4 text-lam-sang-ink shrink-0"
                aria-hidden="true"
              />
              <span className="text-[13px] font-bold text-huyen-lam truncate">
                Đang làm
              </span>
            </div>
            <p className="text-[11px] text-[#456380] mt-1 truncate">
              {statusFilter === 'Đang làm' ? 'Đang lọc · bấm để bỏ' : 'Bấm để lọc nhanh'}
            </p>
          </div>
          <span className="text-[24px] sm:text-[28px] leading-none font-bold font-mono-tabular text-lam-sang-ink shrink-0">
            {stats.inProgressCount}
          </span>
        </button>

        {/* Chờ duyệt — Minh Kim */}
        <button
          type="button"
          onClick={() => toggleStatusCardFilter('Chờ duyệt')}
          aria-pressed={statusFilter === 'Chờ duyệt'}
          className={`rounded-2xl border p-3.5 sm:px-4 sm:py-3.5 text-left flex items-center justify-between gap-2.5 transition-[transform,background-color,border-color,box-shadow] duration-150 hover:-translate-y-[1px] min-h-[76px] ${
            statusFilter === 'Chờ duyệt'
              ? 'bg-[#F7EBCA] border-minh-kim ring-1 ring-minh-kim/40 shadow-[0_8px_20px_-12px_rgba(201,161,75,0.35)]'
              : 'bg-[#FCF7E8] border-[#E7D39C] hover:bg-[#F9F0D6] hover:border-minh-kim/70'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Clock3
                className="w-4 h-4 text-minh-kim-ink shrink-0"
                aria-hidden="true"
              />
              <span className="text-[13px] font-bold text-huyen-lam truncate">
                Chờ duyệt
              </span>
            </div>
            <p className="text-[11px] text-[#7A5D24] mt-1 truncate">
              {statusFilter === 'Chờ duyệt' ? 'Đang lọc · bấm để bỏ' : 'Bấm để lọc nhanh'}
            </p>
          </div>
          <span className="text-[24px] sm:text-[28px] leading-none font-bold font-mono-tabular text-minh-kim-ink shrink-0">
            {stats.pendingApprovalCount}
          </span>
        </button>

        {/* Tạm dừng — Chu Sa dịu */}
        <button
          type="button"
          onClick={() => toggleStatusCardFilter('Tạm dừng')}
          aria-pressed={statusFilter === 'Tạm dừng'}
          className={`rounded-2xl border p-3.5 sm:px-4 sm:py-3.5 text-left flex items-center justify-between gap-2.5 transition-[transform,background-color,border-color,box-shadow] duration-150 hover:-translate-y-[1px] min-h-[76px] ${
            statusFilter === 'Tạm dừng'
              ? 'bg-[#F4DFDC] border-chu-sa/70 ring-1 ring-chu-sa/30 shadow-[0_8px_20px_-12px_rgba(145,63,61,0.3)]'
              : 'bg-[#FAF0EE] border-[#E6C5C2] hover:bg-[#F7E7E4] hover:border-chu-sa/50'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <PauseCircle
                className="w-4 h-4 text-[#8B322F] shrink-0"
                aria-hidden="true"
              />
              <span className="text-[13px] font-bold text-huyen-lam truncate">
                Tạm dừng
              </span>
            </div>
            <p className="text-[11px] text-[#7D4644] mt-1 truncate">
              {statusFilter === 'Tạm dừng' ? 'Đang lọc · bấm để bỏ' : 'Bấm để lọc nhanh'}
            </p>
          </div>
          <span className="text-[24px] sm:text-[28px] leading-none font-bold font-mono-tabular text-[#8B322F] shrink-0">
            {stats.pausedCount}
          </span>
        </button>

        {/* Cần chú ý — Vàng ấm cảnh báo */}
        <button
          type="button"
          onClick={toggleAttentionCardFilter}
          aria-pressed={attentionOnly}
          className={`rounded-2xl border p-3.5 sm:px-4 sm:py-3.5 text-left flex items-center justify-between gap-2.5 transition-[transform,background-color,border-color,box-shadow] duration-150 hover:-translate-y-[1px] min-h-[76px] ${
            attentionOnly
              ? 'bg-[#FCE9BD] border-[#C98A1A] ring-1 ring-[#C98A1A]/35 shadow-[0_8px_20px_-12px_rgba(183,121,31,0.35)]'
              : 'bg-[#FFF8E6] border-[#E7C983] hover:bg-[#FDF0CE] hover:border-[#C98A1A]/70'
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <AlertTriangle
                className="w-4 h-4 text-[#7C4D00] shrink-0"
                aria-hidden="true"
              />
              <span className="text-[13px] font-bold text-huyen-lam truncate">
                Cần chú ý
              </span>
            </div>
            <p className="text-[11px] text-[#7C5A1E] mt-1 truncate">
              {attentionOnly
                ? 'Đang lọc · bấm để bỏ'
                : 'Quá hạn, thiếu bước, cảnh báo'}
            </p>
          </div>
          <span className="text-[24px] sm:text-[28px] leading-none font-bold font-mono-tabular text-[#7C4D00] shrink-0">
            {stats.attentionCount}
          </span>
        </button>
      </section>

      {currentUser.role === 'viewer' && (
        <div className="bg-surface-muted border border-nga-xam rounded-xl px-4 py-3 text-xs sm:text-sm text-huyen-lam flex items-start gap-2.5">
          <Info className="w-4 h-4 text-lam-tri-tue shrink-0 mt-0.5" />
          <span>
            Tài khoản của bạn đang ở chế độ <strong>Chỉ đọc</strong>. Bạn có thể
            theo dõi tiến độ toàn bộ đầu việc dự án tại mục{' '}
            <strong>Công việc</strong>, nhưng chưa thể chỉnh sửa dữ liệu.
          </span>
        </div>
      )}

      {/* 3. Smart Search, Filter & Sort Toolbar (visible when user has personal tasks) */}
      {directTasks.length > 0 && (
        <section
          aria-label="Tìm kiếm, lọc và sắp xếp công việc cá nhân"
          className="bg-white border border-nga-xam rounded-2xl p-3 sm:px-4 sm:py-3 shadow-[0_2px_10px_-6px_rgba(20,36,63,0.06)] space-y-2.5"
        >
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search
                className="w-4 h-4 text-[#7D8796] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo mã, tên công việc hoặc bước tiếp theo..."
                aria-label="Tìm kiếm việc của tôi"
                className="w-full min-w-0 pl-9 pr-8 py-2 text-xs sm:text-[13px] bg-nga-thien/70 border border-nga-xam rounded-xl text-huyen-lam placeholder:text-[#7D8796] focus:outline-none focus:bg-white focus:ring-2 focus:ring-lam-tri-tue min-h-[40px]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#7D8796] hover:text-huyen-lam"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:items-center gap-2 shrink-0">
              <select
                aria-label="Lọc theo trạng thái"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilterValue);
                }}
                className="w-full lg:w-auto px-3 py-2 text-xs font-medium bg-nga-thien/70 border border-nga-xam rounded-xl text-huyen-lam focus:outline-none focus:bg-white focus:ring-2 focus:ring-lam-tri-tue min-h-[40px]"
              >
                <option value="all">Tất cả trạng thái</option>
                {ALL_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
                {stats.hasUnsetStatus && (
                  <option value="__unset__">Thiếu trạng thái</option>
                )}
              </select>

              <button
                type="button"
                onClick={() => setAttentionOnly((v) => !v)}
                aria-pressed={attentionOnly}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors min-h-[40px] whitespace-nowrap ${
                  attentionOnly
                    ? 'bg-[#FCE9BD] border-[#C98A1A] text-[#7C4D00]'
                    : 'bg-nga-thien/70 border-nga-xam text-huyen-lam hover:bg-[#F3EFE6]'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Cần chú ý</span>
                <span className="font-mono-tabular">
                  ({stats.attentionCount})
                </span>
              </button>

              <select
                aria-label="Sắp xếp công việc"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as MyWorkSortOption)}
                className="w-full lg:w-auto px-3 py-2 text-xs font-medium bg-nga-thien/70 border border-nga-xam rounded-xl text-huyen-lam focus:outline-none focus:bg-white focus:ring-2 focus:ring-lam-tri-tue min-h-[40px]"
              >
                <option value="priority">Ưu tiên chú ý · Hạn gần</option>
                <option value="due_date">Hạn xử lý gần nhất</option>
                <option value="code">Theo mã công việc</option>
              </select>

              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-lam-tri-tue border border-nga-xam bg-white hover:bg-nga-thien min-h-[40px] whitespace-nowrap transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Xóa lọc</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted px-0.5">
            <span>
              Đang hiển thị{' '}
              <strong className="text-huyen-lam font-mono-tabular">
                {filteredDirectTasks.length}
              </strong>{' '}
              / {directTasks.length} việc bạn phụ trách
            </span>
            {stats.attentionCount > 0 && !attentionOnly && (
              <span className="text-[11.5px] text-[#7C4D00]">
                Các việc cần chú ý được ưu tiên đưa lên đầu danh sách mặc định
              </span>
            )}
          </div>
        </section>
      )}

      {/* 4. Personal Task Cards */}
      <section
        className="space-y-2.5"
        aria-label="Danh sách công việc phụ trách"
      >
        {directTasks.length === 0 ? (
          <div className="bg-white border border-nga-xam rounded-2xl px-4 py-8 text-center space-y-3.5 shadow-[0_2px_10px_-6px_rgba(20,36,63,0.06)]">
            <div className="space-y-1.5 max-w-md mx-auto">
              <p className="text-sm sm:text-base font-semibold text-huyen-lam">
                Bạn chưa được giao đầu việc riêng nào
              </p>
              <p className="text-xs sm:text-[13px] text-ink-muted leading-relaxed">
                {currentUser.role === 'viewer'
                  ? 'Hiện bạn đang ở chế độ Chỉ đọc. Bạn vẫn có thể theo dõi toàn bộ dự án tại mục Tổng quan hoặc Công việc.'
                  : currentUser.role === 'admin' || currentUser.role === 'moderator'
                  ? 'Bạn có thể theo dõi và cập nhật toàn bộ đầu việc tại mục Công việc, hoặc tự phân công mình vào các công việc cần phụ trách.'
                  : 'Khi người quản trị xác nhận giao việc cho tài khoản của bạn, các đầu việc và bước tiếp theo sẽ hiện tại đây.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onNavigateToTasks && (
                <button
                  type="button"
                  onClick={onNavigateToTasks}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-huyen-lam text-white rounded-xl hover:bg-lam-tri-tue transition-colors min-h-[40px]"
                >
                  <span>Xem tất cả công việc dự án</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
              {collectiveOnlyTasks.length > 0 && !showGroupTasks && (
                <button
                  type="button"
                  onClick={() => setShowGroupTasks(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-nga-xam text-huyen-lam bg-nga-thien rounded-xl hover:bg-[#EFE9DC] transition-colors min-h-[40px]"
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Xem việc chung của nhóm ({collectiveOnlyTasks.length})
                  </span>
                </button>
              )}
            </div>
          </div>
        ) : filteredDirectTasks.length === 0 ? (
          <div className="bg-white border border-nga-xam rounded-2xl px-4 py-7 text-center space-y-3">
            <p className="text-sm font-semibold text-huyen-lam">
              Không tìm thấy công việc phù hợp bộ lọc hiện tại
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-huyen-lam text-white rounded-xl hover:bg-lam-tri-tue transition-colors min-h-[40px]"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>Hiển thị lại tất cả việc của tôi</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredDirectTasks.map((task) => renderTaskCard(task, false))}
          </div>
        )}
      </section>

      {/* 5. Dedicated Collapsible Collective "Nhóm" Section (Never mixed or double-counted into personal tasks) */}
      <section
        className="pt-2 border-t border-nga-xam space-y-2.5"
        aria-label="Việc chung của nhóm"
      >
        <button
          type="button"
          onClick={() => setShowGroupTasks((v) => !v)}
          aria-expanded={showGroupTasks}
          className="w-full rounded-2xl border border-nga-xam bg-[#FAF8F3] hover:bg-[#F4EFE4] px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors min-h-[52px]"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-white border border-nga-xam text-lam-tri-tue flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-huyen-lam flex items-center gap-1.5">
                <span>
                  Việc chung của nhóm (
                  <span className="font-mono-tabular">
                    {collectiveOnlyTasks.length}
                  </span>
                  )
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-ink-muted truncate">
                Việc gắn nhãn tập thể chưa gán riêng — tách biệt khỏi số liệu cá nhân
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-lam-tri-tue whitespace-nowrap shrink-0">
            <span>{showGroupTasks ? 'Thu gọn' : 'Mở xem'}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                showGroupTasks ? 'rotate-180' : ''
              }`}
            />
          </span>
        </button>

        {showGroupTasks && (
          <div className="space-y-2.5">
            {sortedGroupTasks.length === 0 ? (
              <div className="bg-surface-muted border border-nga-xam rounded-xl px-4 py-4 text-center text-xs text-ink-muted">
                Không có việc chung nào ngoài danh sách việc bạn đang trực tiếp phụ trách.
              </div>
            ) : (
              sortedGroupTasks.map((task) => renderTaskCard(task, true))
            )}
          </div>
        )}
      </section>
    </div>
  );
};
