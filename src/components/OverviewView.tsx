import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  Clock3,
  Layers,
  ListTree,
  PanelRightOpen,
  PauseCircle,
  PlayCircle,
  Users,
} from 'lucide-react';
import { CategoryItem, ProjectMember, TaskItem } from '../types/project';
import {
  buildOverviewWatchlist,
  computeOverviewStats,
  computeParentProgress,
  formatShortDate,
  getCategoryVisualTheme,
  getEffectiveCategory,
  getStatusMeta,
  getTaskDataReviewSummary,
  resolveTaskAssignees,
} from '../utils/taskHelpers';
import { CategoryChip } from './CategoryChip';
import { ReviewBadge } from './ReviewBadge';
import { StatusBadge } from './StatusBadge';

export interface OverviewTasksNavigationPreset {
  status?: string;
  categoryId?: string;
  reviewOnly?: boolean;
  overdueOnly?: boolean;
  focusParentId?: string;
}

interface OverviewViewProps {
  tasks: TaskItem[];
  categories?: CategoryItem[];
  members?: ProjectMember[];
  currentUser: ProjectMember;
  directoryUnavailable?: boolean;
  onSelectTask: (taskId: string) => void;
  onNavigateToTasks: (filterPreset?: OverviewTasksNavigationPreset) => void;
}

const MOBILE_WATCHLIST_LIMIT = 3;
const DESKTOP_WATCHLIST_LIMIT = 6;

