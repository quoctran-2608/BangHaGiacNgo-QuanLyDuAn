import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { CategoryItem, ProjectMember, TaskItem } from '../types/project';
import {
  computeParentProgress,
  formatShortDate,
  getEffectiveCategory,
  isB1TestTask,
  isTaskOverdue,
  resolveTaskAssignees,
  REVIEW_FLAG_LABELS,
} from '../utils/taskHelpers';
import { StatusBadge } from './StatusBadge';

interface OverviewViewProps {
  tasks: TaskItem[];
  categories?: CategoryItem[];
  members?: ProjectMember[];
  currentUser: ProjectMember;
  directoryUnavailable?: boolean;
  onSelectTask: (taskId: string) => void;
  onNavigateToTasks: (filterPreset?: { status?: string; reviewOnly?: boolean }) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  tasks,
  categories = [],
  members = [],
  currentUser,
  directoryUnavailable = false,
  onSelectTask,
  onNavigateToTasks,
}) => {
  const formatAssigneeSummary = (task: TaskItem): string => {
    const resolved = resolveTaskAssignees(task, members);
    if (directoryUnavailable && resolved.unknownUidCount > 0) {
      if (resolved.assignedMembers.length > 0) {
        const names = resolved.assignedMembers
          .map((am) => (am.isActive ? am.displayName : `${am.displayName} (Đã khóa)`))
          .join(', ');
        return `${names} (+${resolved.unknownUidCount})`;
      }
      if (resolved.isCollectiveGroup) {
        return 'Việc nhóm';
      }
      return '—';
    }
    return resolved.displayText;
  };
  const isManager =
    currentUser.role === 'admin' || currentUser.role === 'moderator';
  const [reviewExpanded, setReviewExpanded] = useState<boolean>(isManager);

  useEffect(() => {
    setReviewExpanded(isManager);
  }, [isManager]);

  const activeTasks = tasks.filter((t) => !t.archivedAt && !isB1TestTask(t));
  const parentTasks = activeTasks.filter((t) => t.parentId === null);
  const childTasks = activeTasks.filter((t) => t.parentId !== null);
  const tasksWithDueDate = activeTasks.filter((t) => Boolean(t.dueDate));

  const countByStatus = {
    inProgress: activeTasks.filter((t) => t.status === 'Đang làm').length,
    pendingApproval: activeTasks.filter((t) => t.status === 'Chờ duyệt').length,
    paused: activeTasks.filter((t) => t.status === 'Tạm dừng').length,
    completed: activeTasks.filter((t) => t.status === 'Hoàn thành').length,
    overdue: activeTasks.filter((t) => isTaskOverdue(t)).length,
  };

  const pendingApprovalTasks = activeTasks.filter(
    (t) => t.status === 'Chờ duyệt'
  );
  const overdueTasks = activeTasks.filter((t) => isTaskOverdue(t));
  const flaggedTasks = activeTasks.filter((t) => t.reviewFlags.length > 0);
  const noDueDatesConfigured = tasksWithDueDate.length === 0;

  const metrics = [
    {
      label: 'Tổng công việc',
      value: String(activeTasks.length),
      sub: `${parentTasks.length} cha · ${childTasks.length} con`,
      bg: '#FFFFFF',
      text: '#14243F',
      border: '#E6E2D8',
      icon: null,
      onClick: () => onNavigateToTasks(),
    },
    {
      label: 'Đang làm',
      value: String(countByStatus.inProgress),
      sub: 'Đang triển khai',
      bg: '#BDD7EE',
      text: '#103A5C',
      border: '#9CC2E5',
      icon: PlayCircle,
      onClick: () => onNavigateToTasks({ status: 'Đang làm' }),
    },
    {
      label: 'Chờ duyệt',
      value: String(countByStatus.pendingApproval),
      sub: 'Cần phê duyệt',
      bg: '#FFE699',
      text: '#5C4300',
      border: '#E8C868',
      icon: Clock,
      onClick: () => onNavigateToTasks({ status: 'Chờ duyệt' }),
    },
    {
      label: 'Tạm dừng',
      value: String(countByStatus.paused),
      sub: 'Đang tạm hoãn',
      bg: '#FFC7CE',
      text: '#6B111C',
      border: '#F0A4AE',
      icon: PauseCircle,
      onClick: () => onNavigateToTasks({ status: 'Tạm dừng' }),
    },
    {
      label: 'Hoàn thành',
      value: String(countByStatus.completed),
      sub: 'Đã nghiệm thu',
      bg: '#A9D08E',
      text: '#1E4612',
      border: '#8BBC6B',
      icon: CheckCircle2,
      onClick: () => onNavigateToTasks({ status: 'Hoàn thành' }),
    },
    {
      label: 'Quá hạn',
      value: noDueDatesConfigured ? '—' : String(countByStatus.overdue),
      sub: noDueDatesConfigured
        ? 'Chưa thiết lập hạn'
        : countByStatus.overdue === 0
        ? 'Không có việc trễ'
        : 'Cần xử lý gấp',
      bg: countByStatus.overdue > 0 ? '#FEF2F2' : '#EDEDED',
      text: countByStatus.overdue > 0 ? '#991B1B' : '#404040',
      border: countByStatus.overdue > 0 ? '#FCA5A5' : '#D4D4D4',
      icon: AlertTriangle,
      onClick: () => onNavigateToTasks(),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-huyen-lam tracking-tight">
            Tổng quan dự án
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            Theo dõi nhanh tiến độ biên soạn sách Từ Băng Hà Đến Giác Ngộ.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateToTasks()}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-huyen-lam hover:text-lam-tri-tue transition-colors self-start sm:self-auto whitespace-nowrap shrink-0 min-h-[38px]"
        >
          <span>Xem toàn bộ đầu việc</span>
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>
      </div>

      {/* Compact 6 KPI Cards */}
      <section aria-label="Thống kê trạng thái công việc">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.label}
                type="button"
                onClick={m.onClick}
                style={{
                  backgroundColor: m.bg,
                  borderColor: m.border,
                  color: m.text,
                }}
                className="text-left px-3 py-2.5 rounded-xl border transition-colors hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lam-tri-tue min-h-[68px] flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold opacity-90 truncate">
                    {m.label}
                  </span>
                  {Icon && <Icon className="w-3.5 h-3.5 opacity-80 shrink-0" />}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-xl font-bold font-mono-tabular leading-none">
                    {m.value}
                  </span>
                  <span className="text-[11px] opacity-80 truncate">
                    {m.sub}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Attention Required + Collapsible Admin Review Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Column 1: Pending Approval & Overdue */}
        <section className="bg-white border border-nga-xam rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-nga-thien/70 border-b border-nga-xam flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-huyen-lam">
                Công việc cần chú ý
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Đang chờ duyệt hoặc quá hạn xử lý
              </p>
            </div>
            <span className="text-xs font-mono-tabular font-semibold text-huyen-lam shrink-0">
              {pendingApprovalTasks.length + overdueTasks.length} việc
            </span>
          </div>

          <div className="divide-y divide-nga-xam/60">
            {overdueTasks.map((task) => (
              <button
                key={`overdue_${task.id}`}
                type="button"
                onClick={() => onSelectTask(task.id)}
                className="w-full text-left px-4 py-3 hover:bg-nga-thien transition-colors flex items-start justify-between gap-3 min-h-[52px]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-red-700 font-medium">
                    <span className="font-mono-tabular">{task.displayCode}</span>
                    <span aria-hidden="true">·</span>
                    <span>Quá hạn ({formatShortDate(task.dueDate)})</span>
                  </div>
                  <div className="text-sm font-medium text-huyen-lam mt-0.5 break-words">
                    {task.title}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {formatAssigneeSummary(task)}
                  </div>
                </div>
                <StatusBadge status={task.status} compact />
              </button>
            ))}

            {pendingApprovalTasks.map((task) => (
              <button
                key={`approval_${task.id}`}
                type="button"
                onClick={() => onSelectTask(task.id)}
                className="w-full text-left px-4 py-3 hover:bg-nga-thien transition-colors flex items-start justify-between gap-3 min-h-[52px]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="font-mono-tabular font-semibold text-huyen-lam">
                      {task.displayCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatAssigneeSummary(task)}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-huyen-lam mt-0.5 break-words">
                    {task.title}
                  </div>
                  {task.nextStep && (
                    <div className="text-xs text-minh-kim-ink mt-0.5">
                      Bước tiếp theo: {task.nextStep}
                    </div>
                  )}
                </div>
                <StatusBadge status={task.status} compact />
              </button>
            ))}

            {pendingApprovalTasks.length === 0 && overdueTasks.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-ink-muted">
                Hiện không có đầu việc nào chờ duyệt hoặc quá hạn.
              </div>
            )}
          </div>
        </section>

        {/* Column 2: Collapsible Source Review Queue */}
        <section className="bg-white border border-nga-xam rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-nga-thien/70 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setReviewExpanded((v) => !v)}
              aria-expanded={reviewExpanded}
              className="flex items-center gap-2 text-left min-w-0 flex-1 py-0.5"
            >
              {reviewExpanded ? (
                <ChevronDown className="w-4 h-4 text-ink-muted shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />
              )}
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-semibold text-huyen-lam truncate">
                  Cần rà soát từ bảng tính nguồn ({flaggedTasks.length})
                </h2>
                <p className="text-xs text-ink-muted mt-0.5 truncate">
                  {isManager
                    ? flaggedTasks.length > 0
                      ? `Ưu tiên quản lý: ${flaggedTasks.length} đầu việc có trường cần rà soát`
                      : 'Hiện không có đầu việc nào bị gắn cờ rà soát'
                    : 'Dành cho Admin & Moderator rà soát dữ liệu'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTasks({ reviewOnly: true })}
              className="text-xs font-semibold text-huyen-lam hover:text-lam-tri-tue whitespace-nowrap shrink-0 px-2 py-1"
            >
              Lọc ({flaggedTasks.length})
            </button>
          </div>

          {reviewExpanded && (
            <div className="border-t border-nga-xam divide-y divide-nga-xam/60">
              {flaggedTasks.map((task) => (
                <button
                  key={`flag_${task.id}`}
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-nga-thien transition-colors flex items-start justify-between gap-3 min-h-[48px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-mono-tabular font-semibold text-huyen-lam shrink-0">
                        {task.displayCode}
                      </span>
                      <span className="font-medium text-huyen-lam break-words">
                        {task.title}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-minh-kim-ink">
                      {task.reviewFlags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center gap-1"
                        >
                          <FileWarning className="w-3 h-3 shrink-0" />
                          <span>{REVIEW_FLAG_LABELS[flag]}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusBadge status={task.status} compact />
                </button>
              ))}

              {flaggedTasks.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-ink-muted">
                  Chưa có đầu việc nào cần rà soát.
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Parent Groups Summary */}
      <section className="bg-white border border-nga-xam rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-nga-thien/70 border-b border-nga-xam flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h2 className="text-sm sm:text-base font-semibold text-huyen-lam">
            {parentTasks.length} nhóm công việc chính
          </h2>
          <span className="text-xs text-ink-muted">
            Tiến độ tính tự động cho các nhóm có việc con
          </span>
        </div>
        {parentTasks.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-ink-muted">
              Chưa có công việc nào trên hệ thống.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-nga-xam/60">
            {parentTasks.map((parent) => {
              const prog = computeParentProgress(parent.id, activeTasks);
              return (
                <button
                  key={parent.id}
                  type="button"
                  onClick={() => onSelectTask(parent.id)}
                  className="w-full text-left px-4 py-3 hover:bg-nga-thien transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-h-[52px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono-tabular text-xs font-bold text-huyen-lam shrink-0">
                        {parent.displayCode}
                      </span>
                      <span className="text-sm font-medium text-huyen-lam break-words">
                        {parent.title}
                      </span>
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span>
                        {getEffectiveCategory(parent, activeTasks, categories)
                          .category || 'Chưa phân hạng mục'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatAssigneeSummary(parent)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                    {prog.total > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="w-16 sm:w-20 h-1.5 bg-nga-xam rounded-full overflow-hidden">
                          <div
                            className="h-full bg-minh-kim transition-all"
                            style={{ width: `${prog.percentage}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono-tabular text-huyen-lam font-medium w-8 text-right">
                          {prog.completed}/{prog.total}
                        </span>
                      </div>
                    )}
                    <StatusBadge status={parent.status} compact />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
