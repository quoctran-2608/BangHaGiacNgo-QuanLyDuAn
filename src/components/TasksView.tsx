import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  CornerDownRight,
  ExternalLink,
  FileCheck2,
  Library,
  Link2Off,
  ListTree,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { CategoryItem, ProjectMember, TaskItem } from '../types/project';
import {
  ALL_STATUSES,
  canUserCreateSubtask,
  computeParentProgress,
  formatShortDate,
  getCategoryVisualTheme,
  getDocumentDisplayLabel,
  getDocumentSourceLabel,
  getEffectiveCategory,
  getOfficialMemberDisplayName,
  getTaskDataReviewSummary,
  isB1TestTask,
  isTaskOverdue,
  resolveParentExpandedState,
  resolveTaskAssignees,
  summarizeChildAttention,
} from '../utils/taskHelpers';
import { isReplacedTemporaryAccountEmail } from '../utils/memberMapping';
import { CategoryChip } from './CategoryChip';
import { ReviewBadge } from './ReviewBadge';
import { StatusBadge } from './StatusBadge';

interface TasksViewProps {
  tasks: TaskItem[];
  categories: CategoryItem[];
  currentUser: ProjectMember;
  members?: ProjectMember[];
  directoryUnavailable?: boolean;
  initialStatusFilter?: string;
  initialCategoryFilter?: string;
  initialReviewOnly?: boolean;
  onSelectTask: (taskId: string) => void;
  onOpenNewTask: (defaultParentId?: string | null) => void;
  onNavigateToDocuments?: () => void;
}