export const OverviewView: React.FC<OverviewViewProps> = ({
  tasks,
  categories = [],
  members = [],
  currentUser,
  directoryUnavailable = false,
  onSelectTask,
  onNavigateToTasks,
}) => {
  const isManager =
    currentUser.role === 'admin' || currentUser.role === 'moderator';

  const [reviewExpanded, setReviewExpanded] = useState<boolean>(false);
  const [watchlistExpanded, setWatchlistExpanded] = useState<boolean>(false);
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 639px)');
    const handleChange = () => setIsCompactViewport(mq.matches);
    handleChange();
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const stats = useMemo(() => computeOverviewStats(tasks), [tasks]);
  const watchlist = useMemo(
    () => buildOverviewWatchlist(tasks, currentUser),
    [tasks, currentUser]
  );

  // Default review section expanded for managers on desktop only when there are flagged items
  useEffect(() => {
    setReviewExpanded(isManager && stats.flaggedTasks.length > 0 && !isCompactViewport);
  }, [isManager, stats.flaggedTasks.length > 0, isCompactViewport]);

  const formatAssigneeSummary = (task: TaskItem): string => {
    const resolved = resolveTaskAssignees(task, members);
    if (directoryUnavailable && resolved.unknownUidCount > 0) {
      if (resolved.assignedMembers.length > 0) {
        const names = resolved.assignedMembers
          .map((am) =>
            am.isActive ? am.displayName : `${am.displayName} (Đã khóa)`
          )
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

  const statusKpis = useMemo(() => {
    const inProgressMeta = getStatusMeta('Đang làm');
    const pendingMeta = getStatusMeta('Chờ duyệt');
    const pausedMeta = getStatusMeta('Tạm dừng');
    const completedMeta = getStatusMeta('Hoàn thành');
    const notStartedMeta = getStatusMeta('Chưa bắt đầu');

    return [
      {
        key: 'total',
        label: 'Tổng công việc',
        value: stats.total,
        sub: `${stats.parentTasks.length} cha · ${stats.childTasks.length} con`,
        bg: '#FFFFFF',
        border: '#DFD8CA',
        accent: '#14243F',
        text: '#14243F',
        subText: '#5A6270',
        iconColor: '#14243F',
        icon: Layers,
        ariaLabel: `Tổng công việc: ${stats.total}. Mở toàn bộ danh sách công việc`,
        onClick: () => onNavigateToTasks(),
      },
      {
        key: 'Đang làm',
        label: 'Đang làm',
        value: stats.inProgress,
        sub: 'Đang triển khai',
        bg: '#EEF5FC',
        border: '#C6DEF3',
        accent: inProgressMeta.border,
        text: inProgressMeta.text,
        subText: '#355D80',
        iconColor: '#285780',
        icon: PlayCircle,
        ariaLabel: `Đang làm: ${stats.inProgress}. Lọc công việc đang làm`,
        onClick: () => onNavigateToTasks({ status: 'Đang làm' }),
      },
      {
        key: 'Chờ duyệt',
        label: 'Chờ duyệt',
        value: stats.pendingApproval,
        sub: 'Đang chờ duyệt',
        bg: '#FDF7E3',
        border: '#EBD594',
        accent: pendingMeta.border,
        text: pendingMeta.text,
        subText: '#7A5D1E',
        iconColor: '#78530E',
        icon: Clock3,
        ariaLabel: `Chờ duyệt: ${stats.pendingApproval}. Lọc công việc chờ duyệt`,
        onClick: () => onNavigateToTasks({ status: 'Chờ duyệt' }),
      },
      {
        key: 'Tạm dừng',
        label: 'Tạm dừng',
        value: stats.paused,
        sub: 'Đang tạm hoãn',
        bg: '#FCEFF1',
        border: '#F0C5CB',
        accent: pausedMeta.border,
        text: pausedMeta.text,
        subText: '#843841',
        iconColor: '#913F3D',
        icon: PauseCircle,
        ariaLabel: `Tạm dừng: ${stats.paused}. Lọc công việc tạm dừng`,
        onClick: () => onNavigateToTasks({ status: 'Tạm dừng' }),
      },
      {
        key: 'Hoàn thành',
        label: 'Hoàn thành',
        value: stats.completed,
        sub: 'Đã nghiệm thu',
        bg: '#EFF7E9',
        border: '#C2DFAD',
        accent: completedMeta.border,
        text: completedMeta.text,
        subText: '#37612A',
        iconColor: '#2D6A23',
        icon: CheckCircle2,
        ariaLabel: `Hoàn thành: ${stats.completed}. Lọc công việc hoàn thành`,
        onClick: () => onNavigateToTasks({ status: 'Hoàn thành' }),
      },
      {
        key: 'Chưa bắt đầu',
        label: 'Chưa bắt đầu',
        value: stats.notStarted,
        sub: 'Chờ khởi động',
        bg: '#F5F5F4',
        border: '#DCDCD8',
        accent: notStartedMeta.border,
        text: notStartedMeta.text,
        subText: '#626770',
        iconColor: '#5A6270',
        icon: CircleDashed,
        ariaLabel: `Chưa bắt đầu: ${stats.notStarted}. Lọc công việc chưa bắt đầu`,
        onClick: () => onNavigateToTasks({ status: 'Chưa bắt đầu' }),
      },
    ];
  }, [stats, onNavigateToTasks]);

  const defaultWatchlistLimit = isCompactViewport
    ? MOBILE_WATCHLIST_LIMIT
    : DESKTOP_WATCHLIST_LIMIT;
  const hasHiddenWatchlist = watchlist.items.length > defaultWatchlistLimit;
  const visibleWatchlistItems = watchlistExpanded
    ? watchlist.items
    : watchlist.items.slice(0, defaultWatchlistLimit);
  const hiddenWatchlistCount = Math.max(
    0,
    watchlist.items.length - defaultWatchlistLimit
  );

  const watchlistSummaryText = useMemo(() => {
    const parts: string[] = [];
    if (watchlist.overdueCount > 0) {
      parts.push(`${watchlist.overdueCount} quá hạn`);
    }
    if (watchlist.pendingApprovalCount > 0) {
      parts.push(`${watchlist.pendingApprovalCount} chờ duyệt`);
    }
    if (parts.length === 0) {
      return 'Không có việc quá hạn hoặc đang chờ duyệt';
    }
    return parts.join(' · ');
  }, [watchlist.overdueCount, watchlist.pendingApprovalCount]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. Compact Editorial Header (No bulky hero) */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-[20px] sm:text-[24px] font-bold text-huyen-lam tracking-[-0.02em] leading-tight">
            Tổng quan dự án
          </h1>
          <p className="text-xs sm:text-[13.5px] text-ink-muted mt-0.5 leading-snug">
            Theo dõi nhanh tiến độ biên soạn sách Từ Băng Hà Đến Giác Ngộ.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateToTasks()}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DDD5C5] bg-white hover:bg-[#FAF8F3] hover:border-[#C7BFA9] text-xs sm:text-[13px] font-semibold text-huyen-lam transition-colors self-start sm:self-auto whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <span>Danh sách công việc</span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-lam-tri-tue" />
        </button>
      </div>

      {/* 2. Semantic 6-KPI Strip: Total + All 5 Official Statuses */}
      <section aria-label="Thống kê trạng thái công việc" className="space-y-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {statusKpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <button
                key={kpi.key}
                type="button"
                onClick={kpi.onClick}
                aria-label={kpi.ariaLabel}
                style={{
                  backgroundColor: kpi.bg,
                  borderColor: kpi.border,
                }}
                className="group relative overflow-hidden text-left rounded-xl border transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-[1px] hover:shadow-[0_10px_22px_-14px_rgba(20,36,63,0.22)] focus-visible:outline-2 focus-visible:outline-lam-tri-tue focus-visible:outline-offset-2 min-h-[82px] flex flex-col justify-between"
              >
                {/* Status / Brand hairline */}
                <span
                  aria-hidden="true"
                  className="block h-[2.5px] w-full shrink-0"
                  style={{ backgroundColor: kpi.accent }}
                />
                <div className="px-3 py-2.5 flex-1 flex flex-col justify-between gap-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      style={{ color: kpi.text }}
                      className="text-[12px] font-semibold leading-tight truncate"
                    >
                      {kpi.label}
                    </span>
                    <Icon
                      style={{ color: kpi.iconColor }}
                      className="w-3.5 h-3.5 shrink-0 opacity-85"
                      aria-hidden="true"
                    />
                  </div>

                  <div className="flex items-baseline justify-between gap-1.5">
                    <span
                      style={{ color: kpi.text }}
                      className="text-[22px] sm:text-[24px] font-bold font-mono-tabular leading-none tracking-tight"
                    >
                      {kpi.value}
                    </span>
                    <span
                      style={{ color: kpi.subText }}
                      className="text-[11px] leading-tight truncate"
                    >
                      {kpi.sub}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Secondary Operational Indicators Strip (Overdue, Missing Status, Overall Progress) */}
        <div className="bg-white border border-[#E5DFD2] rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Overdue KPI Indicator -> Filters directly to Overdue tasks */}
            <button
              type="button"
              onClick={() => onNavigateToTasks({ overdueOnly: true })}
              aria-label={`Quá hạn: ${stats.overdue} công việc. Lọc danh sách việc quá hạn`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors min-h-[34px] whitespace-nowrap ${
                stats.overdue > 0
                  ? 'bg-chu-sa-soft border-chu-sa-border text-chu-sa hover:bg-[#F3E2E1]'
                  : 'bg-[#FAF8F3] border-[#E5DFD2] text-[#5A6270] hover:bg-[#F3EFE6] hover:text-huyen-lam'
              }`}
            >
              <AlertTriangle
                className={`w-3.5 h-3.5 shrink-0 ${
                  stats.overdue > 0 ? 'text-chu-sa' : 'text-[#7D8796]'
                }`}
                aria-hidden="true"
              />
              <span className="tabular-nums">
                {stats.tasksWithDueDate === 0
                  ? 'Quá hạn: 0 (chưa đặt hạn)'
                  : `Quá hạn (${stats.overdue})`}
              </span>
            </button>

            {/* Missing Status Warning Indicator -> Strictly separate from Chưa bắt đầu */}
            {stats.missingStatus > 0 && (
              <button
                type="button"
                onClick={() => onNavigateToTasks({ status: '__unset__' })}
                aria-label={`Thiếu trạng thái: ${stats.missingStatus} công việc. Lọc các việc chưa có trạng thái`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E6C982] bg-[#FFF8E7] text-[#7C4D00] hover:bg-[#FCEFC9] text-xs font-semibold transition-colors min-h-[34px] whitespace-nowrap"
              >
                <AlertCircle
                  className="w-3.5 h-3.5 shrink-0 text-[#B7791F]"
                  aria-hidden="true"
                />
                <span className="tabular-nums">
                  Thiếu trạng thái ({stats.missingStatus})
                </span>
              </button>
            )}
          </div>

          {/* Overall Completion Progress Readout */}
          <div className="flex items-center gap-2.5 text-xs text-ink-muted shrink-0">
            <span className="whitespace-nowrap">
              Tiến độ chung:{' '}
              <strong className="font-mono-tabular font-semibold text-huyen-lam">
                {stats.completed}/{stats.total}
              </strong>{' '}
              <span className="font-mono-tabular text-[#606B7D]">
                ({stats.completionPercent}%)
              </span>
            </span>
            <div
              aria-hidden="true"
              className="w-20 sm:w-24 h-1.5 rounded-full bg-[#ECE7DA] overflow-hidden shrink-0"
            >
              <div
                className="h-full rounded-full bg-thanh-ngoc transition-all"
                style={{ width: `${stats.completionPercent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3. Deduplicated Watchlist: "Công việc cần theo dõi" (Full-width, balanced desktop & compact mobile) */}
      <section
        aria-label="Công việc cần theo dõi"
        className="bg-white border border-[#E5DFD2] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(20,36,63,0.03)]"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-[#FAF8F3]/85 border-b border-[#ECE7DA] flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[14.5px] sm:text-[15.5px] font-bold text-huyen-lam tracking-[-0.01em]">
                Công việc cần theo dõi
              </h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#F3EFE6] border border-[#E2DAC9] text-[11.5px] font-mono-tabular font-semibold text-huyen-lam">
                {watchlist.items.length} việc
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              {watchlistSummaryText}
            </p>
          </div>

          {watchlist.items.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              {watchlist.overdueCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateToTasks({ overdueOnly: true })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-chu-sa hover:bg-chu-sa-soft transition-colors whitespace-nowrap min-h-[34px]"
                >
                  <span>Lọc quá hạn</span>
                </button>
              )}
              {watchlist.pendingApprovalCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateToTasks({ status: 'Chờ duyệt' })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-lam-tri-tue hover:bg-[#EFEAE0] transition-colors whitespace-nowrap min-h-[34px]"
                >
                  <span>Lọc chờ duyệt</span>
                </button>
              )}
            </div>
          )}
        </div>

        {watchlist.items.length === 0 ? (
          <div className="px-4 py-7 sm:px-5 text-center space-y-1">
            <p className="text-sm font-medium text-huyen-lam">
              Hiện không có công việc nào quá hạn hoặc đang chờ duyệt.
            </p>
            <p className="text-xs text-ink-muted">
              Các công việc quá hạn xử lý hoặc chuyển sang Chờ duyệt sẽ tự động xuất hiện tại đây.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[#EFEAE0]">
              {visibleWatchlistItems.map((item) => {
                const { task } = item;
                const assigneeText = formatAssigneeSummary(task);

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelectTask(task.id)}
                    className="w-full text-left px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-[#FAF8F3] transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-lam-tri-tue group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                      {/* Left: Code + Title + Assignee + Reasons */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2 sm:block">
                          <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                            <span className="font-mono-tabular text-[11.5px] font-bold px-1.5 py-0.5 rounded bg-[#F3EFE6] text-huyen-lam shrink-0">
                              {task.displayCode}
                            </span>
                            <span className="text-[13.75px] sm:text-[14.5px] font-semibold text-huyen-lam group-hover:text-lam-tri-tue group-hover:underline decoration-minh-kim/65 underline-offset-4 leading-snug break-words">
                              {task.title}
                            </span>
                          </div>
                          {/* Mobile StatusBadge inline on first row */}
                          <div className="sm:hidden shrink-0 pt-0.5">
                            <StatusBadge status={task.status} compact soft />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                          <span className="inline-flex items-center gap-1 text-[#525F73]">
                            <Users
                              className="w-3.5 h-3.5 shrink-0 text-[#737E90]"
                              aria-hidden="true"
                            />
                            <span className="truncate max-w-[230px] sm:max-w-[300px]">
                              {assigneeText}
                            </span>
                          </span>

                          {item.isOverdue && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-chu-sa-border bg-chu-sa-soft text-chu-sa text-[11.5px] font-semibold font-mono-tabular whitespace-nowrap">
                              <AlertTriangle
                                className="w-3 h-3 shrink-0"
                                aria-hidden="true"
                              />
                              <span>
                                Quá hạn
                                {task.dueDate
                                  ? ` · ${formatShortDate(task.dueDate)}`
                                  : ''}
                              </span>
                            </span>
                          )}

                          {/* RBAC-safe approval cue: ONLY shown when currentUser actually has approval permission */}
                          {item.isPendingApproval && item.canCurrentUserApprove && (
                            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-minh-kim-ink whitespace-nowrap">
                              <Clock3
                                className="w-3.5 h-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>Cần bạn duyệt</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Desktop Right: StatusBadge + Quiet Chevron */}
                      <div className="hidden sm:flex items-center gap-2.5 shrink-0">
                        <StatusBadge status={task.status} compact soft />
                        <ChevronRight
                          className="w-4 h-4 text-[#8E96A3] group-hover:text-huyen-lam transition-colors shrink-0"
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {hasHiddenWatchlist && (
              <div className="px-4 py-2.5 sm:px-5 bg-[#FAF8F3]/60 border-t border-[#EFEAE0] flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setWatchlistExpanded((v) => !v)}
                  aria-expanded={watchlistExpanded}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-lam-tri-tue hover:text-huyen-lam hover:bg-[#EFEAE0] transition-colors min-h-[36px]"
                >
                  {watchlistExpanded ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                      <span>Thu gọn</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                      <span>Xem thêm {hiddenWatchlistCount} việc</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* 4. Compact Full-Width Collapsible Data Review Band (Eliminates 50/50 desktop gap) */}
      <section
        aria-label="Cần rà soát dữ liệu"
        className="bg-white border border-[#E5DFD2] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(20,36,63,0.03)]"
      >
        <div className="px-4 py-2.5 sm:px-5 sm:py-3 bg-[#FAF8F3]/75 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setReviewExpanded((v) => !v)}
            aria-expanded={reviewExpanded}
            className="flex items-center gap-2 text-left min-w-0 flex-1 py-0.5 min-h-[38px]"
          >
            {reviewExpanded ? (
              <ChevronDown
                className="w-4 h-4 text-[#606B7D] shrink-0"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="w-4 h-4 text-[#606B7D] shrink-0"
                aria-hidden="true"
              />
            )}
            <AlertCircle
              className={`w-4 h-4 shrink-0 ${
                stats.flaggedTasks.length > 0
                  ? 'text-minh-kim-ink'
                  : 'text-thanh-ngoc'
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <h2 className="text-[13.5px] sm:text-[14.5px] font-bold text-huyen-lam whitespace-nowrap">
                Cần rà soát ({stats.flaggedTasks.length})
              </h2>
              <span className="hidden sm:inline text-xs text-ink-muted truncate">
                {stats.flaggedTasks.length > 0
                  ? isManager
                    ? 'Thiếu trạng thái, thiếu người phụ trách hoặc thiếu liên kết gốc'
                    : 'Các mục dữ liệu đang chờ Quản trị viên rà soát'
                  : 'Dữ liệu hiện tại không có cảnh báo cần rà soát'}
              </span>
            </div>
          </button>

          {stats.flaggedTasks.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigateToTasks({ reviewOnly: true })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E2DAC9] bg-white hover:bg-[#FAF8F3] text-xs font-semibold text-huyen-lam hover:text-lam-tri-tue whitespace-nowrap shrink-0 min-h-[34px] transition-colors"
            >
              <span>Lọc ({stats.flaggedTasks.length})</span>
            </button>
          )}
        </div>

        {reviewExpanded && (
          <div className="border-t border-[#ECE7DA]">
            {stats.flaggedTasks.length === 0 ? (
              <div className="px-4 py-4 sm:px-5 text-xs sm:text-sm text-ink-muted">
                Không có đầu việc nào bị gắn cờ rà soát.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 bg-white">
                {stats.flaggedTasks.map((task, idx) => {
                  const reviewSummary = getTaskDataReviewSummary(task);
                  const isLeftCol = idx % 2 === 0;
                  return (
                    <button
                      key={`flag_${task.id}`}
                      type="button"
                      onClick={() => onSelectTask(task.id)}
                      className={`w-full text-left bg-white hover:bg-[#FAF8F3] px-4 py-3 sm:px-5 transition-colors flex items-start justify-between gap-3 min-h-[56px] border-b border-[#EFEAE0] ${
                        isLeftCol ? 'lg:border-r lg:border-r-[#EFEAE0]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-mono-tabular text-[11.5px] font-bold text-huyen-lam shrink-0">
                            {task.displayCode}
                          </span>
                          <span className="text-[13.5px] font-medium text-huyen-lam break-words leading-snug">
                            {task.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {reviewSummary.dataFlags.length > 0 ? (
                            <>
                              <ReviewBadge task={task} />
                              <span className="text-[11.5px] text-[#606B7D] truncate">
                                {reviewSummary.dataFlagLabels.join(' · ')}
                              </span>
                            </>
                          ) : reviewSummary.isMissingStatus ? (
                            <span className="text-[11.5px] text-[#7C4D00]">
                              Chưa chọn trạng thái tiến độ
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <StatusBadge status={task.status} compact soft />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 5. Parent Groups Summary (Dynamic count, Progress + Chi tiết + Xem việc con) */}
      <section
        aria-label="Danh sách nhóm công việc chính"
        className="bg-white border border-[#E5DFD2] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(20,36,63,0.03)]"
      >
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-[#FAF8F3]/85 border-b border-[#ECE7DA] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h2 className="text-[14.5px] sm:text-[15.5px] font-bold text-huyen-lam tracking-[-0.01em]">
            {stats.parentTasks.length} nhóm công việc chính
          </h2>
          <span className="text-xs text-ink-muted">
            Mở chi tiết nhóm cha hoặc chuyển thẳng đến danh sách việc con
          </span>
        </div>

        {stats.parentTasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">
            Chưa có công việc nào trên hệ thống.
          </div>
        ) : (
          <div className="divide-y divide-[#EFEAE0]">
            {stats.parentTasks.map((parent) => {
              const prog = computeParentProgress(parent.id, stats.activeTasks);
              const hasChildren = prog.total > 0;
              const isParentDone = hasChildren && prog.completed === prog.total;
              const effCat = getEffectiveCategory(
                parent,
                stats.activeTasks,
                categories
              );
              const catTheme = getCategoryVisualTheme(
                effCat.categoryId,
                effCat.category,
                effCat.color
              );
              const assigneeText = formatAssigneeSummary(parent);

              return (
                <div
                  key={parent.id}
                  className="px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-[#FAF8F3]/75 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 lg:gap-4"
                >
                  {/* Group Info: Code + Title + Category + Official Assignee */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectTask(parent.id)}
                        className="text-left min-w-0 flex-1 group focus-visible:outline-2 focus-visible:outline-lam-tri-tue rounded-sm"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span
                            style={{ color: catTheme.text }}
                            className="font-mono-tabular text-[12px] font-bold shrink-0"
                          >
                            {parent.displayCode}
                          </span>
                          <span className="text-[14px] sm:text-[14.75px] font-semibold text-huyen-lam group-hover:text-lam-tri-tue group-hover:underline decoration-minh-kim/65 underline-offset-4 leading-snug break-words">
                            {parent.title}
                          </span>
                        </div>
                      </button>

                      {/* Mobile StatusBadge on right of first line, zero overlap */}
                      <div className="lg:hidden shrink-0 pt-0.5">
                        <StatusBadge status={parent.status} compact soft />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                      <CategoryChip
                        categoryId={effCat.categoryId}
                        categoryName={effCat.category}
                        color={effCat.color}
                      />
                      <span className="inline-flex items-center gap-1 text-[#525F73] min-w-0">
                        <Users
                          className="w-3.5 h-3.5 shrink-0 text-[#737E90]"
                          aria-hidden="true"
                        />
                        <span className="truncate max-w-[200px] sm:max-w-[280px]">
                          {assigneeText}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Right Side: Progress + Desktop StatusBadge + Action Buttons */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-2.5 sm:gap-3 shrink-0 pt-1 lg:pt-0 border-t border-[#F2EDE3] lg:border-t-0">
                    {/* Child Progress Bar (only when group has children) */}
                    {hasChildren ? (
                      <div className="inline-flex items-center gap-2 shrink-0">
                        <div
                          aria-hidden="true"
                          className="w-16 sm:w-20 h-1.5 rounded-full bg-[#EAE5D9] overflow-hidden"
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${prog.percentage}%`,
                              backgroundColor: isParentDone
                                ? '#328578'
                                : catTheme.accent,
                            }}
                          />
                        </div>
                        <span
                          className={`text-xs font-mono-tabular font-semibold whitespace-nowrap ${
                            isParentDone
                              ? 'text-thanh-ngoc-ink'
                              : 'text-huyen-lam'
                          }`}
                        >
                          {prog.completed}/{prog.total}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-[#647082] whitespace-nowrap">
                        Việc độc lập
                      </span>
                    )}

                    {/* Desktop StatusBadge */}
                    <div className="hidden lg:flex items-center shrink-0">
                      <StatusBadge
                        status={parent.status}
                        compact
                        soft
                        className="min-w-[116px]"
                      />
                    </div>

                    {/* Smart Navigation Actions: Xem việc con + Chi tiết */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateToTasks({ focusParentId: parent.id })
                          }
                          aria-label={`Xem ${prog.total} việc con của nhóm ${parent.displayCode}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D8D0BF] bg-[#FAF8F3] hover:bg-[#F0EAE0] text-xs font-semibold text-huyen-lam transition-colors whitespace-nowrap min-h-[36px]"
                        >
                          <ListTree
                            className="w-3.5 h-3.5 shrink-0 text-lam-tri-tue"
                            aria-hidden="true"
                          />
                          <span>Xem việc con</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectTask(parent.id)}
                        aria-label={`Mở chi tiết công việc cha ${parent.displayCode}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#E2DAC9] hover:bg-white text-xs font-semibold text-lam-tri-tue hover:text-huyen-lam transition-colors whitespace-nowrap min-h-[36px]"
                      >
                        <PanelRightOpen
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Chi tiết</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
