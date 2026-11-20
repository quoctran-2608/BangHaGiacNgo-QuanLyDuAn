import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Info,
  Link2Off,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  MemberDirectorySyncResult,
  MemberInvite,
  ProjectMember,
  TaskItem,
  UserRole,
} from '../types/project';
import {
  buildMemberMappingPreview,
  buildReplacedAccountAudit,
  COLLECTIVE_GROUP_LABEL,
  doesTaskMatchExpectedAccount,
  EXPECTED_TBHGN_ACCOUNTS,
  ExpectedAccountSpec,
  formatStandardMemberLabel,
  getExpectedAccountAliases,
  getReplacedTemporaryAccount,
  getSafeInviteDefaults,
  isReplacedTemporaryAccountEmail,
  isTemporaryAccountEmail,
  normalizeTextKey,
  ReplacedTemporaryAuditItem,
} from '../utils/memberMapping';
import { isB1TestTask } from '../utils/taskHelpers';

interface MembersViewProps {
  members: ProjectMember[];
  invites: MemberInvite[];
  tasks?: TaskItem[];
  currentUser: ProjectMember;
  onSyncMemberDirectory?: () => Promise<MemberDirectorySyncResult>;
  onAssignTasksToMember?: (
    member: ProjectMember,
    taskIds: string[]
  ) => Promise<{ updatedCount: number; skippedCount: number }>;
  onTransferTaskUid?: (
    oldMember: ProjectMember,
    newMember: ProjectMember,
    taskIds: string[]
  ) => Promise<{ updatedCount: number; skippedCount: number }>;
  onAddInvite: (input: {
    displayName: string;
    email: string;
    role: UserRole;
    canApprove: boolean;
    sheetAlias: string;
  }) => Promise<void>;
  onUpdateMember: (
    uid: string,
    email: string,
    patch: Partial<
      Pick<ProjectMember, 'role' | 'canApprove' | 'isActive' | 'sheetAlias' | 'displayName'>
    >
  ) => Promise<void>;
  onUpdateInvite: (
    email: string,
    patch: Partial<Pick<MemberInvite, 'role' | 'canApprove' | 'isActive'>>
  ) => Promise<void>;
  onDeleteInvite: (email: string) => Promise<void>;
}