const DESKTOP_GRID_COLS =
  'lg:grid lg:grid-cols-[minmax(0,2.3fr)_136px_minmax(0,1fr)_minmax(0,1.08fr)_90px] xl:grid-cols-[minmax(0,1fr)_148px_174px_206px_98px] lg:items-center lg:gap-3 xl:gap-4';

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  categories,
  currentUser,
  members = [],
  directoryUnavailable = false,
  initialStatusFilter = 'all',
  initialCategoryFilter = 'all',
  initialReviewOnly = false,
  onSelectTask,
  onOpenNewTask,
  onNavigateToDocuments,
}) => {
  const isManager =
    (currentUser.role === 'admin' || currentUser.role === 'moderator') &&
    currentUser.isActive;
  const canCreate = canUserCreateSubtask(currentUser);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [categoryFilter, setCategoryFilter] = useState<string>(
    initialCategoryFilter
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [reviewOnly, setReviewOnly] = useState<boolean>(initialReviewOnly);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({
    tbhgn_3: true,
    tbhgn_4: true,
    tbhgn_5: true,
  });
  const [filterExpansionOverrides, setFilterExpansionOverrides] = useState<
    Record<string, boolean>
  >({});

  const filterBarRef = useRef<HTMLDivElement | null>(null);
  const columnHeaderRef = useRef<HTMLDivElement | null>(null);
  const stickyPopoverRef = useRef<HTMLDivElement | null>(null);
  const mobileFilterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [showStickyColumnHeader, setShowStickyColumnHeader] = useState(false);
  const [stickyTop, setStickyTop] = useState(0);
  const [stickyFilterOpen, setStickyFilterOpen] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [openLinkMenu, setOpenLinkMenu] = useState<{
    taskId: string;
    group: 'reference' | 'result';
  } | null>(null);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories]
  );

  const visiblePool = useMemo(() => {
    return tasks.filter(
      (t) => !isB1TestTask(t) && (showArchived ? true : !t.archivedAt)
    );
  }, [tasks, showArchived]);

  const assigneeOptions = useMemo(() => {
    const referencedUids = new Set<string>();
    visiblePool.forEach((t) => {
      (t.assigneeUids ?? []).forEach((uid) => {
        if (uid) referencedUids.add(uid);
      });
    });

    const eligible = members.filter(
      (m) =>
        (m.isActive &&
          m.role !== 'viewer' &&
          !isReplacedTemporaryAccountEmail(m.email)) ||
        referencedUids.has(m.uid)
    );

    const nameCounts = new Map<string, number>();
    eligible.forEach((m) => {
      const key = getOfficialMemberDisplayName(m).toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    });

    return eligible
      .map((m) => {
        const baseName = getOfficialMemberDisplayName(m);
        const isDup = (nameCounts.get(baseName.toLowerCase()) ?? 0) > 1;
        const emailPrefix = m.email?.split('@')[0]?.trim();
        let label = baseName;
        if (isDup && emailPrefix) {
          label = `${label} (${emailPrefix})`;
        }
        if (!m.isActive) {
          label = `${label} (Đã khóa)`;
        }
        return { uid: m.uid, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }, [members, visiblePool]);

  const hasCollectiveGroupTasks = useMemo(
    () =>
      visiblePool.some(
        (t) => resolveTaskAssignees(t, members).isCollectiveGroup
      ),
    [visiblePool, members]
  );

  const reviewFlagCount = useMemo(
    () =>
      visiblePool.filter((t) => getTaskDataReviewSummary(t).hasAnyIssue).length,
    [visiblePool]
  );

  const unlinkedUidCount = useMemo(
    () =>
      visiblePool.filter(
        (t) => resolveTaskAssignees(t, members).isUnlinkedAccount
      ).length,
    [visiblePool, members]
  );

  const hasActiveFilter =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    assigneeFilter !== 'all' ||
    reviewOnly;

  const filterSignature = `${searchQuery.trim().toLowerCase()}|${statusFilter}|${categoryFilter}|${assigneeFilter}|${reviewOnly ? '1' : '0'}`;

  useEffect(() => {
    setFilterExpansionOverrides({});
  }, [filterSignature]);

  const hasChildRestrictingFilter =
    statusFilter !== 'all' || assigneeFilter !== 'all' || reviewOnly;

  const matchesFilter = (task: TaskItem): boolean => {
    const resolved = resolveTaskAssignees(task, members);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const effForSearch = getEffectiveCategory(task, visiblePool, categories);
      const hay = [
        task.displayCode,
        task.title,
        resolved.searchText,
        task.nextStep ?? '',
        task.notes ?? '',
        effForSearch.category ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (statusFilter !== 'all') {
      if (statusFilter === '__unset__') {
        if (task.status !== null) return false;
      } else if (task.status !== statusFilter) {
        return false;
      }
    }

    if (categoryFilter !== 'all') {
      const eff = getEffectiveCategory(task, visiblePool, categories);
      if (categoryFilter === '__uncategorized__') {
        if (eff.categoryId || eff.category) return false;
      } else if (eff.categoryId !== categoryFilter) {
        return false;
      }
    }

    if (assigneeFilter !== 'all') {
      if (assigneeFilter === '__unassigned__') {
        if (!resolved.isUnassigned) {
          return false;
        }
      } else if (assigneeFilter === '__unlinked_uid__') {
        if (!resolved.isUnlinkedAccount) {
          return false;
        }
      } else if (assigneeFilter === '__collective__') {
        if (!resolved.isCollectiveGroup) {
          return false;
        }
      } else if (!(task.assigneeUids ?? []).includes(assigneeFilter)) {
        return false;
      }
    }

    if (reviewOnly && !getTaskDataReviewSummary(task).hasAnyIssue) {
      return false;
    }

    return true;
  };

  const parentTasks = useMemo(() => {
    return visiblePool
      .filter((t) => t.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [visiblePool]);

  const childrenByParent = useMemo(() => {
    const map: Record<string, TaskItem[]> = {};
    visiblePool
      .filter((t) => t.parentId !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((child) => {
        if (!child.parentId) return;
        if (!map[child.parentId]) map[child.parentId] = [];
        map[child.parentId].push(child);
      });
    return map;
  }, [visiblePool]);

  const filteredTree = useMemo(() => {
    return parentTasks
      .map((parent) => {
        const children = childrenByParent[parent.id] || [];
        const parentMatches = matchesFilter(parent);
        const matchingChildren = children.filter(matchesFilter);

        if (!hasActiveFilter) {
          return { parent, children, autoExpand: false };
        }
        if (matchingChildren.length > 0) {
          return {
            parent,
            children: matchingChildren,
            autoExpand: true,
          };
        }
        if (parentMatches) {
          return {
            parent,
            children: hasChildRestrictingFilter ? [] : children,
            autoExpand: false,
          };
        }
        return null;
      })
      .filter(Boolean) as Array<{
      parent: TaskItem;
      children: TaskItem[];
      autoExpand: boolean;
    }>;
  }, [
    parentTasks,
    childrenByParent,
    hasActiveFilter,
    hasChildRestrictingFilter,
    searchQuery,
    statusFilter,
    categoryFilter,
    assigneeFilter,
    reviewOnly,
    visiblePool,
    categories,
    members,
  ]);

  const parentsWithVisibleChildren = useMemo(
    () => filteredTree.filter((item) => item.children.length > 0),
    [filteredTree]
  );

  const getIsExpanded = (
    parentId: string,
    hasVisibleChildren: boolean,
    autoExpand: boolean
  ) =>
    resolveParentExpandedState({
      parentId,
      hasVisibleChildren,
      hasActiveFilter,
      autoExpand,
      expandedParents,
      filterOverrides: filterExpansionOverrides,
    });

  const allExpanded =
    parentsWithVisibleChildren.length > 0 &&
    parentsWithVisibleChildren.every((item) =>
      getIsExpanded(item.parent.id, item.children.length > 0, item.autoExpand)
    );

  const visibleChildCount = useMemo(
    () => filteredTree.reduce((sum, item) => sum + item.children.length, 0),
    [filteredTree]
  );
  const expandedChildCount = useMemo(
    () =>
      filteredTree.reduce(
        (sum, item) =>
          sum +
          (getIsExpanded(
            item.parent.id,
            item.children.length > 0,
            item.autoExpand
          )
            ? item.children.length
            : 0),
        0
      ),
    [filteredTree, hasActiveFilter, expandedParents, filterExpansionOverrides]
  );
  const visibleTotalCount = filteredTree.length + visibleChildCount;

  const toggleParent = (parentId: string, currentExpanded: boolean) => {
    const nextState = !currentExpanded;
    if (hasActiveFilter) {
      setFilterExpansionOverrides((prev) => ({
        ...prev,
        [parentId]: nextState,
      }));
      return;
    }
    setExpandedParents((prev) => ({
      ...prev,
      [parentId]: nextState,
    }));
  };

  const toggleExpandAll = () => {
    const nextState = !allExpanded;
    if (hasActiveFilter) {
      const nextOverrides: Record<string, boolean> = {
        ...filterExpansionOverrides,
      };
      parentsWithVisibleChildren.forEach(({ parent }) => {
        nextOverrides[parent.id] = nextState;
      });
      setFilterExpansionOverrides(nextOverrides);
      return;
    }
    const nextMap: Record<string, boolean> = { ...expandedParents };
    parentsWithVisibleChildren.forEach(({ parent }) => {
      nextMap[parent.id] = nextState;
    });
    setExpandedParents(nextMap);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setAssigneeFilter('all');
    setReviewOnly(false);
  };

  useEffect(() => {
    let rafId = 0;

    const evaluateStickyState = () => {
      rafId = 0;
      const filterEl = filterBarRef.current;
      const appHeader = document.querySelector('header');
      const appHeaderBottom = appHeader
        ? appHeader.getBoundingClientRect().bottom
        : 0;
      const nextStickyTop =
        appHeaderBottom > 1 ? Math.max(0, Math.floor(appHeaderBottom) - 1) : 0;

      setStickyTop((prev) => (prev === nextStickyTop ? prev : nextStickyTop));

      if (!filterEl || window.scrollY < 40) {
        setShowStickyBar(false);
        setShowStickyColumnHeader(false);
        return;
      }

      const filterBottom = filterEl.getBoundingClientRect().bottom;
      const showThreshold = nextStickyTop + 12;
      const hideThreshold = nextStickyTop + 24;
      setShowStickyBar((prev) => {
        if (!prev && filterBottom <= showThreshold) return true;
        if (prev && filterBottom > hideThreshold) return false;
        return prev;
      });

      const isDesktop = window.innerWidth >= 1024;
      const headerEl = columnHeaderRef.current;
      if (!isDesktop || !headerEl) {
        setShowStickyColumnHeader(false);
        return;
      }
      const headerTop = headerEl.getBoundingClientRect().top;
      const colStickyThreshold = nextStickyTop + 44;
      setShowStickyColumnHeader((prev) => {
        if (filterBottom > hideThreshold) return false;
        if (!prev && headerTop <= colStickyThreshold) return true;
        if (prev && headerTop > colStickyThreshold + 10) return false;
        return prev;
      });
    };

    const handleScrollOrResize = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(evaluateStickyState);
      }
    };

    evaluateStickyState();
    window.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [filteredTree.length, mobileFilterOpen]);

  useEffect(() => {
    if (!showStickyBar) {
      setStickyFilterOpen(false);
    } else {
      setMobileFilterOpen(false);
    }
  }, [showStickyBar]);

  useEffect(() => {
    if (!mobileFilterOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileFilterOpen(false);
        mobileFilterBtnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileFilterOpen]);

  useEffect(() => {
    if (!stickyFilterOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        stickyPopoverRef.current &&
        !stickyPopoverRef.current.contains(e.target as Node)
      ) {
        setStickyFilterOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStickyFilterOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [stickyFilterOpen]);

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

  const scrollToTop = () => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      toneClass: string;
      onRemove: () => void;
    }> = [];

    if (statusFilter !== 'all') {
      chips.push({
        key: 'status',
        label:
          statusFilter === '__unset__'
            ? 'TT: Thiếu trạng thái'
            : `TT: ${statusFilter}`,
        toneClass:
          'bg-lam-sang-soft border-lam-sang/40 text-lam-sang-ink hover:bg-lam-sang/15',
        onRemove: () => setStatusFilter('all'),
      });
    }

    if (categoryFilter !== 'all') {
      const catLabel =
        categoryFilter === '__uncategorized__'
          ? 'Chưa phân hạng mục'
          : categories.find((c) => c.id === categoryFilter)?.name ??
            categoryFilter;
      chips.push({
        key: 'category',
        label: `HM: ${catLabel}`,
        toneClass:
          'bg-thanh-ngoc-soft border-thanh-ngoc/40 text-thanh-ngoc-ink hover:bg-thanh-ngoc/15',
        onRemove: () => setCategoryFilter('all'),
      });
    }

    if (assigneeFilter !== 'all') {
      const matchedOpt = assigneeOptions.find((o) => o.uid === assigneeFilter);
      const matchedMember = members.find((m) => m.uid === assigneeFilter);
      const assigneeLabel =
        assigneeFilter === '__unassigned__'
          ? 'Chưa phân công'
          : assigneeFilter === '__unlinked_uid__'
          ? 'Chưa liên kết TK'
          : assigneeFilter === '__collective__'
          ? 'Việc nhóm'
          : matchedOpt?.label ??
            (matchedMember
              ? `${getOfficialMemberDisplayName(matchedMember)}${
                  !matchedMember.isActive ? ' (Đã khóa)' : ''
                }`
              : 'Tài khoản không xác định');
      chips.push({
        key: 'assignee',
        label: `PT: ${assigneeLabel}`,
        toneClass:
          'bg-minh-kim-soft border-minh-kim-border text-minh-kim-ink hover:bg-minh-kim/15',
        onRemove: () => setAssigneeFilter('all'),
      });
    }

    return chips;
  }, [
    statusFilter,
    categoryFilter,
    assigneeFilter,
    categories,
    assigneeOptions,
    members,
  ]);

  const activeDropdownFilterCount = activeFilterChips.length;
  const activePanelFilterCount =
    activeDropdownFilterCount + (reviewOnly ? 1 : 0);

  const renderAssigneeCell = (task: TaskItem) => {
    const resolved = resolveTaskAssignees(task, members);

    if (resolved.isUnassigned) {
      return (
        <span className="text-[12.5px] text-[#647082]">
          Chưa phân công
        </span>
      );
    }

    const visibleMembers = resolved.assignedMembers.slice(0, 2);
    const overflowCount = Math.max(0, resolved.assignedMembers.length - 2);
    const fullAssignedNamesTooltip = resolved.assignedMembers
      .map((am) => (am.isActive ? am.displayName : `${am.displayName} (Đã khóa)`))
      .join(', ');

    return (
      <div className="min-w-0 inline-flex items-center gap-1.5 flex-wrap">
        {visibleMembers.length > 0 && (
          <span
            title={overflowCount > 0 ? fullAssignedNamesTooltip : undefined}
            className="text-[13px] font-medium leading-snug break-words inline-flex items-center gap-1 flex-wrap"
          >
            <span>
              {visibleMembers.map((am, idx) => (
                <React.Fragment key={am.uid}>
                  {idx > 0 && <span className="text-[#6E7889]">, </span>}
                  <span
                    className={
                      am.isActive ? 'text-huyen-lam' : 'text-[#7D8796]'
                    }
                  >
                    {am.displayName}
                    {!am.isActive ? ' (Đã khóa)' : ''}
                  </span>
                </React.Fragment>
              ))}
            </span>
            {overflowCount > 0 && (
              <span
                title={fullAssignedNamesTooltip}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#F3EFE6] border border-[#DFD8CA] text-huyen-lam text-[11px] font-semibold font-mono-tabular whitespace-nowrap"
              >
                +{overflowCount}
              </span>
            )}
          </span>
        )}
        {resolved.unknownUidCount > 0 &&
          (directoryUnavailable ? (
            <span
              title="Chưa tải được danh bạ thành viên"
              className="text-[12.5px] text-[#647082]"
            >
              {visibleMembers.length > 0
                ? `+${resolved.unknownUidCount}`
                : '—'}
            </span>
          ) : (
            <span className="text-[12.5px] font-medium text-[#7D8796]">
              {resolved.unknownUidCount === 1
                ? 'Tài khoản không xác định'
                : `Tài khoản không xác định (${resolved.unknownUidCount})`}
            </span>
          ))}
        {resolved.isUnlinkedAccount && (
          <span
            title="Chưa liên kết tài khoản Google (UID)"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-minh-kim-ink"
          >
            <Link2Off className="w-3.5 h-3.5 shrink-0" />
            <span>Chưa liên kết tài khoản</span>
          </span>
        )}
        {resolved.isCollectiveGroup && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#EFF7F5] border border-[#C9E2DD] text-[#1D5950] text-[11px] font-semibold whitespace-nowrap">
            Việc nhóm
          </span>
        )}
      </div>
    );
  };

  const renderDueDateCell = (task: TaskItem, alignRight: boolean) => {
    if (!task.dueDate) {
      return (
        <span
          className={`text-[13px] font-mono-tabular text-[#D6D0C4] select-none ${
            alignRight ? 'block text-right' : ''
          }`}
        >
          —
        </span>
      );
    }
    const overdue = isTaskOverdue(task);
    return (
      <span
        className={`text-[12.5px] font-mono-tabular whitespace-nowrap ${
          alignRight ? 'block text-right' : ''
        } ${
          overdue ? 'text-chu-sa font-semibold' : 'text-[#525F73]'
        }`}
        title={overdue ? 'Quá hạn xử lý' : undefined}
      >
        {formatShortDate(task.dueDate)}
      </span>
    );
  };

  const renderSingleGroupLinkTrigger = (
    task: TaskItem,
    group: 'reference' | 'result'
  ) => {
    const rawLinks =
      group === 'reference' ? task.referenceLinks : task.resultLinks;
    const validLinks = rawLinks.filter((l) => Boolean(l.url));
    if (validLinks.length === 0) return null;

    const isReference = group === 'reference';
    const Icon = isReference ? BookOpen : FileCheck2;
    const labelText = isReference
      ? `${validLinks.length} tham khảo`
      : `${validLinks.length} kết quả`;
    const colorClass = isReference
      ? 'text-lam-sang-ink hover:text-huyen-lam decoration-lam-sang/45'
      : 'text-thanh-ngoc-ink hover:text-huyen-lam decoration-thanh-ngoc/45';
    const menuHeading = isReference
      ? 'Tài liệu cần đọc / tham khảo'
      : 'Kết quả nghiên cứu';

    if (validLinks.length === 1) {
      const primary = validLinks[0];
      const primaryDisplay = getDocumentDisplayLabel(primary);
      const sourceLabel = getDocumentSourceLabel(primary.url);
      return (
        <a
          key={`${task.id}_${group}`}
          href={primary.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`${primaryDisplay.text} (${sourceLabel})`}
          aria-label={`${menuHeading}: ${primaryDisplay.text}`}
          className={`inline-flex items-center gap-1 text-xs font-medium hover:underline underline-offset-2 whitespace-nowrap shrink-0 transition-colors ${colorClass}`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0 opacity-90" />
          <span className="tabular-nums">{labelText}</span>
        </a>
      );
    }

    const isOpen =
      openLinkMenu?.taskId === task.id && openLinkMenu.group === group;

    return (
      <div
        key={`${task.id}_${group}`}
        className="relative inline-flex items-center"
        data-link-popover-root
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenLinkMenu((prev) =>
              prev?.taskId === task.id && prev.group === group
                ? null
                : { taskId: task.id, group }
            );
          }}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={`Mở danh sách ${validLinks.length} ${
            isReference ? 'tài liệu tham khảo' : 'kết quả nghiên cứu'
          }`}
          className={`inline-flex items-center gap-1 text-xs font-medium rounded px-1 -mx-1 py-0.5 hover:bg-[#F3EFE6] whitespace-nowrap shrink-0 transition-colors ${colorClass}`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0 opacity-90" />
          <span className="tabular-nums">{labelText}</span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform duration-150 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div
            role="menu"
            aria-label={menuHeading}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full mt-1.5 z-40 w-[264px] sm:w-[296px] max-w-[calc(100vw-2.5rem)] bg-trang-nga border border-[#DFD8CA] rounded-xl shadow-[0_14px_32px_-8px_rgba(20,36,63,0.24)] p-1.5 space-y-0.5"
          >
            <div className="px-2.5 py-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#5E697A] border-b border-[#EFEAE0] mb-0.5">
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  isReference ? 'text-lam-sang-ink' : 'text-thanh-ngoc-ink'
                }`}
              />
              <span>{menuHeading}</span>
            </div>
            {validLinks.map((lnk) => {
              const display = getDocumentDisplayLabel(lnk);
              const source = getDocumentSourceLabel(lnk.url);
              return (
                <a
                  key={lnk.id}
                  role="menuitem"
                  href={lnk.url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenLinkMenu(null);
                  }}
                  className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#FAF8F3] transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs truncate ${
                        display.isPlaceholder
                          ? 'text-[#6E7889] italic group-hover:text-lam-tri-tue'
                          : 'font-medium text-huyen-lam group-hover:text-lam-tri-tue'
                      }`}
                    >
                      {display.text}
                    </div>
                    <div className="text-[11px] text-[#7D8796] truncate">
                      {source}
                    </div>
                  </div>
                  <ExternalLink
                    className="w-3.5 h-3.5 text-[#8A94A3] group-hover:text-lam-tri-tue shrink-0"
                    aria-hidden="true"
                  />
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTaskLinkActions = (task: TaskItem) => {
    const refTrigger = renderSingleGroupLinkTrigger(task, 'reference');
    const resTrigger = renderSingleGroupLinkTrigger(task, 'result');
    if (!refTrigger && !resTrigger) return null;

    return (
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {refTrigger}
        {refTrigger && resTrigger && (
          <span className="text-[#D4CCB9] select-none" aria-hidden="true">
            ·
          </span>
        )}
        {resTrigger}
      </span>
    );
  };

  return (
    <>
      {/* Sticky Compact Toolbar + Desktop Sticky Column Header (flush at top when scrolled) */}
      <div
        aria-hidden={!showStickyBar}
        style={{ top: `${stickyTop}px` }}
        className={`fixed left-0 lg:left-60 right-0 z-20 transition-[opacity,transform] duration-150 ease-out ${
          showStickyBar
            ? 'opacity-100 translate-y-0 pointer-events-auto visible'
            : 'opacity-0 -translate-y-1.5 pointer-events-none invisible'
        }`}
      >
        <div
          ref={stickyPopoverRef}
          className="bg-[#FFFDFC]/90 backdrop-blur-md border-b border-[#E8E2D6]/75 shadow-[0_2px_8px_-3px_rgba(20,36,63,0.05)]"
        >
          <div className="max-w-6xl mx-auto px-3 sm:px-6 relative">
            {/* Slim Compact Toolbar Row: 42px mobile / 44px desktop */}
            <div className="h-[42px] lg:h-[44px] flex items-center gap-1 sm:gap-1.5">
              {/* 1. Compact Search */}
              <div className="relative flex-1 min-w-0 lg:flex-initial lg:w-56 xl:w-64">
                <Search className="w-3.5 h-3.5 text-[#8A94A3] absolute left-2 sm:left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  tabIndex={showStickyBar ? 0 : -1}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm mã, tên, phụ trách..."
                  aria-label="Tìm kiếm nhanh công việc"
                  className="w-full h-[34px] lg:h-[36px] pl-7 pr-6 sm:pl-8 sm:pr-7 text-xs sm:text-[13px] bg-[#FAF8F3]/90 border border-[#E4DED1] rounded-lg text-huyen-lam placeholder:text-[#8E96A3] focus:outline-none focus:ring-2 focus:ring-lam-sang/25 focus:border-lam-sang focus:bg-white transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    tabIndex={showStickyBar ? 0 : -1}
                    onClick={() => setSearchQuery('')}
                    aria-label="Xóa từ khóa tìm kiếm"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded text-[#7D8796] hover:text-huyen-lam"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                  </button>
                )}
              </div>

              {/* 2. Open Filter Popover Button */}
              <button
                type="button"
                tabIndex={showStickyBar ? 0 : -1}
                onClick={() => setStickyFilterOpen((v) => !v)}
                aria-expanded={stickyFilterOpen}
                aria-label="Mở bộ lọc nhanh"
                className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 h-[34px] lg:h-[36px] min-w-[34px] sm:min-w-[38px] px-2 sm:px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  stickyFilterOpen || activeDropdownFilterCount > 0
                    ? 'bg-lam-sang-soft border-lam-sang/45 text-lam-sang-ink font-semibold'
                    : 'bg-white/90 border-[#E4DED1] text-huyen-lam hover:bg-[#FAF8F3]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>Lọc</span>
                {activeDropdownFilterCount > 0 && (
                  <span className="font-mono-tabular text-[11px] font-bold px-1.5 py-0.5 rounded bg-lam-sang text-white leading-none">
                    {activeDropdownFilterCount}
                  </span>
                )}
              </button>

              {/* 3. Active Filter Chips (Desktop inline) */}
              {activeFilterChips.length > 0 && (
                <div className="hidden lg:flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto">
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      tabIndex={showStickyBar ? 0 : -1}
                      onClick={chip.onRemove}
                      title={`Bỏ lọc: ${chip.label}`}
                      className={`inline-flex items-center gap-1 h-[28px] px-2 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 max-w-[170px] ${chip.toneClass}`}
                    >
                      <span className="truncate">{chip.label}</span>
                      <X className="w-3 h-3 shrink-0" />
                    </button>
                  ))}
                  {hasActiveFilter && (
                    <button
                      type="button"
                      tabIndex={showStickyBar ? 0 : -1}
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 h-[28px] px-2 text-[11px] font-semibold text-chu-sa hover:bg-chu-sa-soft rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3 h-3 shrink-0" />
                      <span>Xóa lọc</span>
                    </button>
                  )}
                </div>
              )}

              {/* Spacer on desktop when no chips */}
              {activeFilterChips.length === 0 && (
                <div className="hidden lg:block flex-1" />
              )}

              {/* 4. Cần rà soát toggle */}
              <button
                type="button"
                tabIndex={showStickyBar ? 0 : -1}
                onClick={() => setReviewOnly((v) => !v)}
                aria-pressed={reviewOnly}
                aria-label="Lọc việc cần rà soát"
                title={`Cần rà soát${reviewFlagCount > 0 ? ` (${reviewFlagCount})` : ''}`}
                className={`inline-flex items-center justify-center gap-1.5 h-[34px] lg:h-[36px] w-[34px] sm:w-auto sm:min-w-[38px] px-0 sm:px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  reviewOnly
                    ? 'bg-huyen-lam border-huyen-lam text-kim-quang font-semibold'
                    : 'bg-white/90 border-[#E4DED1] text-huyen-lam hover:bg-[#FAF8F3]'
                }`}
              >
                <AlertCircle
                  className={`w-3.5 h-3.5 shrink-0 ${
                    reviewOnly ? 'text-kim-quang' : 'text-minh-kim-ink'
                  }`}
                />
                <span className="hidden sm:inline">Cần rà soát</span>
              </button>

              {/* 5. Expand / Collapse All */}
              {parentsWithVisibleChildren.length > 0 && (
                <button
                  type="button"
                  tabIndex={showStickyBar ? 0 : -1}
                  onClick={toggleExpandAll}
                  aria-label={
                    allExpanded ? 'Thu gọn việc con' : 'Mở tất cả việc con'
                  }
                  title={
                    allExpanded ? 'Thu gọn việc con' : 'Mở tất cả việc con'
                  }
                  className="inline-flex items-center justify-center gap-1.5 h-[34px] lg:h-[36px] w-[34px] sm:w-auto sm:min-w-[38px] px-0 sm:px-2.5 text-xs font-medium rounded-lg border border-[#E4DED1] bg-white/90 text-huyen-lam hover:bg-[#FAF8F3] transition-colors whitespace-nowrap shrink-0"
                >
                  {allExpanded ? (
                    <>
                      <ChevronsDownUp className="w-3.5 h-3.5 shrink-0 text-[#667285]" />
                      <span className="hidden md:inline">Thu gọn</span>
                    </>
                  ) : (
                    <>
                      <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-lam-sang" />
                      <span className="hidden md:inline">Mở con</span>
                    </>
                  )}
                </button>
              )}

              {/* 6. Visible Count */}
              <div
                className="font-mono-tabular text-[11px] sm:text-xs font-semibold text-huyen-lam px-0.5 sm:px-1.5 whitespace-nowrap shrink-0 tabular-nums"
                title={`Đang xem ${visibleTotalCount} trên ${visiblePool.length} công việc`}
              >
                <span className={hasActiveFilter ? 'text-lam-sang-ink' : ''}>
                  {visibleTotalCount}/{visiblePool.length}
                </span>
                <span className="hidden xl:inline text-[#6A7485] font-normal">
                  {' '}
                  việc
                </span>
              </div>

              {/* 7. Scroll to Top */}
              <button
                type="button"
                tabIndex={showStickyBar ? 0 : -1}
                onClick={scrollToTop}
                aria-label="Lên đầu trang"
                title="Lên đầu trang"
                className="inline-flex items-center justify-center gap-1 h-[34px] lg:h-[36px] w-[34px] sm:w-auto sm:min-w-[38px] px-0 sm:px-2.5 text-xs font-medium rounded-lg bg-huyen-lam text-trang-nga hover:bg-lam-tri-tue transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowUp className="w-3.5 h-3.5 shrink-0 text-kim-quang" />
                <span className="hidden xl:inline">Đầu trang</span>
              </button>
            </div>

            {/* Mobile/Tablet Active Filter Chips Strip (only rendered when dropdown filters active) */}
            {(activeFilterChips.length > 0 || (hasActiveFilter && searchQuery.trim() !== '')) && (
              <div className="lg:hidden flex items-center gap-1.5 pb-1.5 overflow-x-auto">
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    tabIndex={showStickyBar ? 0 : -1}
                    onClick={chip.onRemove}
                    className={`inline-flex items-center gap-1 h-[26px] px-2 text-[11px] font-medium rounded-md border whitespace-nowrap shrink-0 ${chip.toneClass}`}
                  >
                    <span>{chip.label}</span>
                    <X className="w-3 h-3 shrink-0" />
                  </button>
                ))}
                {hasActiveFilter && (
                  <button
                    type="button"
                    tabIndex={showStickyBar ? 0 : -1}
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 h-[26px] px-2 text-[11px] font-semibold text-chu-sa bg-chu-sa-soft border border-chu-sa-border rounded-md whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3 h-3 shrink-0" />
                    <span>Xóa lọc</span>
                  </button>
                )}
              </div>
            )}

            {/* Quick Filter Popover anchored to sticky bar */}
            {stickyFilterOpen && (
              <div className="absolute left-3 right-3 sm:left-6 sm:right-auto sm:w-[460px] top-full mt-1.5 max-h-[calc(100dvh-148px)] overflow-y-auto bg-trang-nga border border-[#DFD8C8] rounded-2xl shadow-[0_14px_34px_-10px_rgba(20,36,63,0.16)] p-4 space-y-3 z-30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-huyen-lam">
                    Lọc nhanh danh sách
                  </span>
                  <button
                    type="button"
                    onClick={() => setStickyFilterOpen(false)}
                    aria-label="Đóng bộ lọc nhanh"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-[#7D8796] hover:text-huyen-lam hover:bg-[#F3EFE6]"
                  >
                    <X className="w-4 h-4 shrink-0" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#606B7D] mb-1">
                      Trạng thái
                    </label>
                    <select
                      aria-label="Lọc nhanh theo trạng thái"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-[#E2DCD0] bg-white text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[38px]"
                    >
                      <option value="all">Tất cả</option>
                      {ALL_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                      <option value="__unset__">Thiếu trạng thái</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#606B7D] mb-1">
                      Hạng mục
                    </label>
                    <select
                      aria-label="Lọc nhanh theo hạng mục"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-[#E2DCD0] bg-white text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[38px]"
                    >
                      <option value="all">Tất cả</option>
                      {sortedCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                      <option value="__uncategorized__">Chưa phân</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#606B7D] mb-1">
                      Phụ trách
                    </label>
                    <select
                      aria-label="Lọc nhanh theo người phụ trách"
                      value={assigneeFilter}
                      onChange={(e) => setAssigneeFilter(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-[#E2DCD0] bg-white text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[38px]"
                    >
                      <option value="all">Tất cả</option>
                      <option value="__unassigned__">Chưa phân công</option>
                      {hasCollectiveGroupTasks && (
                        <option value="__collective__">Việc nhóm</option>
                      )}
                      {isManager && (
                        <option value="__unlinked_uid__">
                          Chưa liên kết TK ({unlinkedUidCount})
                        </option>
                      )}
                      {assigneeOptions.map((opt) => (
                        <option key={opt.uid} value={opt.uid}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#EFEAE0]">
                  {hasActiveFilter ? (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-chu-sa hover:underline"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Xóa toàn bộ lọc</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-[#838C9A]">
                      Đang hiển thị toàn bộ danh sách
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setStickyFilterOpen(false)}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-huyen-lam text-trang-nga rounded-lg hover:bg-lam-tri-tue min-h-[34px]"
                  >
                    Xong
                  </button>
                </div>
              </div>
            )}

            {/* Desktop Sticky Column Header (only on lg+ after scrolling past table header) */}
            {showStickyColumnHeader && filteredTree.length > 0 && (
              <div className="hidden lg:block pb-1.5">
                <div
                  className={`${DESKTOP_GRID_COLS} px-5 py-1.5 bg-[#F6F2E9]/85 border border-[#E6E0D3]/85 rounded-lg text-[11.5px] font-semibold tracking-[0.015em] text-[#5B6678]`}
                >
                  <div className="pl-[46px] text-huyen-lam">
                    Công việc &amp; Hạng mục
                  </div>
                  <div className="text-huyen-lam">Trạng thái</div>
                  <div>Người phụ trách</div>
                  <div>Bước tiếp theo</div>
                  <div className="text-right">Hạn xử lý</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 sm:space-y-5">
      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] sm:text-[26px] font-bold text-huyen-lam tracking-[-0.02em] leading-tight">
              Danh sách công việc
            </h1>
            <span
              className="hidden sm:inline-block h-[2px] w-6 bg-chu-sa/75 rounded-full"
              aria-hidden="true"
            />
          </div>
          <p className="text-xs sm:text-[13.5px] text-[#5E697A] mt-1 tabular-nums">
            <span className="font-semibold text-huyen-lam">
              {parentTasks.length}
            </span>{' '}
            đầu việc cha{' '}
            <span className="text-[#C8C0B0] mx-1" aria-hidden="true">
              ·
            </span>{' '}
            <span className="font-semibold text-huyen-lam">
              {visiblePool.length}
            </span>{' '}
            công việc đang hoạt động
            {showArchived ? ' (bao gồm lưu trữ)' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onNavigateToDocuments && (
            <button
              type="button"
              onClick={onNavigateToDocuments}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#DDD6C7] bg-trang-nga text-huyen-lam text-xs sm:text-[13px] font-medium hover:bg-[#F4F0E6] hover:border-[#CCC3B0] transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Library className="w-4 h-4 shrink-0 text-lam-sang" />
              <span className="hidden sm:inline">Tài liệu dự án</span>
              <span className="sm:hidden">Tài liệu</span>
            </button>
          )}

          {parentsWithVisibleChildren.length > 0 && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DDD6C7] bg-trang-nga text-huyen-lam text-xs sm:text-[13px] font-medium hover:bg-[#F4F0E6] hover:border-[#CCC3B0] transition-colors whitespace-nowrap min-h-[42px]"
            >
              {allExpanded ? (
                <>
                  <ChevronsDownUp className="w-4 h-4 shrink-0 text-[#667285]" />
                  <span>Thu gọn việc con</span>
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-4 h-4 shrink-0 text-lam-sang" />
                  <span>Mở tất cả việc con</span>
                </>
              )}
            </button>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => onOpenNewTask(null)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-huyen-lam text-trang-nga text-sm font-semibold hover:bg-lam-tri-tue shadow-[0_1px_2px_rgba(20,36,63,0.14)] transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
            >
              <Plus className="w-4 h-4 shrink-0 text-kim-quang" />
              <span>{isManager ? 'Thêm đầu việc' : 'Thêm việc con'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Luminous Warm Search & Filter Bar (Compact Mobile + Full Desktop) */}
      <div
        ref={filterBarRef}
        className="bg-trang-nga border border-[#E5DFD2] rounded-2xl p-2.5 sm:p-4 shadow-[0_1px_3px_rgba(20,36,63,0.03)]"
      >
        {/* Mobile (< sm) Compact Search + Filter Trigger + Expandable Panel */}
        <div className="sm:hidden">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-[#8A94A3] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mã, tên, phụ trách..."
                aria-label="Tìm kiếm công việc"
                className="w-full pl-9 pr-9 py-1.5 text-sm bg-[#FAF8F3] border border-[#E2DCD0] rounded-xl text-huyen-lam placeholder:text-[#8E96A3] focus:outline-none focus:ring-2 focus:ring-lam-sang/30 focus:border-lam-sang focus:bg-white min-h-[40px] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[#7D8796] hover:text-huyen-lam hover:bg-[#EFEAE0] transition-colors"
                >
                  <X className="w-4 h-4 shrink-0" />
                </button>
              )}
            </div>

            <button
              ref={mobileFilterBtnRef}
              type="button"
              onClick={() => setMobileFilterOpen((v) => !v)}
              aria-expanded={mobileFilterOpen}
              aria-controls="mobile-tasks-filter-panel"
              aria-label={
                mobileFilterOpen ? 'Đóng bộ lọc danh sách' : 'Mở bộ lọc danh sách'
              }
              className={`inline-flex items-center justify-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-lam-sang ${
                mobileFilterOpen || activePanelFilterCount > 0
                  ? 'bg-lam-sang-soft border-lam-sang/45 text-lam-sang-ink'
                  : 'bg-white border-[#E2DCD0] text-huyen-lam hover:bg-[#FAF8F3]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>Lọc</span>
              {activePanelFilterCount > 0 && (
                <span className="font-mono-tabular text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-lam-sang text-white leading-none">
                  {activePanelFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Slim Status Strip: Count + Quick Review Toggle */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-[#606B7D] tabular-nums whitespace-nowrap">
              Đang xem{' '}
              <span
                className={`font-mono-tabular font-semibold ${
                  hasActiveFilter ? 'text-lam-sang-ink' : 'text-huyen-lam'
                }`}
              >
                {visibleTotalCount}/{visiblePool.length}
              </span>{' '}
              việc
            </div>

            <div className="inline-flex items-center gap-1.5">
              {(reviewFlagCount > 0 || reviewOnly) && (
                <button
                  type="button"
                  onClick={() => setReviewOnly((v) => !v)}
                  aria-pressed={reviewOnly}
                  className={`inline-flex items-center gap-1 px-2.5 min-h-[30px] text-[11.5px] font-medium rounded-lg border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-lam-sang ${
                    reviewOnly
                      ? 'bg-huyen-lam border-huyen-lam text-kim-quang font-semibold'
                      : 'bg-white border-[#E2DCD0] text-huyen-lam hover:bg-[#FAF8F3]'
                  }`}
                >
                  <AlertCircle
                    className={`w-3.5 h-3.5 shrink-0 ${
                      reviewOnly ? 'text-kim-quang' : 'text-minh-kim-ink'
                    }`}
                  />
                  <span>
                    Cần rà soát
                    {reviewFlagCount > 0 ? ` (${reviewFlagCount})` : ''}
                  </span>
                </button>
              )}

              {hasActiveFilter && !mobileFilterOpen && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 px-2 min-h-[30px] text-[11.5px] font-semibold rounded-lg bg-chu-sa-soft border border-chu-sa-border text-chu-sa hover:bg-chu-sa hover:text-white transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3 shrink-0" />
                  <span>Xóa lọc</span>
                </button>
              )}
            </div>
          </div>

          {/* Compact Active Filter Summary Chips (when panel closed) */}
          {!mobileFilterOpen && activeFilterChips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  title={`Bỏ lọc: ${chip.label}`}
                  className={`inline-flex items-center gap-1 min-h-[28px] px-2 text-[11px] font-medium rounded-md border transition-colors max-w-full ${chip.toneClass}`}
                >
                  <span className="truncate">{chip.label}</span>
                  <X className="w-3 h-3 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Expandable Mobile Filter Panel (in-flow inside filterBarRef, never covered by sticky/bottom bar) */}
          {mobileFilterOpen && (
            <div
              id="mobile-tasks-filter-panel"
              className="mt-2.5 pt-3 border-t border-[#ECE6DA] space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-huyen-lam">
                  Bộ lọc danh sách
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMobileFilterOpen(false);
                    mobileFilterBtnRef.current?.focus();
                  }}
                  aria-label="Đóng bộ lọc"
                  className="inline-flex items-center gap-1 px-2 min-h-[30px] rounded-lg text-xs font-medium text-[#606B7D] hover:text-huyen-lam hover:bg-[#F3EFE6] transition-colors"
                >
                  <span>Đóng</span>
                  <X className="w-3.5 h-3.5 shrink-0" />
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <label
                    htmlFor="mobile-filter-status"
                    className="block text-[11px] font-medium text-[#606B7D] mb-1"
                  >
                    Trạng thái
                  </label>
                  <select
                    id="mobile-filter-status"
                    aria-label="Lọc theo trạng thái"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[40px] transition-colors ${
                      statusFilter !== 'all'
                        ? 'bg-lam-sang-soft border-lam-sang/40 text-huyen-lam font-medium'
                        : 'bg-white border-[#E2DCD0] text-huyen-lam'
                    }`}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                    <option value="__unset__">
                      Thiếu trạng thái (chưa chọn)
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mobile-filter-category"
                    className="block text-[11px] font-medium text-[#606B7D] mb-1"
                  >
                    Hạng mục
                  </label>
                  <select
                    id="mobile-filter-category"
                    aria-label="Lọc theo hạng mục"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[40px] transition-colors ${
                      categoryFilter !== 'all'
                        ? 'bg-thanh-ngoc-soft border-thanh-ngoc/40 text-huyen-lam font-medium'
                        : 'bg-white border-[#E2DCD0] text-huyen-lam'
                    }`}
                  >
                    <option value="all">Tất cả hạng mục</option>
                    {sortedCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                        {!cat.isActive ? ' (Ngừng dùng)' : ''}
                      </option>
                    ))}
                    <option value="__uncategorized__">Chưa phân hạng mục</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mobile-filter-assignee"
                    className="block text-[11px] font-medium text-[#606B7D] mb-1"
                  >
                    Người phụ trách
                  </label>
                  <select
                    id="mobile-filter-assignee"
                    aria-label="Lọc theo người phụ trách"
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                    className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[40px] transition-colors ${
                      assigneeFilter !== 'all'
                        ? 'bg-minh-kim-soft border-minh-kim-border text-huyen-lam font-medium'
                        : 'bg-white border-[#E2DCD0] text-huyen-lam'
                    }`}
                  >
                    <option value="all">Tất cả người phụ trách</option>
                    <option value="__unassigned__">Chưa phân công</option>
                    {hasCollectiveGroupTasks && (
                      <option value="__collective__">Việc nhóm</option>
                    )}
                    {isManager && (
                      <option value="__unlinked_uid__">
                        Chưa liên kết tài khoản ({unlinkedUidCount})
                      </option>
                    )}
                    {assigneeOptions.map((opt) => (
                      <option key={opt.uid} value={opt.uid}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setReviewOnly((v) => !v)}
                  aria-pressed={reviewOnly}
                  className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium rounded-xl border transition-colors min-h-[40px] whitespace-nowrap ${
                    reviewOnly
                      ? 'bg-huyen-lam border-huyen-lam text-kim-quang font-semibold'
                      : 'bg-white border-[#E2DCD0] text-huyen-lam hover:bg-[#FAF8F3]'
                  }`}
                >
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 ${
                      reviewOnly ? 'text-kim-quang' : 'text-minh-kim-ink'
                    }`}
                  />
                  <span>
                    Chỉ hiện việc cần rà soát
                    {reviewFlagCount > 0 ? ` (${reviewFlagCount})` : ''}
                  </span>
                </button>
              </div>

              <div className="pt-2 border-t border-[#EFEAE0] flex items-center justify-between gap-2">
                {hasActiveFilter ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 px-2.5 min-h-[38px] text-xs font-semibold text-chu-sa hover:bg-chu-sa-soft rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Xóa bộ lọc</span>
                  </button>
                ) : (
                  <span className="text-[11.5px] text-[#7D8796]">
                    Đang hiện toàn bộ danh sách
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileFilterOpen(false);
                    mobileFilterBtnRef.current?.focus();
                  }}
                  className="px-4 min-h-[38px] text-xs font-semibold bg-huyen-lam text-trang-nga rounded-xl hover:bg-lam-tri-tue transition-colors"
                >
                  Xong
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop & Tablet (sm+) Full Search & Filter Bar — preserved unchanged */}
        <div className="hidden sm:block space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-[#8A94A3] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo mã, tên việc, người phụ trách, bước tiếp theo..."
                aria-label="Tìm kiếm công việc"
                className="w-full pl-10 pr-10 py-2 text-sm bg-[#FAF8F3] border border-[#E2DCD0] rounded-xl text-huyen-lam placeholder:text-[#8E96A3] focus:outline-none focus:ring-2 focus:ring-lam-sang/30 focus:border-lam-sang focus:bg-white min-h-[42px] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-[#7D8796] hover:text-huyen-lam hover:bg-[#EFEAE0] transition-colors"
                >
                  <X className="w-4 h-4 shrink-0" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
              <div className="text-xs sm:text-[13px] text-[#606B7D] tabular-nums whitespace-nowrap px-1">
                Đang xem{' '}
                <span
                  className={`font-mono-tabular font-semibold ${
                    hasActiveFilter ? 'text-lam-sang-ink' : 'text-huyen-lam'
                  }`}
                >
                  {visibleTotalCount}/{visiblePool.length}
                </span>{' '}
                việc
              </div>

              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-chu-sa-soft border border-chu-sa-border text-chu-sa hover:bg-chu-sa hover:text-white transition-colors whitespace-nowrap min-h-[40px]"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Xóa lọc</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <select
              aria-label="Lọc theo trạng thái"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[42px] transition-colors ${
                statusFilter !== 'all'
                  ? 'bg-lam-sang-soft border-lam-sang/40 text-huyen-lam font-medium'
                  : 'bg-white border-[#E2DCD0] text-huyen-lam hover:border-[#CFC7B7]'
              }`}
            >
              <option value="all">Tất cả trạng thái</option>
              {ALL_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
              <option value="__unset__">Thiếu trạng thái (chưa chọn)</option>
            </select>

            <select
              aria-label="Lọc theo hạng mục"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[42px] transition-colors ${
                categoryFilter !== 'all'
                  ? 'bg-thanh-ngoc-soft border-thanh-ngoc/40 text-huyen-lam font-medium'
                  : 'bg-white border-[#E2DCD0] text-huyen-lam hover:border-[#CFC7B7]'
              }`}
            >
              <option value="all">Tất cả hạng mục</option>
              {sortedCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                  {!cat.isActive ? ' (Ngừng dùng)' : ''}
                </option>
              ))}
              <option value="__uncategorized__">Chưa phân hạng mục</option>
            </select>

            <select
              aria-label="Lọc theo người phụ trách"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className={`w-full px-3 py-2 text-[13px] rounded-xl border focus:outline-none focus:ring-2 focus:ring-lam-sang/30 min-h-[42px] transition-colors ${
                assigneeFilter !== 'all'
                  ? 'bg-minh-kim-soft border-minh-kim-border text-huyen-lam font-medium'
                  : 'bg-white border-[#E2DCD0] text-huyen-lam hover:border-[#CFC7B7]'
              }`}
            >
              <option value="all">Tất cả người phụ trách</option>
              <option value="__unassigned__">Chưa phân công</option>
              {hasCollectiveGroupTasks && (
                <option value="__collective__">Việc nhóm</option>
              )}
              {isManager && (
                <option value="__unlinked_uid__">
                  Chưa liên kết tài khoản ({unlinkedUidCount})
                </option>
              )}
              {assigneeOptions.map((opt) => (
                <option key={opt.uid} value={opt.uid}>
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setReviewOnly((v) => !v)}
              aria-pressed={reviewOnly}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium rounded-xl border transition-colors min-h-[42px] whitespace-nowrap ${
                reviewOnly
                  ? 'bg-huyen-lam border-huyen-lam text-kim-quang font-semibold'
                  : 'bg-white border-[#E2DCD0] text-huyen-lam hover:bg-[#FAF8F3] hover:border-[#CFC7B7]'
              }`}
            >
              <AlertCircle
                className={`w-4 h-4 shrink-0 ${
                  reviewOnly ? 'text-kim-quang' : 'text-minh-kim-ink'
                }`}
              />
              <span>
                Cần rà soát
                {reviewFlagCount > 0 ? ` (${reviewFlagCount})` : ''}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Modern Zen Editorial Card-Table Hybrid Workspace */}
      <div className="space-y-3">
        {/* Desktop Editorial Column Header */}
        {filteredTree.length > 0 && (
          <div
            ref={columnHeaderRef}
            className={`hidden ${DESKTOP_GRID_COLS} px-5 py-2.5 bg-[#F4F0E6]/85 border border-[#E5DFD2] rounded-xl text-[11.5px] font-semibold tracking-[0.015em] text-[#5B6678] transition-opacity duration-150 ${
              showStickyColumnHeader ? 'lg:opacity-0' : 'lg:opacity-100'
            }`}
          >
            <div className="pl-[46px] text-huyen-lam">Công việc &amp; Hạng mục</div>
            <div className="text-huyen-lam">Trạng thái</div>
            <div>Người phụ trách</div>
            <div>Bước tiếp theo</div>
            <div className="text-right">Hạn xử lý</div>
          </div>
        )}

        {/* Group Cards */}
        {filteredTree.length === 0 ? (
          <div className="bg-trang-nga border border-[#E5DFD2] rounded-2xl px-4 py-14 text-center space-y-3 shadow-[0_1px_3px_rgba(20,36,63,0.03)]">
            <p className="text-sm text-[#606B7D]">
              {tasks.filter((t) => !isB1TestTask(t)).length === 0
                ? 'Chưa có công việc nào trên hệ thống.'
                : 'Không tìm thấy công việc nào khớp với điều kiện lọc hiện tại.'}
            </p>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-huyen-lam text-trang-nga rounded-xl hover:bg-lam-tri-tue transition-colors min-h-[42px]"
              >
                <RotateCcw className="w-4 h-4 shrink-0 text-kim-quang" />
                <span>Đặt lại toàn bộ bộ lọc</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTree.map(({ parent, children, autoExpand }) => {
              const allChildrenInParent = childrenByParent[parent.id] || [];
              const totalChildrenInParent = allChildrenInParent.length;
              const hasChildren = children.length > 0;
              const isExpanded = getIsExpanded(
                parent.id,
                hasChildren,
                autoExpand
              );
              const childrenRegionId = `task-children-${parent.id}`;
              const progress = computeParentProgress(parent.id, visiblePool);
              const childAttention = hasChildren
                ? summarizeChildAttention(
                    hasActiveFilter ? children : allChildrenInParent
                  )
                : null;
              const isFilteredChildSubset =
                hasActiveFilter &&
                hasChildren &&
                children.length < totalChildrenInParent;
              const subtaskCountLabel = isFilteredChildSubset
                ? `${children.length}/${totalChildrenInParent} việc con phù hợp`
                : `${totalChildrenInParent} việc con`;
              const effCat = getEffectiveCategory(
                parent,
                visiblePool,
                categories
              );
              const catTheme = getCategoryVisualTheme(
                effCat.categoryId,
                effCat.category,
                effCat.color
              );
              const parentLinksNode = renderTaskLinkActions(parent);
              const isParentDone =
                progress.total > 0 && progress.completed === progress.total;
              const hasOpenPopoverInGroup =
                openLinkMenu?.taskId === parent.id ||
                children.some((c) => c.id === openLinkMenu?.taskId);

              const handleParentPrimaryAction = () => {
                if (hasChildren) {
                  toggleParent(parent.id, isExpanded);
                } else {
                  onSelectTask(parent.id);
                }
              };

              return (
                <section
                  key={parent.id}
                  aria-label={`Nhóm công việc ${parent.displayCode}: ${parent.title}`}
                  className={`relative bg-white border rounded-2xl shadow-[0_1px_3px_rgba(20,36,63,0.03),0_6px_18px_-14px_rgba(20,36,63,0.12)] transition-[border-color,box-shadow] duration-150 ${
                    isExpanded
                      ? 'border-[#D5D1C8]'
                      : 'border-[#E5DFD2] hover:border-[#CFC6B4]'
                  } ${hasOpenPopoverInGroup ? 'z-20' : ''}`}
                >
                  {/* Subtle Top Category Hairline for Editorial Rhythm across 9 Groups */}
                  <div
                    aria-hidden="true"
                    className={`h-[2.5px] w-full rounded-t-[15px] transition-opacity ${
                      isExpanded ? 'opacity-100' : 'opacity-80'
                    }`}
                    style={{
                      background: `linear-gradient(90deg, ${catTheme.accent} 0%, ${catTheme.accent}4D 42%, transparent 88%)`,
                    }}
                  />

                  {/* Parent Row */}
                  <div
                    onClick={handleParentPrimaryAction}
                    className={`px-3.5 py-3 sm:px-5 sm:py-4 transition-colors cursor-pointer ${
                      isExpanded
                        ? 'bg-[#FAF9F6] hover:bg-[#F6F4EE]'
                        : 'bg-white hover:bg-[#FCFBF8] rounded-b-2xl'
                    }`}
                  >
                    <div className={DESKTOP_GRID_COLS}>
                      {/* Column 1: Chevron (sm+) + Quiet Archival Code + Dominant Editorial Title + Fixed Chi tiết + Clean Metadata */}
                      <div className="flex items-start sm:gap-2.5 min-w-0">
                        <div
                          className={`shrink-0 pt-0.5 ${
                            hasChildren
                              ? 'hidden sm:flex sm:w-9 sm:items-start sm:justify-center'
                              : 'hidden lg:block lg:w-9'
                          }`}
                        >
                          {hasChildren && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleParent(parent.id, isExpanded);
                              }}
                              aria-expanded={isExpanded}
                              aria-controls={childrenRegionId}
                              aria-label={
                                isExpanded
                                  ? `Thu gọn ${subtaskCountLabel} của ${parent.displayCode}`
                                  : `Mở rộng ${subtaskCountLabel} của ${parent.displayCode}`
                              }
                              className={`w-10 h-10 -my-1.5 flex items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-lam-sang ${
                                isExpanded
                                  ? 'text-thanh-ngoc-ink bg-thanh-ngoc-soft/65 hover:bg-thanh-ngoc-soft'
                                  : 'text-[#687385] hover:bg-[#F3EFE6] hover:text-huyen-lam'
                              }`}
                            >
                              <ChevronRight
                                className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                                  isExpanded ? 'rotate-90' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Mobile (< sm) Fixed Action Header: Chevron + Code <-> Chi tiết + StatusBadge */}
                          <div className="flex sm:hidden flex-wrap items-center justify-between gap-x-2 gap-y-1.5 mb-1.5">
                            <div className="inline-flex items-center gap-1.5 shrink-0">
                              {hasChildren && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleParent(parent.id, isExpanded);
                                  }}
                                  aria-expanded={isExpanded}
                                  aria-controls={childrenRegionId}
                                  aria-label={
                                    isExpanded
                                      ? `Thu gọn ${subtaskCountLabel} của ${parent.displayCode}`
                                      : `Mở rộng ${subtaskCountLabel} của ${parent.displayCode}`
                                  }
                                  className={`relative -ml-1 w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-lam-sang before:content-[''] before:absolute before:-inset-2.5 ${
                                    isExpanded
                                      ? 'text-thanh-ngoc-ink bg-thanh-ngoc-soft/80'
                                      : 'text-[#5E697A] hover:bg-[#F3EFE6] hover:text-huyen-lam'
                                  }`}
                                >
                                  <ChevronRight
                                    className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                                      isExpanded ? 'rotate-90' : ''
                                    }`}
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                              <span
                                style={{
                                  backgroundColor: catTheme.softBg,
                                  color: catTheme.text,
                                  borderColor: `${catTheme.accent}33`,
                                }}
                                className="font-mono-tabular text-[11px] font-bold min-w-[26px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-md border shrink-0"
                              >
                                {parent.displayCode}
                              </span>
                            </div>

                            <div className="inline-flex items-center gap-1.5 shrink-0 ml-auto">
                              {hasChildren && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectTask(parent.id);
                                  }}
                                  aria-label={`Mở chi tiết công việc ${parent.displayCode}: ${parent.title}`}
                                  className="relative inline-flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-lg border border-[#DCD4C4] bg-white text-[11.5px] font-semibold text-huyen-lam hover:bg-huyen-lam hover:text-trang-nga hover:border-huyen-lam focus-visible:outline-2 focus-visible:outline-lam-sang transition-colors whitespace-nowrap shrink-0 before:content-[''] before:absolute before:-inset-y-1.5 before:-inset-x-0.5"
                                >
                                  <PanelRightOpen
                                    className="w-3.5 h-3.5 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span>Chi tiết</span>
                                </button>
                              )}
                              <StatusBadge status={parent.status} compact soft />
                            </div>
                          </div>

                          <div className="flex items-start justify-between gap-2.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleParentPrimaryAction();
                              }}
                              aria-expanded={hasChildren ? isExpanded : undefined}
                              aria-controls={
                                hasChildren ? childrenRegionId : undefined
                              }
                              className="text-left flex-1 min-w-0 group focus-visible:outline-2 focus-visible:outline-lam-sang rounded-sm"
                            >
                              <div className="flex items-start gap-2.5">
                                <span
                                  style={{
                                    backgroundColor: catTheme.softBg,
                                    color: catTheme.text,
                                    borderColor: `${catTheme.accent}33`,
                                  }}
                                  className="hidden sm:inline-flex font-mono-tabular text-[11.5px] font-bold min-w-[30px] h-[25px] px-2 items-center justify-center rounded-md border shrink-0 mt-0.5"
                                >
                                  {parent.displayCode}
                                </span>
                                <span className="text-[15px] sm:text-[16px] font-semibold tracking-[-0.01em] text-huyen-lam group-hover:text-lam-tri-tue group-hover:underline decoration-minh-kim/75 underline-offset-4 leading-[1.38] sm:leading-[1.42] break-words transition-colors">
                                  {parent.title}
                                </span>
                              </div>
                            </button>

                            {/* Tablet & Desktop (sm+) Fixed Secondary Action Slot: Chi tiết + Tablet StatusBadge */}
                            <div className="hidden sm:flex items-center gap-2 shrink-0 pt-0.5">
                              {hasChildren && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectTask(parent.id);
                                  }}
                                  aria-label={`Mở chi tiết công việc ${parent.displayCode}: ${parent.title}`}
                                  className="inline-flex items-center gap-1 min-h-[28px] px-2.5 py-0.5 rounded-lg border border-[#DCD4C4] bg-white text-[11.5px] font-semibold text-huyen-lam hover:bg-huyen-lam hover:text-trang-nga hover:border-huyen-lam focus-visible:outline-2 focus-visible:outline-lam-sang transition-colors whitespace-nowrap shrink-0"
                                >
                                  <PanelRightOpen
                                    className="w-3.5 h-3.5 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span>Chi tiết</span>
                                </button>
                              )}
                              <div className="lg:hidden">
                                <StatusBadge status={parent.status} compact soft />
                              </div>
                            </div>
                          </div>

                          {/* 2. Standardized Visual Hierarchy: Category -> Review -> Subtasks Discovery & Progress -> Collapsed Child Attention -> Links */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5 text-xs leading-5">
                            <CategoryChip
                              categoryId={effCat.categoryId}
                              categoryName={
                                effCat.category || 'Chưa phân hạng mục'
                              }
                              color={effCat.color}
                            />

                            <ReviewBadge task={parent} />

                            {hasChildren && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleParent(parent.id, isExpanded);
                                  }}
                                  aria-expanded={isExpanded}
                                  aria-controls={childrenRegionId}
                                  aria-label={
                                    isExpanded
                                      ? `Thu gọn ${subtaskCountLabel} của nhóm ${parent.displayCode}`
                                      : `Xem ${subtaskCountLabel} của nhóm ${parent.displayCode}`
                                  }
                                  className={`inline-flex items-center gap-1.5 min-h-[30px] sm:min-h-[26px] px-2.5 py-0.5 rounded-lg border text-[11.5px] font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-lam-sang ${
                                    isExpanded
                                      ? 'bg-thanh-ngoc-soft border-thanh-ngoc/45 text-thanh-ngoc-ink'
                                      : 'bg-thanh-ngoc-soft/75 border-thanh-ngoc/30 text-thanh-ngoc-ink hover:bg-thanh-ngoc-soft hover:border-thanh-ngoc/50'
                                  }`}
                                >
                                  <ListTree
                                    className="w-3.5 h-3.5 shrink-0 text-thanh-ngoc"
                                    aria-hidden="true"
                                  />
                                  <span className="tabular-nums">
                                    {subtaskCountLabel}
                                  </span>
                                  {!isExpanded && (
                                    <span className="hidden sm:inline text-[11px] font-normal text-thanh-ngoc-ink/80">
                                      · Xem việc con
                                    </span>
                                  )}
                                  <ChevronDown
                                    className={`w-3 h-3 shrink-0 text-thanh-ngoc-ink/80 transition-transform duration-150 ${
                                      isExpanded ? 'rotate-180' : ''
                                    }`}
                                    aria-hidden="true"
                                  />
                                </button>

                                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#5E697A] whitespace-nowrap">
                                  <span
                                    className={`font-mono-tabular font-semibold ${
                                      isParentDone
                                        ? 'text-thanh-ngoc-ink'
                                        : 'text-huyen-lam'
                                    }`}
                                  >
                                    {progress.completed}/{progress.total}
                                  </span>
                                  <span className="text-[#6A7485]">
                                    hoàn thành
                                  </span>
                                  <span
                                    aria-hidden="true"
                                    className="w-10 sm:w-12 h-1.5 rounded-full bg-[#EAE5D9] overflow-hidden inline-block"
                                  >
                                    <span
                                      className="block h-full rounded-full transition-all"
                                      style={{
                                        width: `${progress.percentage}%`,
                                        backgroundColor: isParentDone
                                          ? '#328578'
                                          : catTheme.accent,
                                      }}
                                    />
                                  </span>
                                </span>

                                {!isExpanded &&
                                  childAttention &&
                                  childAttention.visibleSignals.length > 0 && (
                                    <span
                                      className="inline-flex flex-wrap items-center gap-1.5"
                                      title={childAttention.tooltipText}
                                    >
                                      {childAttention.visibleSignals.map(
                                        (signal) => {
                                          const tone =
                                            signal.kind === 'overdue'
                                              ? 'bg-chu-sa-soft border-chu-sa-border text-chu-sa'
                                              : signal.kind ===
                                                'pending_approval'
                                              ? 'bg-minh-kim-soft border-minh-kim-border text-minh-kim-ink'
                                              : 'bg-[#FAF0EE] border-[#E4C2BE] text-[#8B322F]';
                                          return (
                                            <span
                                              key={signal.kind}
                                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap tabular-nums ${tone}`}
                                            >
                                              {signal.kind === 'overdue' && (
                                                <Clock3
                                                  className="w-3 h-3 shrink-0"
                                                  aria-hidden="true"
                                                />
                                              )}
                                              {signal.kind ===
                                                'data_review' && (
                                                <AlertTriangle
                                                  className="w-3 h-3 shrink-0"
                                                  aria-hidden="true"
                                                />
                                              )}
                                              <span>{signal.label}</span>
                                            </span>
                                          );
                                        }
                                      )}
                                    </span>
                                  )}
                              </>
                            )}

                            {!hasChildren && totalChildrenInParent > 0 && (
                              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#5E697A] whitespace-nowrap">
                                <ListTree
                                  className="w-3.5 h-3.5 shrink-0 text-thanh-ngoc"
                                  aria-hidden="true"
                                />
                                <span className="font-mono-tabular font-semibold text-huyen-lam">
                                  {progress.completed}/{progress.total}
                                </span>
                                <span className="text-[#6A7485]">
                                  hoàn thành
                                </span>
                              </span>
                            )}

                            {parentLinksNode && (
                              <>
                                {(hasChildren || totalChildrenInParent > 0) && (
                                  <span
                                    className="text-[#D4CCB9] select-none"
                                    aria-hidden="true"
                                  >
                                    ·
                                  </span>
                                )}
                                {parentLinksNode}
                              </>
                            )}

                            {parent.archivedAt && (
                              <>
                                <span
                                  className="text-[#D4CCB9] select-none"
                                  aria-hidden="true"
                                >
                                  ·
                                </span>
                                <span className="inline-flex items-center gap-1 text-[#6E7785]">
                                  <Archive className="w-3.5 h-3.5 shrink-0" />
                                  <span>Đã lưu trữ</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Desktop Column 2: Status */}
                      <div className="hidden lg:flex items-center">
                        <StatusBadge
                          status={parent.status}
                          compact
                          soft
                          className="min-w-[122px]"
                        />
                      </div>

                      {/* Desktop Column 3: Assignees */}
                      <div className="hidden lg:block min-w-0">
                        {renderAssigneeCell(parent)}
                      </div>

                      {/* Desktop Column 4: Next Step */}
                      <div
                        className="hidden lg:block min-w-0 text-[13px] leading-[1.45]"
                        title={parent.nextStep ?? ''}
                      >
                        {parent.nextStep ? (
                          <span className="line-clamp-2 break-words text-[#4D596B]">
                            {parent.nextStep}
                          </span>
                        ) : (
                          <span className="text-[#D6D0C4] select-none">—</span>
                        )}
                      </div>

                      {/* Desktop Column 5: Due Date */}
                      <div className="hidden lg:block">
                        {renderDueDateCell(parent, true)}
                      </div>
                    </div>

                    {/* Mobile (< lg) Parent Meta — aligned cleanly with parent title on < sm */}
                    <div
                      className={`lg:hidden mt-2.5 pt-2 border-t border-[#EFEAE0] space-y-1.5 ${
                        hasChildren ? 'sm:pl-11' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          {renderAssigneeCell(parent)}
                        </div>
                        {parent.dueDate && (
                          <div className="shrink-0 text-xs text-[#6E7785] flex items-center gap-1">
                            <span>Hạn:</span>
                            {renderDueDateCell(parent, false)}
                          </div>
                        )}
                      </div>
                      {parent.nextStep && (
                        <div className="text-[13px] text-[#4D596B] leading-[1.45] break-words">
                          <span className="text-[#606B7D] font-medium">
                            Tiếp theo:{' '}
                          </span>
                          {parent.nextStep}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nested Child Rows (Warm Linen Well, Subtle Tree Lineage Rail, 12px Mobile Indent) */}
                  {isExpanded && (
                    <div
                      id={childrenRegionId}
                      className="relative border-t border-[#ECE7DA] bg-[#FAF8F3] divide-y divide-[#EFEAE0] rounded-b-2xl"
                    >
                      {/* Mobile (< sm) slim vertical hierarchy rail aligned to parent left edge */}
                      <div
                        aria-hidden="true"
                        className="sm:hidden absolute left-[14px] top-0 bottom-3 w-[1.5px] rounded-full pointer-events-none"
                        style={{ backgroundColor: `${catTheme.accent}59` }}
                      />
                      {/* Tablet/Desktop (sm+) vertical hierarchy rail */}
                      <div
                        aria-hidden="true"
                        className="hidden sm:block absolute left-[38px] top-0 bottom-4 w-px pointer-events-none"
                        style={{ backgroundColor: `${catTheme.accent}45` }}
                      />
                      {children.map((child) => {
                        const childLinksNode = renderTaskLinkActions(child);
                        const effChildCat = getEffectiveCategory(
                          child,
                          visiblePool,
                          categories
                        );
                        const hasDistinctChildCategory =
                          !effChildCat.inherited &&
                          Boolean(effChildCat.category) &&
                          (effChildCat.categoryId
                            ? effChildCat.categoryId !== effCat.categoryId
                            : effChildCat.category.toLowerCase() !==
                              effCat.category.toLowerCase());
                        const childReviewSummary =
                          getTaskDataReviewSummary(child);
                        const hasChildDataReview =
                          childReviewSummary.dataFlags.length > 0;

                        return (
                          <div
                            key={child.id}
                            onClick={() => onSelectTask(child.id)}
                            className="pl-[26px] pr-3.5 py-2.5 sm:px-5 sm:py-3 hover:bg-trang-nga transition-colors cursor-pointer last:rounded-b-2xl"
                          >
                            <div className={DESKTOP_GRID_COLS}>
                              {/* Column 1: Subtle Tree Connector + Clean Code + Readable Child Title */}
                              <div className="flex items-start sm:gap-2.5 min-w-0">
                                <div className="hidden sm:flex shrink-0 sm:w-12 items-start justify-end pr-0.5 pt-1">
                                  <CornerDownRight
                                    className="w-3.5 h-3.5 shrink-0 opacity-65"
                                    style={{ color: catTheme.accent }}
                                    aria-hidden="true"
                                  />
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-x-2 gap-y-1.5">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectTask(child.id);
                                      }}
                                      className="text-left flex-1 min-w-[185px] sm:min-w-0 group focus-visible:outline-2 focus-visible:outline-lam-sang rounded-sm"
                                    >
                                      <div className="sm:flex sm:items-baseline sm:gap-2 leading-[1.42]">
                                        <CornerDownRight
                                          className="sm:hidden inline-block w-3 h-3 mr-1 -mt-0.5 shrink-0 opacity-75 align-middle"
                                          style={{ color: catTheme.accent }}
                                          aria-hidden="true"
                                        />
                                        <span
                                          style={{ color: catTheme.text }}
                                          className="inline-block font-mono-tabular text-[12px] sm:text-[11.5px] font-bold sm:font-semibold mr-1.5 sm:mr-0 opacity-90 sm:opacity-85 shrink-0"
                                        >
                                          {child.displayCode}
                                        </span>
                                        <span className="text-[13.75px] sm:text-[14px] font-medium text-[#1E2E4A] group-hover:text-lam-tri-tue group-hover:underline decoration-minh-kim/65 underline-offset-4 leading-[1.42] sm:leading-[1.45] break-words transition-colors">
                                          {child.title}
                                        </span>
                                      </div>
                                    </button>

                                    {/* Mobile & Tablet (< lg) StatusBadge — stays compact on right or wraps cleanly when tight */}
                                    <div className="lg:hidden shrink-0 pt-0.5">
                                      <StatusBadge
                                        status={child.status}
                                        compact
                                        soft
                                      />
                                    </div>
                                  </div>

                                  {(hasDistinctChildCategory ||
                                    hasChildDataReview ||
                                    childLinksNode ||
                                    child.archivedAt) && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 sm:gap-x-2.5 gap-y-1 text-xs leading-5">
                                      {hasDistinctChildCategory && (
                                        <CategoryChip
                                          categoryId={effChildCat.categoryId}
                                          categoryName={effChildCat.category}
                                          color={effChildCat.color}
                                        />
                                      )}
                                      <ReviewBadge task={child} />
                                      {childLinksNode}
                                      {child.archivedAt && (
                                        <>
                                          {childLinksNode && (
                                            <span
                                              className="text-[#D4CCB9] select-none"
                                              aria-hidden="true"
                                            >
                                              ·
                                            </span>
                                          )}
                                          <span className="inline-flex items-center gap-1 text-[#6E7785]">
                                            <Archive className="w-3.5 h-3.5 shrink-0" />
                                            <span>Đã lưu trữ</span>
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Desktop Column 2: Child Status */}
                              <div className="hidden lg:flex items-center">
                                <StatusBadge
                                  status={child.status}
                                  compact
                                  soft
                                  className="min-w-[122px]"
                                />
                              </div>

                              {/* Desktop Column 3: Child Assignees */}
                              <div className="hidden lg:block min-w-0">
                                {renderAssigneeCell(child)}
                              </div>

                              {/* Desktop Column 4: Child Next Step */}
                              <div
                                className="hidden lg:block min-w-0 text-[13px] leading-[1.45]"
                                title={child.nextStep ?? ''}
                              >
                                {child.nextStep ? (
                                  <span className="line-clamp-2 break-words text-[#4D596B]">
                                    {child.nextStep}
                                  </span>
                                ) : (
                                  <span className="text-[#D6D0C4] select-none">
                                    —
                                  </span>
                                )}
                              </div>

                              {/* Desktop Column 5: Child Due Date */}
                              <div className="hidden lg:block">
                                {renderDueDateCell(child, true)}
                              </div>
                            </div>

                            {/* Mobile (< lg) Child Meta — zero double-indent on < sm */}
                            <div className="lg:hidden pl-0 sm:pl-14 mt-1.5 space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                                <div className="min-w-0 flex-1">
                                  {renderAssigneeCell(child)}
                                </div>
                                {child.dueDate && (
                                  <div className="shrink-0 text-xs text-[#6E7785] flex items-center gap-1">
                                    <span>Hạn:</span>
                                    {renderDueDateCell(child, false)}
                                  </div>
                                )}
                              </div>
                              {child.nextStep && (
                                <div className="text-[13px] text-[#4D596B] leading-[1.45] break-words">
                                  <span className="text-[#606B7D] font-medium">
                                    Tiếp theo:{' '}
                                  </span>
                                  {child.nextStep}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Summary & Archive Toggle */}
      <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-[13px] text-[#606B7D]">
        <span className="tabular-nums">
          Hiển thị{' '}
          <strong className="font-semibold text-huyen-lam">
            {filteredTree.length}
          </strong>{' '}
          nhóm việc cha
          {visibleChildCount > 0
            ? ` và ${visibleChildCount} việc con${
                expandedChildCount < visibleChildCount
                  ? ` (${expandedChildCount} đang mở)`
                  : ''
              }`
            : ''}
        </span>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[#5E697A] hover:text-huyen-lam hover:bg-[#EFEAE0] transition-colors min-h-[40px]"
        >
          <Archive className="w-3.5 h-3.5 shrink-0" />
          <span>
            {showArchived ? 'Ẩn việc đã lưu trữ' : 'Xem việc đã lưu trữ'}
          </span>
        </button>
      </div>
      </div>
    </>
  );
};
