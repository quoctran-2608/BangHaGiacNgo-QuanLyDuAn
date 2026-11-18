import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  Info,
  Users,
  X,
} from 'lucide-react';
import { CategoryItem, ProjectMember, TaskItem, TaskStatus } from '../types/project';
import {
  ALL_STATUSES,
  canUserApproveTask,
  canUserEditTask,
  formatShortDate,
  getDocumentDisplayLabel,
  getDocumentSourceLabel,
  getEffectiveCategory,
  getOfficialMemberDisplayName,
  isB1TestTask,
  isTaskOverdue,
  resolveTaskAssignees,
} from '../utils/taskHelpers';
import { StatusBadge } from './StatusBadge';

interface MyTasksViewProps {
  tasks: TaskItem[];
  categories: CategoryItem[];
  members?: ProjectMember[];
  currentUser: ProjectMember;
  onSelectTask: (taskId: string) => void;
  onNavigateToTasks?: () => void;
  onQuickUpdate: (
    taskId: string,
    patch: Partial<Pick<TaskItem, 'status' | 'nextStep'>>,
    expectedVersion: number
  ) => Promise<{ ok: boolean; error?: string }>;
}

export const MyTasksView: React.FC<MyTasksViewProps> = ({
  tasks,
  categories,
  members = [],
  currentUser,
  onSelectTask,
  onNavigateToTasks,
  onQuickUpdate,
}) => {
  const [includeGroupTasks, setIncludeGroupTasks] = useState(false);
  const [editingNextStepId, setEditingNextStepId] = useState<string | null>(
    null
  );
  const [nextStepDraft, setNextStepDraft] = useState('');
  const [savingNextStepId, setSavingNextStepId] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);
  const [openLinkMenu, setOpenLinkMenu] = useState<{
    taskId: string;
    group: 'reference' | 'result';
  } | null>(null);

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

  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));

  // Strictly separate account-assigned (UID) tasks vs collective "Nhóm" tasks
  const directTasks = activeTasks.filter((t) =>
    t.assigneeUids.includes(currentUser.uid)
  );
  const allCollectiveGroupTasks = activeTasks.filter((t) =>
    t.assignees.includes('Nhóm')
  );
  const visibleGroupTasks = includeGroupTasks
    ? allCollectiveGroupTasks.filter(
        (t) => !t.assigneeUids.includes(currentUser.uid)
      )
    : [];

  const canApprove = canUserApproveTask(currentUser);

  const startEditNextStep = (task: TaskItem) => {
    setEditingNextStepId(task.id);
    setNextStepDraft(task.nextStep ?? '');
    setQuickError(null);
  };

  const cancelEditNextStep = () => {
    if (savingNextStepId) return;
    setEditingNextStepId(null);
    setQuickError(null);
  };

  const commitNextStep = async (task: TaskItem) => {
    if (savingNextStepId) return;
    const trimmed = nextStepDraft.trim();
    if (trimmed === (task.nextStep ?? '').trim()) {
      setEditingNextStepId(null);
      setQuickError(null);
      return;
    }

    setSavingNextStepId(task.id);
    setQuickError(null);
    try {
      const res = await onQuickUpdate(
        task.id,
        { nextStep: trimmed || null },
        task.version
      );
      if (res.ok) {
        setEditingNextStepId(null);
      } else {
        // Keep editingNextStepId and nextStepDraft intact so user input is NEVER lost
        setQuickError({
          taskId: task.id,
          message:
            res.error ||
            'Không thể lưu bước tiếp theo. Nội dung bạn nhập vẫn được giữ lại để thử lại.',
        });
      }
    } finally {
      setSavingNextStepId(null);
    }
  };

  const handleStatusChange = async (task: TaskItem, val: string) => {
    if (savingStatusId) return;
    setSavingStatusId(task.id);
    setQuickError(null);
    try {
      const res = await onQuickUpdate(
        task.id,
        { status: val ? (val as TaskStatus) : null },
        task.version
      );
      if (!res.ok) {
        setQuickError({
          taskId: task.id,
          message: res.error || 'Không thể cập nhật trạng thái công việc.',
        });
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
    const overdue = isTaskOverdue(task);
    const validRefLinks = task.referenceLinks.filter((l) => Boolean(l.url));
    const validResultLinks = task.resultLinks.filter((l) => Boolean(l.url));
    const isSavingThisNextStep = savingNextStepId === task.id;
    const isSavingThisStatus = savingStatusId === task.id;
    const taskErr = quickError?.taskId === task.id ? quickError.message : null;
    const hasOpenPopover = openLinkMenu?.taskId === task.id;

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
            className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline shrink-0 min-h-[36px] ${colorClass}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">{text}</span>
          </a>
        );
      }

      const isOpen =
        openLinkMenu?.taskId === task.id && openLinkMenu.group === group;

      return (
        <div className="relative inline-flex items-center" data-link-popover-root>
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
            className={`inline-flex items-center gap-1 text-xs font-semibold rounded px-1.5 py-1 hover:bg-[#F3EFE6] shrink-0 min-h-[36px] transition-colors ${colorClass}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">{text}</span>
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
              className="absolute right-0 top-full mt-1 z-30 w-[264px] max-w-[calc(100vw-2.5rem)] bg-white border border-nga-xam rounded-xl shadow-[0_14px_32px_-8px_rgba(20,36,63,0.22)] p-1.5 space-y-0.5"
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
      <div
        key={task.id}
        className={`relative bg-white border border-nga-xam rounded-xl p-3.5 sm:p-4 space-y-3 ${
          hasOpenPopover ? 'z-20' : ''
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
          <button
            type="button"
            onClick={() => onSelectTask(task.id)}
            className="text-left flex-1 min-w-0 group"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono-tabular text-xs font-bold text-huyen-lam shrink-0">
                {task.displayCode}
              </span>
              <span className="text-sm sm:text-base font-semibold text-huyen-lam group-hover:text-lam-tri-tue group-hover:underline break-words">
                {task.title}
              </span>
              {isCollectiveOnly && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-nga-thien text-ink-muted border border-nga-xam">
                  Nhóm chung
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
              <span>
                {effCat.category || 'Chưa phân hạng mục'}
                {effCat.inherited ? ' (theo nhóm cha)' : ''}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Phụ trách:{' '}
                {resolveTaskAssignees(task, members).displayText}
              </span>
              {task.dueDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-mono-tabular ${
                      overdue ? 'text-red-700 font-semibold' : ''
                    }`}
                  >
                    Hạn: {formatShortDate(task.dueDate)}
                  </span>
                </>
              )}
            </div>
          </button>

          <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
            {canEdit && !statusLockedForNonApprover ? (
              <select
                aria-label={`Cập nhật trạng thái cho ${task.title}`}
                value={task.status ?? ''}
                disabled={isSavingThisStatus}
                onChange={(e) => handleStatusChange(task, e.target.value)}
                className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-nga-thien/70 border border-nga-xam rounded-lg text-huyen-lam focus:outline-none focus:bg-white focus:ring-2 focus:ring-lam-tri-tue disabled:opacity-60 min-h-[42px]"
              >
                {task.status === null && (
                  <option value="">Thiếu trạng thái (chưa chọn)</option>
                )}
                {ALL_STATUSES.map((st) => {
                  const disabled = st === 'Hoàn thành' && !canApproveThisTask;
                  return (
                    <option key={st} value={st} disabled={disabled}>
                      {st}
                      {disabled ? ' (cần quyền duyệt)' : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <>
                <StatusBadge status={task.status} />
                {canEdit && statusLockedForNonApprover && (
                  <span className="text-[11px] text-ink-muted">
                    Đã duyệt · cần quyền duyệt để đổi
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {taskErr && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{taskErr}</span>
          </div>
        )}

        {/* Quick Next Step Editor */}
        <div className="pt-2.5 border-t border-nga-xam/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {editingNextStepId === task.id && canEdit ? (
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
                placeholder="Nhập bước tiếp theo..."
                autoFocus
                className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-nga-xam rounded-lg text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-tri-tue disabled:bg-nga-thien min-h-[42px]"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSavingThisNextStep}
                  onClick={() => commitNextStep(task)}
                  className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold bg-huyen-lam hover:bg-lam-tri-tue text-nga-thien rounded-lg inline-flex items-center justify-center gap-1.5 min-h-[42px] disabled:opacity-60 transition-colors"
                >
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{isSavingThisNextStep ? 'Đang lưu...' : 'Lưu'}</span>
                </button>
                <button
                  type="button"
                  disabled={isSavingThisNextStep}
                  onClick={cancelEditNextStep}
                  className="px-3 py-2 text-xs font-medium text-ink-muted border border-nga-xam rounded-lg hover:bg-nga-thien hover:text-huyen-lam inline-flex items-center justify-center gap-1.5 min-h-[42px] disabled:opacity-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Hủy</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-700 break-words">
                <strong className="font-semibold text-huyen-lam">
                  Bước tiếp theo:
                </strong>{' '}
                {task.nextStep || 'Chưa ghi nhận'}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => startEditNextStep(task)}
                  className="text-huyen-lam hover:text-lam-tri-tue font-semibold whitespace-nowrap shrink-0 py-1.5 px-2.5 rounded-lg hover:bg-nga-thien min-h-[36px] transition-colors"
                >
                  Sửa nhanh
                </button>
              )}
            </div>
          )}

          {(validRefLinks.length > 0 || validResultLinks.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
              {renderGroupLinkTrigger(validRefLinks, 'reference')}
              {renderGroupLinkTrigger(validResultLinks, 'result')}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-huyen-lam tracking-tight">
            Việc của tôi
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            Tài khoản:{' '}
            <strong className="text-huyen-lam">
              {getOfficialMemberDisplayName(currentUser)}
            </strong>
            {' · '}
            <span>
              {currentUser.role === 'admin'
                ? 'Quản trị viên'
                : currentUser.role === 'moderator'
                ? 'Moderator (Quản lý)'
                : currentUser.role === 'member'
                ? 'Thành viên'
                : 'Viewer (Chỉ đọc)'}
              {canApprove ? ' (Có quyền duyệt)' : ''}
            </span>
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-huyen-lam cursor-pointer select-none min-h-[42px]">
          <input
            type="checkbox"
            checked={includeGroupTasks}
            onChange={(e) => setIncludeGroupTasks(e.target.checked)}
            className="w-4 h-4 rounded border-nga-xam accent-huyen-lam focus:ring-lam-tri-tue"
          />
          <span>
            Hiển thị thêm việc chung của nhóm ({allCollectiveGroupTasks.length})
          </span>
        </label>
      </div>

      {currentUser.role === 'viewer' && (
        <div className="bg-surface-muted border border-nga-xam rounded-xl px-4 py-3 text-xs sm:text-sm text-huyen-lam flex items-start gap-2.5">
          <Info className="w-4 h-4 text-lam-tri-tue shrink-0 mt-0.5" />
          <span>
            Tài khoản của bạn đang ở quyền <strong>Viewer (Chỉ đọc)</strong>. Bạn có thể xem tiến độ toàn bộ 20 đầu việc ở mục <strong>Công việc</strong>, nhưng chưa thể chỉnh sửa dữ liệu.
          </span>
        </div>
      )}

      {/* Section 1: Tasks directly assigned to this user's Firebase UID */}
      <section className="space-y-3" aria-label="Việc được giao cho tài khoản của bạn">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-huyen-lam">
            Việc được giao theo tài khoản ({directTasks.length})
          </h2>
        </div>

        {directTasks.length === 0 ? (
          <div className="bg-white border border-nga-xam rounded-xl px-4 py-7 text-center space-y-3">
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-semibold text-huyen-lam">
                Tài khoản của bạn chưa được giao đầu việc riêng nào
              </p>
              <p className="text-xs text-ink-muted leading-relaxed">
                {currentUser.role === 'viewer'
                  ? 'Hiện bạn đang ở quyền Viewer (Chỉ đọc). Bạn vẫn có thể theo dõi toàn bộ dự án tại mục Tổng quan hoặc Công việc.'
                  : currentUser.role === 'admin' || currentUser.role === 'moderator'
                  ? 'Bạn có thể xem và cập nhật trực tiếp toàn bộ công việc tại mục Công việc, hoặc tự gán tài khoản mình vào các đầu việc cần theo dõi.'
                  : 'Dù tên của bạn có thể đã ghi trên bảng tính nguồn, Admin hoặc Moderator cần xác nhận giao việc cho tài khoản Google này thì đầu việc mới hiện tại đây để bạn chỉnh sửa.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onNavigateToTasks && (
                <button
                  type="button"
                  onClick={onNavigateToTasks}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-huyen-lam text-nga-thien rounded-lg hover:bg-lam-tri-tue transition-colors min-h-[40px]"
                >
                  <span>Xem tất cả công việc dự án</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
              {allCollectiveGroupTasks.length > 0 && !includeGroupTasks && (
                <button
                  type="button"
                  onClick={() => setIncludeGroupTasks(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-nga-xam text-huyen-lam rounded-lg hover:bg-nga-thien transition-colors min-h-[40px]"
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>Xem {allCollectiveGroupTasks.length} việc chung của nhóm</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {directTasks.map((task) => renderTaskCard(task, false))}
          </div>
        )}
      </section>

      {/* Section 2: Collective "Nhóm" tasks when toggled on */}
      {includeGroupTasks && (
        <section
          className="space-y-2.5 pt-2 border-t border-nga-xam"
          aria-label="Việc chung của nhóm"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <h2 className="text-xs sm:text-sm font-semibold text-huyen-lam flex items-center gap-1.5">
              <Users className="w-4 h-4 text-lam-tri-tue shrink-0" />
              <span>
                Việc chung của nhóm — Nhãn &ldquo;Nhóm&rdquo; ({visibleGroupTasks.length})
              </span>
            </h2>
            <span className="text-[11px] text-ink-muted">
              Việc tập thể để theo dõi chung; chỉ tài khoản được Admin gán mới chỉnh sửa trực tiếp.
            </span>
          </div>

          {visibleGroupTasks.length === 0 ? (
            <div className="bg-surface-muted border border-nga-xam rounded-xl px-4 py-5 text-center text-xs text-ink-muted">
              Các việc chung của nhóm đã nằm trong danh sách việc được giao cho tài khoản của bạn.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleGroupTasks.map((task) => renderTaskCard(task, true))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