export const MembersView: React.FC<MembersViewProps> = ({
  members,
  invites,
  tasks = [],
  currentUser,
  onSyncMemberDirectory,
  onAssignTasksToMember,
  onTransferTaskUid,
  onAddInvite,
  onUpdateMember,
  onUpdateInvite,
  onDeleteInvite,
}) => {
  const isAdmin = currentUser.role === 'admin' && currentUser.isActive;
  const [showAddForm, setShowAddForm] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [sheetAlias, setSheetAlias] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [canApprove, setCanApprove] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [invitingEmail, setInvitingEmail] = useState<string | null>(null);
  const [removingOldInvites, setRemovingOldInvites] = useState(false);
  const [transferPreviewEmail, setTransferPreviewEmail] = useState<string | null>(
    null
  );
  const [transferTaskIds, setTransferTaskIds] = useState<string[]>([]);
  const [transferringUid, setTransferringUid] = useState(false);
  const [transferFeedback, setTransferFeedback] = useState<{
    email: string;
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [assignPreviewKey, setAssignPreviewKey] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [assigningTasks, setAssigningTasks] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<{
    key: string;
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [renamingUid, setRenamingUid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingRename, setSavingRename] = useState(false);
  const [syncingDirectory, setSyncingDirectory] = useState(false);
  const [directorySyncFeedback, setDirectorySyncFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleSyncDirectoryClick = async () => {
    if (!onSyncMemberDirectory || syncingDirectory) return;
    setSyncingDirectory(true);
    setDirectorySyncFeedback(null);
    try {
      const result = await onSyncMemberDirectory();
      const parts: string[] = [];
      if (result.updatedCount > 0) {
        parts.push(`cập nhật ${result.updatedCount} hồ sơ`);
      }
      if (result.unchangedCount > 0) {
        parts.push(`${result.unchangedCount} hồ sơ đã khớp`);
      }
      if (result.skippedCount > 0) {
        parts.push(`bỏ qua ${result.skippedCount} hồ sơ thiếu tên hiển thị`);
      }
      setDirectorySyncFeedback({
        type: 'success',
        text:
          parts.length > 0
            ? `Đã đồng bộ danh bạ thành viên: ${parts.join(', ')}.`
            : 'Danh bạ thành viên đã được kiểm tra và đồng bộ.',
      });
    } catch (err) {
      setDirectorySyncFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Chưa đồng bộ được danh bạ thành viên.',
      });
    } finally {
      setSyncingDirectory(false);
    }
  };

  const openRenameForMember = (member: ProjectMember) => {
    if (renamingUid === member.uid) {
      setRenamingUid(null);
      setRenameError(null);
      return;
    }
    setRenamingUid(member.uid);
    setRenameDraft(member.displayName);
    setRenameError(null);
  };

  const handleSaveRename = async (member: ProjectMember) => {
    if (savingRename) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError('Vui lòng nhập tên hiển thị trong dự án.');
      return;
    }
    if (trimmed.length > 120) {
      setRenameError('Tên hiển thị tối đa 120 ký tự.');
      return;
    }
    if (trimmed === member.displayName.trim()) {
      setRenamingUid(null);
      setRenameError(null);
      return;
    }
    setSavingRename(true);
    setRenameError(null);
    try {
      await onUpdateMember(member.uid, member.email, { displayName: trimmed });
      setRenamingUid(null);
    } catch (err) {
      setRenameError(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật tên hiển thị.'
      );
    } finally {
      setSavingRename(false);
    }
  };

  const activeEmails = new Set(members.map((m) => m.email.toLowerCase()));
  const pendingInvites = invites.filter(
    (inv) =>
      !activeEmails.has(inv.email.toLowerCase()) &&
      !isReplacedTemporaryAccountEmail(inv.email)
  );

  const isEmailTemporary = isTemporaryAccountEmail(email);
  const isEmailReplacedTemp = isReplacedTemporaryAccountEmail(email);

  const replacedAudit = useMemo(
    () => buildReplacedAccountAudit(members, invites, tasks),
    [members, invites, tasks]
  );
  const replacedOldInvites = useMemo(
    () => replacedAudit.filter((item) => Boolean(item.oldInvite)),
    [replacedAudit]
  );
  const replacedOldProfiles = useMemo(
    () => replacedAudit.filter((item) => Boolean(item.oldMember)),
    [replacedAudit]
  );
  const hasReplacedItems =
    replacedOldInvites.length > 0 || replacedOldProfiles.length > 0;

  const mappingPreview = useMemo(
    () =>
      buildMemberMappingPreview(
        EXPECTED_TBHGN_ACCOUNTS,
        members,
        invites,
        tasks
      ),
    [members, invites, tasks]
  );

  const officialActiveTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.archivedAt && !isB1TestTask(t))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks]
  );

  const openAssignPreview = (
    account: ExpectedAccountSpec,
    matchedMember: ProjectMember
  ) => {
    const key = account.originalName;
    if (assignPreviewKey === key) {
      setAssignPreviewKey(null);
      return;
    }
    const matchingUnlinkedIds = officialActiveTasks
      .filter(
        (t) =>
          doesTaskMatchExpectedAccount(t, account) &&
          !t.assigneeUids.includes(matchedMember.uid)
      )
      .map((t) => t.id);

    setAssignPreviewKey(key);
    setSelectedTaskIds(matchingUnlinkedIds);
    setAssignFeedback(null);
  };

  const handleConfirmAssignTasks = async (
    originalName: string,
    matchedMember: ProjectMember
  ) => {
    if (!onAssignTasksToMember || assigningTasks || selectedTaskIds.length === 0) {
      return;
    }
    setAssigningTasks(true);
    setAssignFeedback(null);
    try {
      const res = await onAssignTasksToMember(matchedMember, selectedTaskIds);
      setAssignFeedback({
        key: originalName,
        type: 'success',
        text: `Đã xác nhận giao ${res.updatedCount} công việc cho ${matchedMember.displayName} (giữ nguyên tên gốc trên bảng tính).`,
      });
      setSelectedTaskIds([]);
    } catch (err) {
      setAssignFeedback({
        key: originalName,
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể giao công việc cho tài khoản này.',
      });
    } finally {
      setAssigningTasks(false);
    }
  };

  const handleEmailChange = (nextEmail: string) => {
    setEmail(nextEmail);
    setFormError(null);
    if (isTemporaryAccountEmail(nextEmail)) {
      if (role === 'admin') setRole('member');
      setCanApprove(false);
    }
  };

  const handleQuickInviteExpected = async (account: ExpectedAccountSpec) => {
    if (!isAdmin || invitingEmail) return;
    if (activeEmails.has(account.email.toLowerCase())) return;
    setInvitingEmail(account.email);
    try {
      await onAddInvite(getSafeInviteDefaults(account));
    } finally {
      setInvitingEmail(null);
    }
  };

  const handleDeleteAllReplacedInvites = async () => {
    if (!isAdmin || removingOldInvites || replacedOldInvites.length === 0) {
      return;
    }
    setRemovingOldInvites(true);
    try {
      for (const item of replacedOldInvites) {
        if (item.oldInvite) {
          await onDeleteInvite(item.oldInvite.email);
        }
      }
    } finally {
      setRemovingOldInvites(false);
    }
  };

  const openTransferPreview = (item: ReplacedTemporaryAuditItem) => {
    const key = item.spec.oldEmail;
    if (transferPreviewEmail === key) {
      setTransferPreviewEmail(null);
      return;
    }
    setTransferPreviewEmail(key);
    setTransferTaskIds(item.tasksHoldingOldUid.map((t) => t.id));
    setTransferFeedback(null);
  };

  const handleConfirmTransferUid = async (item: ReplacedTemporaryAuditItem) => {
    if (
      !onTransferTaskUid ||
      !item.oldMember ||
      !item.newMember ||
      transferringUid ||
      transferTaskIds.length === 0
    ) {
      return;
    }
    setTransferringUid(true);
    setTransferFeedback(null);
    try {
      const res = await onTransferTaskUid(
        item.oldMember,
        item.newMember,
        transferTaskIds
      );
      setTransferFeedback({
        email: item.spec.oldEmail,
        type: 'success',
        text: `Đã chuyển UID ${res.updatedCount} công việc từ ${item.oldMember.email} sang ${item.newMember.email} (giữ nguyên tên gốc và lịch sử).`,
      });
      setTransferTaskIds([]);
      setTransferPreviewEmail(null);
    } catch (err) {
      setTransferFeedback({
        email: item.spec.oldEmail,
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể chuyển UID công việc.',
      });
    } finally {
      setTransferringUid(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !displayName.trim() || !email.trim() || submitting) return;
    const cleanEmail = email.trim().toLowerCase();
    const replacedSpec = getReplacedTemporaryAccount(cleanEmail);
    if (replacedSpec) {
      setFormError(
        `Email tạm ${cleanEmail} đã được thay thế bởi ${replacedSpec.newEmail}. Vui lòng mời Gmail chính thức.`
      );
      return;
    }
    if (activeEmails.has(cleanEmail)) {
      setFormError(
        `Tài khoản ${cleanEmail} đã tồn tại trong danh sách thành viên — chỉnh sửa trực tiếp ở Bước 1, không tạo lời mời trùng.`
      );
      return;
    }

    const tempEmail = isTemporaryAccountEmail(cleanEmail);
    const safeRole: UserRole = tempEmail && role === 'admin' ? 'member' : role;
    const safeCanApprove =
      safeRole === 'admin' || safeRole === 'moderator'
        ? true
        : tempEmail
        ? false
        : canApprove;

    setFormError(null);
    setSubmitting(true);
    try {
      await onAddInvite({
        displayName: displayName.trim(),
        email: cleanEmail,
        role: safeRole,
        canApprove: safeCanApprove,
        sheetAlias: sheetAlias.trim(),
      });
      setDisplayName('');
      setEmail('');
      setSheetAlias('');
      setRole('member');
      setCanApprove(false);
      setShowAddForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-huyen-lam tracking-tight">
            Quản lý thành viên
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            Quản lý tài khoản Google đăng nhập, vai trò và ghép nhân sự với danh sách công việc.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onSyncMemberDirectory && (
              <button
                type="button"
                onClick={handleSyncDirectoryClick}
                disabled={syncingDirectory}
                title="Đồng bộ tên hiển thị chính thức sang danh bạ chung để Member và Viewer xem đúng tên người phụ trách"
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-nga-xam bg-white text-huyen-lam text-sm font-medium hover:bg-[#FAF8F3] hover:border-minh-kim-border disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
              >
                <RefreshCw
                  className={`w-4 h-4 shrink-0 text-lam-tri-tue ${
                    syncingDirectory ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {syncingDirectory ? 'Đang đồng bộ...' : 'Đồng bộ danh bạ'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-huyen-lam text-white text-sm font-medium hover:bg-lam-tri-tue transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Thêm thành viên</span>
            </button>
          </div>
        )}
      </div>

      {isAdmin && directorySyncFeedback && (
        <div
          role={directorySyncFeedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-center justify-between gap-3 ${
            directorySyncFeedback.type === 'success'
              ? 'bg-[#EFF7F5] border-[#C9E2DD] text-[#1D5950]'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {directorySyncFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-700" />
            )}
            <span className="break-words">{directorySyncFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setDirectorySyncFeedback(null)}
            className="text-xs font-medium opacity-75 hover:opacity-100 shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {!isAdmin ? (
        <div className="space-y-4">
          <div className="bg-surface-muted border border-nga-xam rounded-xl px-4 py-3 text-xs sm:text-sm text-huyen-lam/85">
            Chỉ tài khoản có vai trò <strong>Admin</strong> mới được xem danh sách email Google, thêm, khóa hoặc đổi quyền thành viên.
            {currentUser.role === 'moderator'
              ? ' Tài khoản Moderator của bạn quản lý trực tiếp hạng mục tại mục Quản lý hạng mục và điều chỉnh công việc tại mục Công việc.'
              : ''}
          </div>

          <div className="bg-white border border-nga-xam rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-huyen-lam">
                {currentUser.displayName} (Tài khoản của bạn)
              </div>
              <div className="text-xs text-ink-muted mt-0.5">
                {currentUser.email}
              </div>
            </div>
            <div className="text-xs text-huyen-lam/85 flex items-center gap-2 shrink-0">
              <UserCheck className="w-4 h-4 text-huyen-lam shrink-0" />
              <span className="capitalize font-medium">{currentUser.role}</span>
              {(currentUser.canApprove || currentUser.role === 'moderator') && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-minh-kim-ink font-medium">Được duyệt</span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>

          {showAddForm && (
            <form
              onSubmit={handleSubmit}
              className="bg-white border border-nga-xam rounded-xl p-4 space-y-3"
            >
              <div className="text-sm font-semibold text-huyen-lam">
                Mời &amp; cấp quyền trước cho email Google
              </div>
              {formError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {formError}
                </div>
              )}
              {isEmailReplacedTemp && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Email tạm này đã bị loại khỏi danh sách dự kiến. Vui lòng dùng Gmail chính thức mới thay thế.
                  </span>
                </div>
              )}
              {isEmailTemporary && !isEmailReplacedTemp && (
                <div className="p-2.5 bg-minh-kim-soft border border-minh-kim-border rounded-lg text-xs text-minh-kim-ink flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Email này thuộc danh sách <strong>tài khoản tạm thời</strong>. Hệ thống không tự cấp quyền Admin hoặc quyền phê duyệt; giữ vai trò mặc định là Member.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-huyen-lam/85 mb-1">
                    Tên hiển thị
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="VD: Quốc"
                    className="w-full px-3 py-2 text-sm bg-white border border-nga-xam rounded-lg focus:outline-none focus:ring-2 focus:ring-lam-tri-tue min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-huyen-lam/85 mb-1">
                    Email Google
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    placeholder="ten@gmail.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-nga-xam rounded-lg focus:outline-none focus:ring-2 focus:ring-lam-tri-tue min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-huyen-lam/85 mb-1">
                    Ghép tên trong công việc
                  </label>
                  <select
                    value={sheetAlias}
                    onChange={(e) => setSheetAlias(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-nga-xam rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-lam-tri-tue min-h-[42px]"
                  >
                    <option value="">-- Chưa ghép --</option>
                    {EXPECTED_TBHGN_ACCOUNTS.map((acc) => (
                      <option key={acc.originalName} value={acc.originalName}>
                        {formatStandardMemberLabel(acc)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-huyen-lam/85 mb-1">
                    Vai trò
                  </label>
                  <select
                    value={role}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      if (isEmailTemporary && nextRole === 'admin') return;
                      setRole(nextRole);
                      if (isEmailTemporary) setCanApprove(false);
                    }}
                    className="w-full px-3 py-2 text-sm border border-nga-xam rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-lam-tri-tue min-h-[42px]"
                  >
                    <option value="member">Member (Cập nhật việc được giao)</option>
                    <option value="moderator">Moderator (Quản lý hạng mục &amp; công việc)</option>
                    <option value="viewer">Viewer (Chỉ đọc)</option>
                    <option value="admin" disabled={isEmailTemporary}>
                      Admin (Toàn quyền){isEmailTemporary ? ' — khóa với tài khoản tạm' : ''}
                    </option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-huyen-lam/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      role === 'admin' || role === 'moderator'
                        ? true
                        : !isEmailTemporary && canApprove
                    }
                    disabled={role === 'admin' || role === 'moderator' || isEmailTemporary}
                    onChange={(e) => setCanApprove(e.target.checked)}
                    className="w-4 h-4 rounded border-nga-xam accent-huyen-lam"
                  />
                  <span>
                    Cấp quyền phê duyệt công việc hoàn thành (trong phạm vi được giao)
                    {isEmailTemporary && role === 'member' ? ' — tắt với tài khoản tạm' : ''}
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 text-xs font-medium text-ink-muted hover:text-huyen-lam min-h-[40px]"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-medium bg-huyen-lam text-white rounded-lg hover:bg-lam-tri-tue disabled:opacity-50 transition-colors min-h-[40px]"
                  >
                    {submitting ? 'Đang lưu...' : 'Lưu lời mời'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Step 1: Signed-in Accounts -> Confirm Staff Identity & Role */}
          <div className="bg-white border border-nga-xam rounded-xl divide-y divide-nga-xam/60 overflow-hidden">
            <div className="px-4 py-3 bg-nga-thien border-b border-nga-xam space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-huyen-lam">
                <span>
                  <span className="text-chu-sa">Bước 1</span> · Xác nhận nhân sự &amp; quyền tài khoản ({members.length})
                </span>
              </div>
              <p className="text-[11px] text-ink-muted">
                Chọn đúng nhân sự dự án để liên kết tên gốc với tài khoản Google và cấp vai trò (chưa tự giao công việc). Sau đó chuyển xuống <strong>Bước 2</strong> bên dưới để xem trước và xác nhận gán từng đầu việc.
              </p>
            </div>
            {members.map((m) => {
              const isSelf = m.uid === currentUser.uid;
              const isTemp = isTemporaryAccountEmail(m.email);
              const replacedTempSpec = getReplacedTemporaryAccount(m.email);
              const matchedSpec = !replacedTempSpec
                ? EXPECTED_TBHGN_ACCOUNTS.find((acc) =>
                    getExpectedAccountAliases(acc).some(
                      (alias) =>
                        normalizeTextKey(alias) === normalizeTextKey(m.sheetAlias)
                    )
                  )
                : undefined;
              const emailMatchedSpec =
                !replacedTempSpec && !matchedSpec
                  ? EXPECTED_TBHGN_ACCOUNTS.find(
                      (acc) =>
                        normalizeTextKey(acc.email) === normalizeTextKey(m.email)
                    )
                  : undefined;
              const effectiveSpec = matchedSpec ?? emailMatchedSpec;
              const matchedPreviewRow = effectiveSpec
                ? mappingPreview.accountRows.find(
                    (r) => r.account.originalName === effectiveSpec.originalName
                  )
                : undefined;
              const isRenaming = renamingUid === m.uid;
              return (
                <div
                  key={m.uid}
                  className={`p-3.5 sm:p-4 space-y-3 ${
                    !m.isActive ? 'bg-nga-thien opacity-75' : ''
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-huyen-lam">
                          {m.displayName}
                        </span>
                        {isSelf && (
                          <span className="text-[11px] font-medium text-lam-tri-tue">
                            (Bạn)
                          </span>
                        )}
                        {replacedTempSpec ? (
                          <span className="text-[11px] font-medium text-chu-sa">
                            (Gmail tạm cũ · đã thay bằng {replacedTempSpec.newEmail})
                          </span>
                        ) : (
                          isTemp && (
                            <span className="text-[11px] font-medium text-minh-kim-ink">
                              (Tạm thời)
                            </span>
                          )
                        )}
                        {!m.isActive && (
                          <span className="text-[11px] font-medium text-red-700">
                            Đã khóa
                          </span>
                        )}
                        {m.role === 'viewer' && m.isActive && (
                          <span className="text-[11px] font-medium text-minh-kim-ink">
                            · Đang là Viewer (Chỉ đọc)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono-tabular break-all">{m.email}</span>
                        {replacedTempSpec ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-minh-kim-ink">
                              Nhân sự cũ: {replacedTempSpec.originalName} (giữ lịch sử, đối chiếu bên dưới)
                            </span>
                          </>
                        ) : matchedSpec ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-800 font-medium">
                              Đã xác nhận nhân sự: {formatStandardMemberLabel(matchedSpec)}
                            </span>
                          </>
                        ) : emailMatchedSpec ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-lam-tri-tue font-medium">
                              Khớp email với {formatStandardMemberLabel(emailMatchedSpec)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateMember(m.uid, m.email, {
                                  sheetAlias: emailMatchedSpec.originalName,
                                })
                              }
                              className="inline-flex items-center px-2 py-0.5 rounded border border-lam-tri-tue/40 bg-nga-thien text-[11px] font-semibold text-huyen-lam hover:bg-surface-muted transition-colors"
                            >
                              Xác nhận gắn &ldquo;{emailMatchedSpec.originalName}&rdquo; (giữ nguyên quyền)
                            </button>
                          </>
                        ) : m.sheetAlias ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Tên đối chiếu: {m.sheetAlias}</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-ink-muted/75">Chưa xác nhận nhân sự</span>
                          </>
                        )}
                      </div>
                      {matchedPreviewRow && m.isActive && matchedPreviewRow.readyToConfirmCount > 0 && (
                        <div className="mt-1.5 text-[11px] text-huyen-lam">
                          Có <strong>{matchedPreviewRow.readyToConfirmCount}</strong> công việc mang tên &ldquo;
                          {effectiveSpec?.legacyAliases?.length
                            ? `${effectiveSpec.originalName} / ${effectiveSpec.legacyAliases.join(', ')}`
                            : effectiveSpec?.originalName}
                          &rdquo; chưa gán tài khoản này — xác nhận ở Bước 2 bên dưới.
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openRenameForMember(m)}
                        aria-expanded={isRenaming}
                        className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border min-h-[42px] transition-colors ${
                          isRenaming
                            ? 'bg-huyen-lam border-huyen-lam text-white'
                            : 'bg-white border-nga-xam text-huyen-lam hover:bg-nga-thien'
                        }`}
                      >
                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                        <span>Đổi tên hiển thị</span>
                      </button>

                      <select
                        aria-label={`Xác nhận nhân sự cho ${m.displayName}`}
                        value={matchedSpec ? matchedSpec.originalName : ''}
                        disabled={Boolean(replacedTempSpec)}
                        onChange={(e) => {
                          const nextAlias = e.target.value;
                          onUpdateMember(m.uid, m.email, {
                            sheetAlias: nextAlias,
                          });
                        }}
                        className="col-span-2 sm:col-span-1 px-2.5 py-2 text-xs bg-white border border-nga-xam rounded-lg text-huyen-lam disabled:bg-surface-muted min-h-[42px]"
                      >
                        <option value="">-- Xác nhận nhân sự --</option>
                        {EXPECTED_TBHGN_ACCOUNTS.map((acc) => (
                          <option key={acc.originalName} value={acc.originalName}>
                            {formatStandardMemberLabel(acc)}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label={`Vai trò của ${m.displayName}`}
                        value={m.role}
                        disabled={isSelf}
                        onChange={(e) => {
                          const nextRole = e.target.value as UserRole;
                          if (isTemp && nextRole === 'admin') return;
                          onUpdateMember(m.uid, m.email, {
                            role: nextRole,
                            ...(nextRole === 'admin' || nextRole === 'moderator'
                              ? { canApprove: true }
                              : isTemp
                              ? { canApprove: false }
                              : {}),
                          });
                        }}
                        className="px-2.5 py-2 text-xs bg-white border border-nga-xam rounded-lg text-huyen-lam disabled:bg-surface-muted min-h-[42px]"
                      >
                        <option value="admin" disabled={isTemp && m.role !== 'admin'}>
                          Admin
                        </option>
                        <option value="moderator">Moderator</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (isTemp && !m.canApprove) return;
                          onUpdateMember(m.uid, m.email, {
                            canApprove: !m.canApprove,
                          });
                        }}
                        className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border min-h-[42px] transition-colors disabled:opacity-50 ${
                          m.canApprove || m.role === 'admin' || m.role === 'moderator'
                            ? 'bg-minh-kim-soft border-minh-kim-border text-minh-kim-ink'
                            : 'bg-white border-nga-xam text-ink-muted hover:bg-nga-thien'
                        }`}
                        disabled={
                          m.role === 'admin' ||
                          m.role === 'moderator' ||
                          (isTemp && !m.canApprove)
                        }
                        title={
                          isTemp && !m.canApprove
                            ? 'Tài khoản tạm thời không tự cấp quyền phê duyệt'
                            : 'Quyền phê duyệt công việc'
                        }
                      >
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {m.canApprove || m.role === 'admin' || m.role === 'moderator'
                            ? 'Được duyệt'
                            : 'Không duyệt'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() =>
                          onUpdateMember(m.uid, m.email, {
                            isActive: !m.isActive,
                          })
                        }
                        className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium rounded-lg border min-h-[42px] disabled:opacity-40 transition-colors ${
                          m.isActive
                            ? 'bg-white border-nga-xam text-huyen-lam/85 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}
                      >
                        {m.isActive ? (
                          <>
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>Khóa</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5 shrink-0" />
                            <span>Mở khóa</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {isRenaming && (
                    <div className="bg-[#FAF8F3] border border-[#E5DFD2] rounded-xl p-3 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor={`rename-input-${m.uid}`}
                            className="block text-xs font-semibold text-huyen-lam mb-1"
                          >
                            Tên hiển thị trong dự án
                          </label>
                          <input
                            id={`rename-input-${m.uid}`}
                            type="text"
                            maxLength={120}
                            autoFocus
                            value={renameDraft}
                            disabled={savingRename}
                            onChange={(e) => {
                              setRenameDraft(e.target.value);
                              if (renameError) setRenameError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveRename(m);
                              }
                              if (e.key === 'Escape') {
                                setRenamingUid(null);
                                setRenameError(null);
                              }
                            }}
                            placeholder="VD: Sư Tín"
                            className="w-full h-[38px] px-3 text-sm bg-white border border-[#DFD8CA] rounded-lg text-huyen-lam focus:outline-none focus:ring-2 focus:ring-lam-sang/25 focus:border-lam-sang"
                          />
                        </div>
                        <div>
                          <div className="block text-xs font-medium text-ink-muted mb-1">
                            Email Google (chỉ đọc)
                          </div>
                          <div className="w-full h-[38px] px-3 text-xs font-mono-tabular bg-white/70 border border-[#E5DFD2] rounded-lg text-ink-muted flex items-center justify-between gap-2 truncate">
                            <span className="truncate">{m.email}</span>
                            <span className="shrink-0 text-[11px] font-sans font-medium text-huyen-lam/80 capitalize">
                              {m.role}
                            </span>
                          </div>
                        </div>
                      </div>

                      {renameError && (
                        <div className="text-xs text-chu-sa font-medium">
                          {renameError}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-ink-muted">
                          Giữ nguyên tài khoản, vai trò, quyền duyệt và lịch sử công việc.
                        </span>
                        <div className="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            disabled={savingRename}
                            onClick={() => {
                              setRenamingUid(null);
                              setRenameError(null);
                            }}
                            className="px-3 h-[34px] text-xs font-medium text-ink-muted hover:text-huyen-lam"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            disabled={savingRename}
                            onClick={() => void handleSaveRename(m)}
                            className="px-4 h-[34px] text-xs font-semibold bg-huyen-lam text-white rounded-lg hover:bg-lam-tri-tue disabled:opacity-50 transition-colors"
                          >
                            {savingRename ? 'Đang lưu...' : 'Lưu'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending Google Email Invites */}
          {pendingInvites.length > 0 && (
            <div className="bg-white border border-nga-xam rounded-xl divide-y divide-nga-xam/60 overflow-hidden">
              <div className="px-4 py-2.5 bg-nga-thien border-b border-nga-xam text-xs font-semibold text-ink-muted flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Đã mời trước · Chờ đăng nhập Google ({pendingInvites.length})</span>
              </div>
              {pendingInvites.map((inv) => {
                const isTemp = isTemporaryAccountEmail(inv.email);
                return (
                  <div
                    key={inv.email}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-huyen-lam">
                          {inv.displayName}
                        </span>
                        {isTemp && (
                          <span className="text-[11px] font-medium text-minh-kim-ink">
                            (Tạm thời)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="font-mono-tabular break-all">{inv.email}</span>
                        {inv.sheetAlias && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Ghép: {inv.sheetAlias}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <select
                        aria-label={`Vai trò lời mời ${inv.email}`}
                        value={inv.role}
                        onChange={(e) => {
                          const nextRole = e.target.value as UserRole;
                          if (isTemp && nextRole === 'admin') return;
                          onUpdateInvite(inv.email, {
                            role: nextRole,
                            ...(nextRole === 'admin' || nextRole === 'moderator'
                              ? { canApprove: true }
                              : isTemp
                              ? { canApprove: false }
                              : {}),
                          });
                        }}
                        className="px-2.5 py-1.5 text-xs bg-white border border-nga-xam rounded-lg text-huyen-lam min-h-[38px]"
                      >
                        <option value="admin" disabled={isTemp && inv.role !== 'admin'}>
                          Admin
                        </option>
                        <option value="moderator">Moderator</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => onDeleteInvite(inv.email)}
                        aria-label={`Thu hồi lời mời ${inv.email}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 min-h-[38px]"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Thu hồi</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Audit & Cleanup for Replaced Legacy Temporary Gmail Accounts (filmfata01/02/04/05) */}
          {hasReplacedItems && (
            <div className="bg-white border border-minh-kim-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-minh-kim-soft/70 border-b border-minh-kim-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-huyen-lam flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-minh-kim-ink shrink-0" />
                    <span>Đối chiếu Gmail tạm cũ đã được thay thế</span>
                  </h2>
                  <p className="text-[11px] text-ink-muted mt-0.5">
                    Không tự xóa hồ sơ, lịch sử hay UID đang gắn trên công việc. Có thể xóa các lời mời tạm cũ còn sót và kiểm tra chuyển UID khi Gmail mới đã đăng nhập.
                  </p>
                </div>
                {replacedOldInvites.length > 0 && (
                  <button
                    type="button"
                    disabled={removingOldInvites}
                    onClick={handleDeleteAllReplacedInvites}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {removingOldInvites
                        ? 'Đang xóa...'
                        : `Xóa ${replacedOldInvites.length} lời mời tạm cũ`}
                    </span>
                  </button>
                )}
              </div>

              <div className="divide-y divide-nga-xam/60">
                {replacedAudit
                  .filter((item) => item.oldInvite || item.oldMember)
                  .map((item) => {
                    const {
                      spec,
                      oldInvite,
                      oldMember,
                      newMember,
                      tasksHoldingOldUid,
                      canTransferNow,
                      recommendLockOldMember,
                    } = item;
                    const isTransferOpen =
                      transferPreviewEmail === spec.oldEmail;
                    const fb =
                      transferFeedback?.email === spec.oldEmail
                        ? transferFeedback
                        : null;

                    return (
                      <div key={spec.oldEmail} className="p-3.5 sm:p-4 space-y-2.5 text-xs">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-huyen-lam">
                                {spec.originalName !== spec.displayName
                                  ? `${spec.originalName} (${spec.displayName})`
                                  : spec.displayName}
                              </span>
                              <span className="font-mono-tabular text-red-700 line-through">
                                {spec.oldEmail}
                              </span>
                              <span aria-hidden="true">→</span>
                              <span className="font-mono-tabular font-semibold text-emerald-800">
                                {spec.newEmail}
                              </span>
                            </div>

                            <div className="text-[11px] text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {oldInvite && (
                                <span className="text-minh-kim-ink font-medium">
                                  Còn lời mời tạm trong /invites
                                </span>
                              )}
                              {oldInvite && oldMember && <span aria-hidden="true">·</span>}
                              {oldMember && (
                                <span>
                                  Hồ sơ cũ:{' '}
                                  <strong className="text-huyen-lam">
                                    {oldMember.isActive ? 'Đang hoạt động' : 'Đã khóa'}
                                  </strong>{' '}
                                  · Đang gắn{' '}
                                  <strong className="text-huyen-lam">
                                    {tasksHoldingOldUid.length}
                                  </strong>{' '}
                                  công việc
                                  {tasksHoldingOldUid.length > 0
                                    ? ` (${tasksHoldingOldUid
                                        .map((t) => t.displayCode)
                                        .join(', ')})`
                                    : ''}
                                </span>
                              )}
                            </div>

                            {oldMember && tasksHoldingOldUid.length > 0 && !newMember && (
                              <div className="text-[11px] text-minh-kim-ink">
                                Chờ <strong>{spec.newEmail}</strong> đăng nhập Google lần đầu để có UID thật trước khi Admin xác nhận chuyển {tasksHoldingOldUid.length} công việc.
                              </div>
                            )}

                            {recommendLockOldMember && (
                              <div className="text-[11px] text-emerald-800 font-medium">
                                Đã đối chiếu xong (0 công việc còn gắn UID cũ) — Đề xuất Admin khóa tài khoản cũ này (vẫn giữ nguyên hồ sơ &amp; lịch sử).
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {oldInvite && (
                              <button
                                type="button"
                                onClick={() => onDeleteInvite(oldInvite.email)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 min-h-[38px]"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Xóa lời mời cũ</span>
                              </button>
                            )}

                            {canTransferNow && onTransferTaskUid && (
                              <button
                                type="button"
                                onClick={() => openTransferPreview(item)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border min-h-[38px] transition-colors ${
                                  isTransferOpen
                                    ? 'bg-huyen-lam text-white border-huyen-lam'
                                    : 'bg-white text-huyen-lam border-huyen-lam hover:bg-nga-thien'
                                }`}
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {isTransferOpen
                                    ? 'Đóng xem trước'
                                    : `Chuyển UID (${tasksHoldingOldUid.length} việc)`}
                                </span>
                              </button>
                            )}

                            {recommendLockOldMember && oldMember && (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateMember(oldMember.uid, oldMember.email, {
                                    isActive: false,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-huyen-lam bg-nga-thien border border-nga-xam rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 min-h-[38px]"
                              >
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                <span>Khóa tài khoản cũ</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {fb && (
                          <div
                            className={`p-2.5 rounded-lg border text-xs ${
                              fb.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                          >
                            {fb.text}
                          </div>
                        )}

                        {isTransferOpen && oldMember && newMember && (
                          <div className="bg-nga-thien border border-nga-xam rounded-lg p-3 space-y-2.5">
                            <div>
                              <div className="font-semibold text-huyen-lam">
                                Xác nhận chuyển UID công việc từ {oldMember.email} sang {newMember.email}
                              </div>
                              <p className="text-[11px] text-ink-muted mt-0.5">
                                Hệ thống sẽ thay UID cũ bằng UID mới trên các công việc bạn chọn; toàn bộ tên phụ trách gốc, trạng thái, liên kết và lịch sử cập nhật được giữ nguyên.
                              </p>
                            </div>

                            <div className="bg-white border border-nga-xam rounded-lg divide-y divide-nga-xam/60">
                              {tasksHoldingOldUid.map((t) => {
                                const checked = transferTaskIds.includes(t.id);
                                return (
                                  <label
                                    key={t.id}
                                    className="p-2.5 flex items-start gap-2.5 cursor-pointer hover:bg-nga-thien"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={transferringUid}
                                      onChange={() =>
                                        setTransferTaskIds((prev) =>
                                          prev.includes(t.id)
                                            ? prev.filter((id) => id !== t.id)
                                            : [...prev, t.id]
                                        )
                                      }
                                      className="mt-0.5 w-4 h-4 rounded border-nga-xam accent-huyen-lam"
                                    />
                                    <div className="min-w-0">
                                      <div className="font-medium text-huyen-lam">
                                        <span className="font-mono-tabular font-bold mr-1.5">
                                          {t.displayCode}
                                        </span>
                                        {t.title}
                                      </div>
                                      <div className="text-[11px] text-ink-muted">
                                        Tên gốc: {t.assignees.join(', ') || 'Chưa gắn tên'} · Trạng thái: {t.status ?? 'Cần rà soát'}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setTransferPreviewEmail(null)}
                                className="px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-huyen-lam min-h-[38px]"
                              >
                                Hủy
                              </button>
                              <button
                                type="button"
                                disabled={
                                  transferringUid || transferTaskIds.length === 0
                                }
                                onClick={() => handleConfirmTransferUid(item)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-huyen-lam text-white rounded-lg hover:bg-lam-tri-tue disabled:opacity-50 min-h-[38px]"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {transferringUid
                                    ? 'Đang chuyển UID...'
                                    : `Xác nhận chuyển UID (${transferTaskIds.length} việc)`}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* 6 Standardized Project Members & Task Pairing Overview */}
          <div className="bg-white border border-nga-xam rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-nga-thien border-b border-nga-xam flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-huyen-lam">
                  Danh sách 6 thành viên dự án &amp; đối chiếu công việc
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  Tổng hợp từ {mappingPreview.scopeLabel}. Việc chưa xác nhận tài khoản vẫn giữ nguyên tên phụ trách gốc.
                </p>
              </div>
              <span className="text-xs font-medium text-ink-muted whitespace-nowrap">
                {mappingPreview.signedInExpectedCount}/{EXPECTED_TBHGN_ACCOUNTS.length} đã liên kết tài khoản
              </span>
            </div>

            <div className="p-4 space-y-4">
              {/* Compact Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-nga-thien/60 border border-nga-xam rounded-lg">
                  <div className="text-[11px] text-ink-muted">
                    Thành viên đã có tài khoản
                  </div>
                  <div className="text-base font-bold font-mono-tabular text-huyen-lam mt-0.5">
                    {mappingPreview.signedInExpectedCount} / {EXPECTED_TBHGN_ACCOUNTS.length}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {mappingPreview.invitedPendingExpectedCount} đã mời chờ đăng nhập
                  </div>
                </div>

                <div className="p-3 bg-nga-thien/60 border border-nga-xam rounded-lg">
                  <div className="text-[11px] text-ink-muted">
                    Gmail dự kiến tạm thời
                  </div>
                  <div className="text-base font-bold font-mono-tabular text-huyen-lam mt-0.5">
                    {mappingPreview.temporaryExpectedCount} tài khoản
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    Không tự cấp Admin hay quyền duyệt
                  </div>
                </div>

                <div className="p-3 bg-minh-kim-soft/50 border border-minh-kim-border rounded-lg">
                  <div className="text-[11px] text-minh-kim-ink">
                    Công việc chưa liên kết tài khoản
                  </div>
                  <div className="text-base font-bold font-mono-tabular text-minh-kim-ink mt-0.5">
                    {mappingPreview.tasksUnlinkedUidCount} / {mappingPreview.scopeTaskCount}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {mappingPreview.tasksWithTextButNoUidCount} việc có tên · {mappingPreview.tasksNoAssigneeAtAllCount} việc chưa phân công
                  </div>
                </div>
              </div>

              {/* Step 2: 6 Standardized Members -> Preview Matching Tasks & Explicitly Confirm UID Assignment */}
              <div className="border border-nga-xam rounded-lg overflow-hidden">
                <div className="px-3.5 py-2.5 bg-nga-thien border-b border-nga-xam space-y-0.5">
                  <div className="text-xs font-semibold text-huyen-lam">
                    <span className="text-chu-sa">Bước 2</span> · Giao công việc cho 6 nhân sự dự án (xem trước &amp; xác nhận gán UID)
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    Admin bấm <strong>Xem &amp; giao việc</strong> trên từng nhân sự đã xác nhận tài khoản để xem các đầu việc có tên gốc tương ứng, chọn các việc muốn gán UID và bấm xác nhận. Tên gốc trên công việc luôn được giữ nguyên.
                  </p>
                </div>
                <div className="divide-y divide-nga-xam/60">
                  {mappingPreview.accountRows.map((row) => {
                    const {
                      account,
                      signInStatus,
                      matchedMember,
                      matchingTaskCodes,
                      linkedTaskCodes,
                      readyToConfirmCount,
                      hasPrivilegeWarning,
                    } = row;
                    const isPreviewOpen = assignPreviewKey === account.originalName;
                    const matchingTasksForPerson = officialActiveTasks.filter((t) =>
                      doesTaskMatchExpectedAccount(t, account)
                    );
                    const feedbackForRow =
                      assignFeedback?.key === account.originalName
                        ? assignFeedback
                        : null;

                    return (
                      <div key={account.originalName} className="p-3.5 space-y-3 text-xs">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-huyen-lam text-sm">
                                {formatStandardMemberLabel(account)}
                              </span>
                              <span className="font-mono-tabular text-ink-muted break-all">
                                {account.email}
                              </span>
                              <span
                                className={`text-[11px] font-medium ${
                                  account.isTemporary
                                    ? 'text-minh-kim-ink'
                                    : 'text-lam-tri-tue'
                                }`}
                              >
                                ({account.isTemporary ? 'Tạm thời' : 'Chính thức'})
                              </span>
                            </div>
                            <div className="text-[11px] text-ink-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>
                                Công việc mang tên &ldquo;
                                {account.legacyAliases?.length
                                  ? `${account.originalName} / ${account.legacyAliases.join(', ')}`
                                  : account.originalName}
                                &rdquo;:{' '}
                                <strong className="text-huyen-lam">
                                  {matchingTaskCodes.length} việc
                                </strong>
                                {matchingTaskCodes.length > 0
                                  ? ` (${matchingTaskCodes.join(', ')})`
                                  : ''}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Đã giao tài khoản:{' '}
                                <strong className="text-huyen-lam">
                                  {linkedTaskCodes.length}/{matchingTaskCodes.length}
                                </strong>
                              </span>
                              {matchedMember && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Tài khoản: {matchedMember.email} ({matchedMember.role}
                                    {matchedMember.canApprove ? ', Được duyệt' : ''})
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="text-[11px] text-ink-muted/90">
                              {account.note}
                            </div>
                            {hasPrivilegeWarning && (
                              <div className="mt-1 p-2 rounded-lg bg-minh-kim-soft border border-minh-kim-border text-[11px] text-minh-kim-ink flex items-start gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                  Cảnh báo: Tài khoản tạm thời đang có quyền Admin hoặc quyền duyệt. Nên hạ về Member và tắt quyền duyệt ở Bước 1.
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {signInStatus === 'signed_in' ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    {matchedMember && !matchedMember.isActive
                                      ? 'Đã đăng nhập (Đã khóa)'
                                      : readyToConfirmCount > 0
                                      ? `${readyToConfirmCount} việc chờ giao`
                                      : 'Đã giao đủ việc'}
                                  </span>
                                </span>
                                {matchedMember &&
                                  matchedMember.isActive &&
                                  matchingTasksForPerson.length > 0 &&
                                  onAssignTasksToMember && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openAssignPreview(
                                          account,
                                          matchedMember
                                        )
                                      }
                                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium min-h-[40px] transition-colors ${
                                        isPreviewOpen
                                          ? 'bg-huyen-lam text-white border-huyen-lam'
                                          : 'bg-white text-huyen-lam border-huyen-lam hover:bg-nga-thien'
                                      }`}
                                    >
                                      <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                                      <span>
                                        {isPreviewOpen
                                          ? 'Đóng xem trước'
                                          : readyToConfirmCount > 0
                                          ? `Xem & giao việc (${readyToConfirmCount})`
                                          : 'Xem việc đã giao'}
                                      </span>
                                    </button>
                                  )}
                              </>
                            ) : signInStatus === 'invited_pending' ? (
                              <span className="inline-flex items-center gap-1.5 text-ink-muted font-medium">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                <span>Đã mời · Chờ đăng nhập Google</span>
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-minh-kim-ink font-medium">
                                  <Link2Off className="w-3.5 h-3.5 shrink-0" />
                                  <span>Chưa mời / Chưa đăng nhập</span>
                                </span>
                                {normalizeTextKey(account.email) !==
                                  'ngaothuyet2023@gmail.com' && (
                                  <button
                                    type="button"
                                    disabled={invitingEmail === account.email}
                                    onClick={() =>
                                      handleQuickInviteExpected(account)
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-huyen-lam bg-white text-huyen-lam text-xs font-medium hover:bg-nga-thien disabled:opacity-50 min-h-[38px]"
                                  >
                                    <UserPlus className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {invitingEmail === account.email
                                        ? 'Đang mời...'
                                        : 'Tạo lời mời (Member)'}
                                    </span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {feedbackForRow && (
                          <div
                            className={`p-2.5 rounded-lg border text-xs ${
                              feedbackForRow.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                          >
                            {feedbackForRow.text}
                          </div>
                        )}

                        {isPreviewOpen && matchedMember && matchedMember.isActive && (
                          <div className="bg-nga-thien border border-nga-xam rounded-lg p-3 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <div className="font-semibold text-huyen-lam">
                                  Xem trước các công việc có tên &ldquo;{account.originalName}&rdquo; để giao cho {matchedMember.displayName} ({matchedMember.email})
                                </div>
                                <p className="text-[11px] text-ink-muted mt-0.5">
                                  Chỉ các công việc bạn tích chọn và bấm xác nhận mới được gán UID. Tên phụ trách gốc và vai trò tài khoản không tự thay đổi.
                                </p>
                              </div>
                              {readyToConfirmCount > 0 && (
                                <div className="flex items-center gap-2 shrink-0 text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedTaskIds(
                                        matchingTasksForPerson
                                          .filter(
                                            (t) =>
                                              !t.assigneeUids.includes(
                                                matchedMember.uid
                                              )
                                          )
                                          .map((t) => t.id)
                                      )
                                    }
                                    className="text-huyen-lam font-medium hover:text-lam-tri-tue hover:underline"
                                  >
                                    Chọn tất cả chưa gán
                                  </button>
                                  <span aria-hidden="true">·</span>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTaskIds([])}
                                    className="text-ink-muted hover:text-huyen-lam hover:underline"
                                  >
                                    Bỏ chọn
                                  </button>
                                </div>
                              )}
                            </div>

                            {matchedMember.role === 'viewer' && (
                              <div className="p-2.5 bg-minh-kim-soft border border-minh-kim-border rounded-lg text-[11px] text-minh-kim-ink flex items-start gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                  Tài khoản này hiện có vai trò <strong>Viewer (Chỉ đọc)</strong>. Sau khi giao việc, bạn cần đổi vai trò lên <strong>Member</strong> ở Bước 1 nếu muốn người này cập nhật tiến độ.
                                </span>
                              </div>
                            )}

                            <div className="bg-white border border-nga-xam rounded-lg divide-y divide-nga-xam/60">
                              {matchingTasksForPerson.map((task) => {
                                const alreadyAssigned = task.assigneeUids.includes(
                                  matchedMember.uid
                                );
                                const isChecked =
                                  alreadyAssigned ||
                                  selectedTaskIds.includes(task.id);
                                return (
                                  <label
                                    key={task.id}
                                    className={`p-2.5 flex items-start justify-between gap-2.5 text-xs ${
                                      alreadyAssigned
                                        ? 'bg-emerald-50/40 cursor-default'
                                        : 'hover:bg-nga-thien cursor-pointer'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2.5 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        disabled={alreadyAssigned || assigningTasks}
                                        onChange={() => {
                                          if (alreadyAssigned) return;
                                          setSelectedTaskIds((prev) =>
                                            prev.includes(task.id)
                                              ? prev.filter((id) => id !== task.id)
                                              : [...prev, task.id]
                                          );
                                        }}
                                        className="mt-0.5 w-4 h-4 rounded border-nga-xam accent-huyen-lam"
                                      />
                                      <div className="min-w-0">
                                        <div className="flex items-baseline gap-1.5 flex-wrap">
                                          <span className="font-mono-tabular font-bold text-huyen-lam">
                                            {task.displayCode}
                                          </span>
                                          <span className="font-medium text-huyen-lam break-words">
                                            {task.title}
                                          </span>
                                        </div>
                                        <div className="text-[11px] text-ink-muted mt-0.5">
                                          Tên gốc: {task.assignees.join(', ')} · Trạng thái: {task.status ?? 'Cần rà soát'}
                                        </div>
                                      </div>
                                    </div>
                                    <span
                                      className={`shrink-0 text-[11px] font-medium ${
                                        alreadyAssigned
                                          ? 'text-emerald-800'
                                          : 'text-minh-kim-ink'
                                      }`}
                                    >
                                      {alreadyAssigned ? 'Đã gán UID' : 'Chưa gán UID'}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setAssignPreviewKey(null)}
                                className="px-3.5 py-2 text-xs font-medium text-ink-muted hover:text-huyen-lam min-h-[40px]"
                              >
                                Đóng
                              </button>
                              {readyToConfirmCount > 0 && (
                                <button
                                  type="button"
                                  disabled={
                                    assigningTasks || selectedTaskIds.length === 0
                                  }
                                  onClick={() =>
                                    handleConfirmAssignTasks(
                                      account.originalName,
                                      matchedMember
                                    )
                                  }
                                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-huyen-lam text-white rounded-lg hover:bg-lam-tri-tue disabled:opacity-50 transition-colors min-h-[42px]"
                                >
                                  <ClipboardCheck className="w-4 h-4 shrink-0" />
                                  <span>
                                    {assigningTasks
                                      ? 'Đang giao công việc...'
                                      : `Xác nhận giao ${selectedTaskIds.length} công việc đã chọn`}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Alias -> Account Overview + Separate Collective "Nhóm" Note */}
              <div className="border border-nga-xam rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-nga-thien border-b border-nga-xam text-xs font-semibold text-huyen-lam/85">
                  2. Trạng thái đối chiếu từng thành viên trong {mappingPreview.scopeLabel}
                </div>
                {mappingPreview.aliasRows.length === 0 ? (
                  <div className="p-4 text-xs text-ink-muted">
                    Chưa có tên người thực hiện nào trong danh sách công việc hiện tại.
                  </div>
                ) : (
                  <div className="divide-y divide-nga-xam/60">
                    {mappingPreview.aliasRows.map((row) => (
                      <div
                        key={row.alias}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-huyen-lam">
                              {row.expectedAccount
                                ? formatStandardMemberLabel(row.expectedAccount)
                                : row.alias}
                            </span>
                            <span className="text-ink-muted">
                              ({row.taskCount} việc: {row.taskCodes.join(', ')})
                            </span>
                          </div>
                          <div className="text-[11px] text-ink-muted">
                            {row.matchedMembers.length > 0 ? (
                              <span>
                                Tài khoản đã ghép:{' '}
                                {row.matchedMembers
                                  .map((m) => m.email)
                                  .join(', ')}
                              </span>
                            ) : row.matchedPendingInvites.length > 0 ? (
                              <span>
                                Đã mời{' '}
                                {row.matchedPendingInvites
                                  .map((i) => i.email)
                                  .join(', ')}{' '}
                                — chờ đăng nhập lần đầu.
                              </span>
                            ) : row.expectedAccount ? (
                              <span>
                                Gmail dự kiến: {row.expectedAccount.email} — chưa liên kết tài khoản.
                              </span>
                            ) : (
                              <span>
                                Chưa có tài khoản tương ứng — giữ nguyên tên gốc.
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5 font-medium">
                          {row.linkStatus === 'linked' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>{row.statusLabel}</span>
                            </span>
                          ) : row.linkStatus === 'ready_to_link' ? (
                            <span className="inline-flex items-center gap-1 text-huyen-lam">
                              <UserCheck className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {row.statusLabel} ({row.linkedTaskCount}/{row.taskCount})
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-minh-kim-ink">
                              <Link2Off className="w-3.5 h-3.5 shrink-0" />
                              <span>{row.statusLabel}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {mappingPreview.collectiveGroupTaskCodes.length > 0 && (
                  <div className="px-3.5 py-2.5 bg-nga-thien border-t border-nga-xam text-xs text-ink-muted flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                    <span>
                      Nhãn tập thể <strong>&ldquo;{COLLECTIVE_GROUP_LABEL}&rdquo;</strong> (việc{' '}
                      {mappingPreview.collectiveGroupTaskCodes.join(', ')}) là nhóm làm việc chung, không phải tài khoản Google cá nhân.
                    </span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-nga-thien border border-nga-xam rounded-lg text-xs text-ink-muted flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-huyen-lam" />
                <span>
                  Khi muốn thay đổi người phụ trách sang tài khoản Google chính thức sau này, Admin mở chi tiết công việc, tích chọn tài khoản mới và bỏ tích tài khoản cũ — toàn bộ trạng thái, liên kết tài liệu và lịch sử cập nhật vẫn được giữ nguyên.
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
