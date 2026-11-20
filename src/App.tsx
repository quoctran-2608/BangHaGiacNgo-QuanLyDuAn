import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileJson,
  FolderKanban,
  LayoutDashboard,
  Library,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Settings,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { auth, db, googleProvider } from './firebase';
import {
  AppRoute,
  AuthSettings,
  CategoryItem,
  MemberDirectoryStatus,
  MemberDirectorySyncResult,
  MemberInvite,
  ProjectMember,
  TaskCategory,
  TaskItem,
  TaskStatus,
  UserRole,
} from './types/project';
import {
  addCommentInFirestore,
  archiveOrRestoreTaskInFirestore,
  assignMemberToTasksInFirestore,
  AuthResolutionResult,
  bootstrapOwnerAdmin,
  createCategoryInFirestore,
  createOrUpdateInvite,
  createTaskInFirestore,
  deleteUnusedCategoryInFirestore,
  importOfficialTasksToFirestore,
  removeInviteInFirestore,
  resolveUserMembership,
  seedDefaultCategories,
  subscribeAuthSettings,
  subscribeCategories,
  subscribeInvites,
  subscribeMemberDirectory,
  subscribeTasks,
  subscribeUsers,
  swapCategoryOrderInFirestore,
  syncMemberDirectoryForAdmin,
  transferTaskUidInFirestore,
  updateCategoryInFirestore,
  updateInviteInFirestore,
  updateMemberInFirestore,
  updateOpenGoogleLoginSetting,
  updateTaskInFirestore,
  verifyOfficialImportInFirestore,
} from './services/firestoreService';
import {
  OfficialImportPlanItem,
  OfficialImportSummary,
} from './utils/officialImport';
import { exportTasksToCSV } from './utils/taskHelpers';
import { TbhgnLogo } from './components/TbhgnLogo';
import { AuthGate } from './components/AuthGate';
import { OverviewView } from './components/OverviewView';
import { TasksView } from './components/TasksView';
import { MyTasksView } from './components/MyTasksView';
import { DocumentsView } from './components/DocumentsView';
import { MembersView } from './components/MembersView';
import { CategoriesView } from './components/CategoriesView';
import { ImportPreviewView } from './components/ImportPreviewView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { NewTaskModal } from './components/NewTaskModal';

interface ToastMessage {
  id: number;
  type: 'success' | 'error';
  text: string;
}

function formatActionError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith('CONFLICT:')) {
    return raw.slice('CONFLICT:'.length).trim();
  }
  if (raw.startsWith('PREFLIGHT:')) {
    return raw.slice('PREFLIGHT:'.length).trim();
  }
  try {
    const parsed = JSON.parse(raw) as {
      error?: string;
      errorCode?: string;
      operationType?: string;
      path?: string;
    };
    if (parsed.error) {
      const codePrefix = parsed.errorCode ? `[${parsed.errorCode}] ` : '';
      const loc =
        parsed.operationType || parsed.path
          ? ` (${[parsed.operationType, parsed.path].filter(Boolean).join(' @ ')})`
          : '';
      return `${codePrefix}${parsed.error}${loc}`;
    }
  } catch {
    // Plain error string
  }
  return raw;
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [resolution, setResolution] = useState<AuthResolutionResult | null>(
    null
  );
  const [authError, setAuthError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [directoryState, setDirectoryState] = useState<{
    status: MemberDirectoryStatus;
    errorMessage: string | null;
    isPermissionDenied: boolean;
    docCount: number;
  }>({
    status: 'idle',
    errorMessage: null,
    isPermissionDenied: false,
    docCount: 0,
  });
  const [directoryRetryKey, setDirectoryRetryKey] = useState(0);
  const [invites, setInvites] = useState<MemberInvite[]>([]);
  const [authSettings, setAuthSettings] = useState<AuthSettings>({
    allowOpenGoogleLogin: false,
  });

  const [route, setRoute] = useState<AppRoute>('overview');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskParentId, setNewTaskParentId] = useState<
    string | null | undefined
  >(undefined);
  const [tasksFilterPreset, setTasksFilterPreset] = useState<{
    status?: string;
    categoryId?: string;
    reviewOnly?: boolean;
    key: number;
  }>({ key: 0 });
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [route]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-mobile-more-root]')) {
        return;
      }
      setMobileMoreOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMoreOpen]);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    const id = Date.now();
    setToast({ id, type, text });
    window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 5200);
  }, []);

  const verifyMembership = useCallback(async (user: User) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await resolveUserMembership(user);
      setResolution(res);
    } catch (err) {
      setResolution(null);
      setAuthError(formatActionError(err));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      setAuthError(formatActionError(err));
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (!user) {
        setResolution(null);
        setTasks([]);
        setCategories([]);
        setMembers([]);
        setInvites([]);
        setAuthSettings({ allowOpenGoogleLogin: false });
        setSelectedTaskId(null);
        setAuthLoading(false);
        return;
      }
      await verifyMembership(user);
    });

    return () => unsub();
  }, [verifyMembership]);

  const currentUser = useMemo(() => {
    if (resolution?.status === 'active') return resolution.profile;
    return null;
  }, [resolution]);

  // Real-time listener on own /users/{uid} doc to reflect role or lock changes immediately
  useEffect(() => {
    if (!authUser || resolution?.status !== 'active') return;
    const unsubSelf = onSnapshot(
      doc(db, 'users', authUser.uid),
      (snap) => {
        if (!snap.exists()) {
          setResolution({
            status: 'unauthorized',
            email: authUser.email || '',
          });
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        const updatedProfile: ProjectMember = {
          uid: snap.id,
          displayName: String(d.displayName ?? ''),
          email: String(d.email ?? ''),
          role: (d.role as UserRole) ?? 'viewer',
          canApprove: Boolean(d.canApprove),
          isActive: Boolean(d.isActive),
          sheetAlias: String(d.sheetAlias ?? ''),
          createdAt: resolution.profile.createdAt,
        };
        if (!updatedProfile.isActive) {
          setResolution({ status: 'locked', profile: updatedProfile });
        } else {
          setResolution({ status: 'active', profile: updatedProfile });
        }
      },
      (err) => {
        console.warn('Self profile listener warning:', err);
      }
    );
    return () => unsubSelf();
  }, [authUser, resolution?.status]);

  // Real-time Firestore task, category, invite, and settings listeners
  useEffect(() => {
    if (!currentUser || !currentUser.isActive) {
      setTasks([]);
      setCategories([]);
      setInvites([]);
      setAuthSettings({ allowOpenGoogleLogin: false });
      return;
    }

    const unsubTasks = subscribeTasks(setTasks, (err) => {
      showToast('error', formatActionError(err));
    });
    const unsubCategories = subscribeCategories(setCategories, (err) => {
      showToast('error', formatActionError(err));
    });

    let unsubInvites: (() => void) | undefined;
    let unsubAuthSettings: (() => void) | undefined;

    if (currentUser.role === 'admin') {
      unsubInvites = subscribeInvites(setInvites, (err) => {
        showToast('error', formatActionError(err));
      });
      unsubAuthSettings = subscribeAuthSettings(setAuthSettings, (err) => {
        showToast('error', formatActionError(err));
      });
    } else {
      setInvites([]);
      setAuthSettings({ allowOpenGoogleLogin: false });
    }

    return () => {
      unsubTasks();
      unsubCategories();
      if (unsubInvites) unsubInvites();
      if (unsubAuthSettings) unsubAuthSettings();
    };
  }, [currentUser?.uid, currentUser?.role, currentUser?.isActive, showToast]);

  // Dedicated member / directory subscription with explicit loading & error state
  useEffect(() => {
    if (!currentUser || !currentUser.isActive) {
      setMembers([]);
      setDirectoryState({
        status: 'idle',
        errorMessage: null,
        isPermissionDenied: false,
        docCount: 0,
      });
      return;
    }

    let cancelled = false;
    let lastSyncedFingerprint = '';

    setDirectoryState((prev) => ({
      ...prev,
      status: 'loading',
      errorMessage: null,
      isPermissionDenied: false,
    }));

    if (currentUser.role === 'admin' || currentUser.role === 'moderator') {
      const unsubUsers = subscribeUsers(
        (loadedMembers) => {
          if (cancelled) return;
          setMembers(loadedMembers);
          setDirectoryState({
            status: 'ready',
            errorMessage: null,
            isPermissionDenied: false,
            docCount: loadedMembers.length,
          });
          if (currentUser.role === 'admin') {
            const fp = loadedMembers
              .map((m) => `${m.uid}:${m.displayName}:${m.isActive}`)
              .sort()
              .join('|');
            if (fp !== lastSyncedFingerprint) {
              lastSyncedFingerprint = fp;
              void syncMemberDirectoryForAdmin(loadedMembers).catch((err) => {
                if (!cancelled) {
                  showToast(
                    'error',
                    `Chưa tự đồng bộ được danh bạ thành viên: ${formatActionError(err)}`
                  );
                }
              });
            }
          }
        },
        (err) => {
          if (cancelled) return;
          const msg = formatActionError(err);
          setDirectoryState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: msg,
            isPermissionDenied: msg.toLowerCase().includes('permission'),
          }));
          showToast('error', msg);
        }
      );

      return () => {
        cancelled = true;
        unsubUsers();
      };
    }

    // Member / Viewer: read minimal non-PII `/memberDirectory` without ever masking errors
    setMembers((prev) => {
      if (prev.length === 0) return [currentUser];
      const hasSelf = prev.some((m) => m.uid === currentUser.uid);
      return hasSelf
        ? prev.map((m) => (m.uid === currentUser.uid ? currentUser : m))
        : [currentUser, ...prev];
    });

    const unsubDirectory = subscribeMemberDirectory(
      currentUser,
      (loadedMembers, meta) => {
        if (cancelled) return;
        setMembers(loadedMembers);
        setDirectoryState({
          status: 'ready',
          errorMessage: null,
          isPermissionDenied: false,
          docCount: meta.directoryDocCount,
        });
      },
      (err, meta) => {
        if (cancelled) return;
        setMembers((prev) => (prev.length > 0 ? prev : [currentUser]));
        setDirectoryState({
          status: 'error',
          errorMessage: formatActionError(err),
          isPermissionDenied: meta.isPermissionDenied,
          docCount: 0,
        });
      }
    );

    return () => {
      cancelled = true;
      unsubDirectory();
    };
  }, [
    currentUser?.uid,
    currentUser?.role,
    currentUser?.isActive,
    currentUser?.displayName,
    directoryRetryKey,
    showToast,
  ]);

  const handleSignInPopup = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/cancelled-popup-request'
      ) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setAuthError(
        err instanceof Error ? err.message : 'Không thể đăng nhập bằng Google.'
      );
    }
  };

  const handleSignInRedirect = async () => {
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Không thể chuyển hướng đăng nhập Google.'
      );
    }
  };

  const handleBootstrapAdmin = async (sheetAlias: string) => {
    if (!authUser) return;
    setAuthError(null);
    try {
      const profile = await bootstrapOwnerAdmin(authUser, sheetAlias);
      setResolution({ status: 'active', profile });
      showToast('success', 'Đã khởi tạo Quản trị viên đầu tiên trên Firestore.');
    } catch (err) {
      setAuthError(formatActionError(err));
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [tasks, selectedTaskId]);

  const handleSaveTask = async (
    taskId: string,
    patch: Partial<TaskItem>,
    expectedVersion: number
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!currentUser) {
      return { ok: false, error: 'Phiên đăng nhập không hợp lệ.' };
    }
    try {
      const { newVersion } = await updateTaskInFirestore(
        taskId,
        patch,
        expectedVersion,
        currentUser
      );
      showToast('success', `Đã lưu lên Firestore (v${newVersion})`);
      return { ok: true };
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      return { ok: false, error: msg };
    }
  };

  const handleQuickUpdate = async (
    taskId: string,
    patch: Partial<Pick<TaskItem, 'status' | 'nextStep'>>,
    expectedVersion: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await handleSaveTask(taskId, patch, expectedVersion);
  };

  const handleAddComment = async (
    taskId: string,
    content: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!currentUser) {
      return { ok: false, error: 'Phiên đăng nhập không hợp lệ.' };
    }
    try {
      await addCommentInFirestore(taskId, content, currentUser);
      showToast('success', 'Đã đăng góp ý lên Firestore');
      return { ok: true };
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      return { ok: false, error: msg };
    }
  };

  const handleCreateTask = async (input: {
    displayCode: string;
    title: string;
    parentId: string | null;
    categoryId: string | null;
    category: TaskCategory | null;
    assignees: string[];
    assigneeUids: string[];
    status: TaskStatus | null;
    nextStep: string | null;
    dueDate: string | null;
  }) => {
    if (!currentUser) return;
    const maxSort = tasks.reduce((max, t) => Math.max(max, t.sortOrder), -1);

    try {
      await createTaskInFirestore(
        {
          ...input,
          sortOrder: maxSort + 1,
        },
        currentUser
      );
      showToast('success', `Đã tạo công việc ${input.displayCode}`);
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      throw new Error(msg);
    }
  };

  const handleArchiveTask = async (taskId: string) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await archiveOrRestoreTaskInFirestore(taskId, true, currentUser);
      setSelectedTaskId(null);
      showToast('success', 'Đã lưu trữ công việc');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleRestoreTask = async (taskId: string) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await archiveOrRestoreTaskInFirestore(taskId, false, currentUser);
      showToast('success', 'Đã khôi phục công việc');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleToggleOpenGoogleLogin = async (allowOpen: boolean) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      await updateOpenGoogleLoginSetting(allowOpen, currentUser);
      showToast(
        'success',
        allowOpen
          ? 'Đã bật cho phép người mới đăng nhập Google ở quyền Viewer'
          : 'Đã tắt đăng nhập mở cho tài khoản chưa được mời'
      );
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleSeedDefaultCategories = async () => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      const count = await seedDefaultCategories(currentUser);
      showToast(
        'success',
        count > 0
          ? `Đã khởi tạo ${count} hạng mục mặc định TBHGN`
          : '3 hạng mục mặc định đã tồn tại.'
      );
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleCreateCategory = async (input: {
    name: string;
    color: string;
    sortOrder: number;
  }) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await createCategoryInFirestore(input, currentUser);
      showToast('success', `Đã thêm hạng mục "${input.name}"`);
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleUpdateCategory = async (
    categoryId: string,
    patch: Partial<Pick<CategoryItem, 'name' | 'color' | 'sortOrder' | 'isActive'>>
  ) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await updateCategoryInFirestore(categoryId, patch, currentUser);
      showToast('success', 'Đã cập nhật hạng mục');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleSwapCategoryOrder = async (
    catA: CategoryItem,
    catB: CategoryItem
  ) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await swapCategoryOrderInFirestore(catA, catB, currentUser);
      showToast('success', 'Đã cập nhật thứ tự hạng mục');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleDeleteUnusedCategory = async (categoryId: string) => {
    if (
      !currentUser ||
      (currentUser.role !== 'admin' && currentUser.role !== 'moderator')
    )
      return;
    try {
      await deleteUnusedCategoryInFirestore(categoryId, tasks);
      showToast('success', 'Đã xóa hạng mục chưa sử dụng');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleAddInvite = async (input: {
    displayName: string;
    email: string;
    role: UserRole;
    canApprove: boolean;
    sheetAlias: string;
  }) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      await createOrUpdateInvite(input, currentUser);
      showToast('success', `Đã cấp quyền cho ${input.email}`);
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleUpdateMember = async (
    uid: string,
    email: string,
    patch: Partial<
      Pick<ProjectMember, 'role' | 'canApprove' | 'isActive' | 'sheetAlias' | 'displayName'>
    >
  ) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      const syncResult = await updateMemberInFirestore(uid, email, patch);
      if (!syncResult.directorySynced) {
        showToast(
          'error',
          `Đã cập nhật thành viên nhưng chưa đồng bộ danh bạ chung (${syncResult.directoryError ?? 'lỗi không xác định'}). Hãy bấm "Đồng bộ danh bạ".`
        );
        return;
      }
      showToast('success', 'Đã cập nhật thông tin thành viên');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleSyncMemberDirectory = async (): Promise<MemberDirectorySyncResult> => {
    if (!currentUser || currentUser.role !== 'admin' || !currentUser.isActive) {
      throw new Error('Chỉ Quản trị viên đang hoạt động mới được đồng bộ danh bạ.');
    }
    try {
      const result = await syncMemberDirectoryForAdmin(members);
      if (result.updatedCount > 0) {
        showToast(
          'success',
          `Đã đồng bộ danh bạ: cập nhật ${result.updatedCount} hồ sơ, ${result.unchangedCount} hồ sơ đã khớp.`
        );
      } else {
        showToast(
          'success',
          `Danh bạ thành viên đã đầy đủ (${result.unchangedCount} hồ sơ đã khớp).`
        );
      }
      return result;
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', `Chưa đồng bộ được danh bạ: ${msg}`);
      throw new Error(msg);
    }
  };

  const handleUpdateInvite = async (
    email: string,
    patch: Partial<
      Pick<MemberInvite, 'displayName' | 'role' | 'canApprove' | 'isActive'>
    >
  ) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      await updateInviteInFirestore(email, patch);
      showToast('success', 'Đã cập nhật lời mời');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleDeleteInvite = async (email: string) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      await removeInviteInFirestore(email);
      showToast('success', 'Đã thu hồi lời mời');
    } catch (err) {
      showToast('error', formatActionError(err));
    }
  };

  const handleAssignTasksToMember = async (
    member: ProjectMember,
    taskIds: string[]
  ): Promise<{ updatedCount: number; skippedCount: number }> => {
    if (!currentUser || currentUser.role !== 'admin' || !currentUser.isActive) {
      throw new Error('Chỉ Quản trị viên đang hoạt động mới được giao công việc.');
    }
    try {
      const result = await assignMemberToTasksInFirestore(
        member,
        taskIds,
        currentUser
      );
      if (result.updatedCount > 0) {
        showToast(
          'success',
          `Đã giao ${result.updatedCount} công việc cho ${member.displayName}`
        );
      } else {
        showToast(
          'success',
          'Không có công việc mới cần gán thêm (các việc chọn đã được gán trước đó).'
        );
      }
      return result;
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      throw new Error(msg);
    }
  };

  const handleTransferTaskUid = async (
    oldMember: ProjectMember,
    newMember: ProjectMember,
    taskIds: string[]
  ): Promise<{ updatedCount: number; skippedCount: number }> => {
    if (!currentUser || currentUser.role !== 'admin' || !currentUser.isActive) {
      throw new Error('Chỉ Quản trị viên đang hoạt động mới được chuyển UID công việc.');
    }
    try {
      const result = await transferTaskUidInFirestore(
        oldMember,
        newMember,
        taskIds,
        currentUser
      );
      if (result.updatedCount > 0) {
        showToast(
          'success',
          `Đã chuyển UID ${result.updatedCount} công việc từ ${oldMember.email} sang ${newMember.email}`
        );
      } else {
        showToast('success', 'Không có công việc nào cần chuyển UID thêm.');
      }
      return result;
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      throw new Error(msg);
    }
  };

  const handleExportCSV = () => {
    const csv = exportTasksToCSV(tasks, categories, members);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TBHGN_firestore_sao_luu_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Đã xuất file sao lưu CSV');
  };

  const handleExportJSON = () => {
    if (!currentUser || currentUser.role !== 'admin' || !currentUser.isActive) {
      showToast('error', 'Chỉ Quản trị viên mới được xuất toàn bộ dữ liệu JSON.');
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      categories,
      tasks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TBHGN_firestore_sao_luu_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Đã xuất file sao lưu JSON');
  };

  if (authLoading || !authUser || !currentUser) {
    return (
      <AuthGate
        loading={authLoading}
        authEmail={authUser?.email ?? null}
        resolution={resolution}
        authError={authError}
        onSignInPopup={handleSignInPopup}
        onSignInRedirect={handleSignInRedirect}
        onBootstrapAdmin={handleBootstrapAdmin}
        onSignOut={handleSignOut}
        onRetryCheck={() =>
          authUser ? verifyMembership(authUser) : Promise.resolve()
        }
      />
    );
  }

  const isAdmin = currentUser.role === 'admin' && currentUser.isActive;
  const canManage =
    (currentUser.role === 'admin' || currentUser.role === 'moderator') &&
    currentUser.isActive;

  const navItems: Array<{
    id: AppRoute;
    label: string;
    shortLabel: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'overview',
      label: 'Tổng quan',
      shortLabel: 'Tổng quan',
      icon: LayoutDashboard,
    },
    {
      id: 'tasks',
      label: 'Công việc',
      shortLabel: 'Công việc',
      icon: ClipboardList,
    },
    {
      id: 'my-tasks',
      label: 'Việc của tôi',
      shortLabel: 'Của tôi',
      icon: UserCheck,
    },
    {
      id: 'documents',
      label: 'Tài liệu dự án',
      shortLabel: 'Tài liệu',
      icon: Library,
    },
    ...(canManage
      ? [
          {
            id: 'categories' as AppRoute,
            label: 'Quản lý hạng mục',
            shortLabel: 'Hạng mục',
            icon: FolderKanban,
          },
        ]
      : []),
    {
      id: 'members',
      label: 'Thành viên',
      shortLabel: 'Thành viên',
      icon: Users,
    },
  ];

  const mobilePrimaryNavItems = navItems.filter(
    (item) =>
      item.id === 'overview' ||
      item.id === 'tasks' ||
      item.id === 'my-tasks' ||
      item.id === 'documents'
  );

  const mobileMoreItems: Array<{
    id: AppRoute;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'members',
      label: 'Thành viên',
      icon: Users,
    },
    ...(canManage
      ? [
          {
            id: 'categories' as AppRoute,
            label: 'Quản lý hạng mục',
            icon: FolderKanban,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            id: 'admin-settings' as AppRoute,
            label: 'Cài đặt quản trị',
            icon: Settings,
          },
        ]
      : []),
  ];

  const isMobileMoreActive = mobileMoreItems.some((item) => item.id === route);

  const roleDisplay =
    currentUser.role === 'admin'
      ? 'Admin'
      : currentUser.role === 'moderator'
      ? 'Moderator'
      : currentUser.role === 'member'
      ? 'Member'
      : 'Viewer';

  const handleExecuteOfficialImport = async (
    items: OfficialImportPlanItem[],
    summary: OfficialImportSummary
  ) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Chỉ Quản trị viên mới được nhập dữ liệu chính thức.');
    }
    try {
      const result = await importOfficialTasksToFirestore(
        items,
        summary,
        currentUser
      );
      showToast(
        'success',
        result.importedCount > 0
          ? `Đã nhập ${result.importedCount} công việc chính thức vào Firestore (bỏ qua ${result.skippedIds.length} bản ghi đã tồn tại).`
          : `Không ghi thêm bản ghi mới (đã bỏ qua ${result.skippedIds.length} bản ghi tồn tại sẵn).`
      );
      return result;
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      throw new Error(msg);
    }
  };

  const handleVerifyOfficialFirestore = async (expectedIds: string[]) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Chỉ Quản trị viên mới được đối chiếu trực tiếp Firestore.');
    }
    try {
      const verification = await verifyOfficialImportInFirestore(expectedIds);
      showToast(
        verification.allChecksPassed ? 'success' : 'error',
        verification.allChecksPassed
          ? `Đối chiếu Firestore thật đạt 20/20 công việc và ${verification.resultUrlCount}/13 URL.`
          : `Đối chiếu Firestore thật có sai lệch: ${verification.mismatches.join(' ')}`
      );
      return verification;
    } catch (err) {
      const msg = formatActionError(err);
      showToast('error', msg);
      throw new Error(msg);
    }
  };

  const importPanel = isAdmin ? (
    <ImportPreviewView
      existingTasks={tasks}
      existingCategories={categories}
      currentUser={currentUser}
      onNavigateToCategories={() => setRoute('categories')}
      onExecuteImport={handleExecuteOfficialImport}
      onVerifyLiveFirestore={handleVerifyOfficialFirestore}
    />
  ) : null;

  const activeRouteLabel =
    route === 'admin-settings'
      ? 'Cài đặt quản trị'
      : route === 'categories'
      ? 'Quản lý hạng mục'
      : navItems.find((n) => n.id === route)?.label ?? 'Tổng quan';

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-nga-thien text-huyen-lam overflow-x-hidden">
      {/* Desktop Sidebar (240px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 bg-huyen-lam text-nga-thien border-r border-huyen-lam-deep">
        <div className="h-14 px-4 flex items-center border-b border-white/10 shrink-0">
          <TbhgnLogo size={32} variant="dark" showWordmark />
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setRoute(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/12 text-kim-quang ring-1 ring-minh-kim/35'
                    : 'text-slate-200/90 hover:bg-lam-tri-tue/75 hover:text-white'
                }`}
              >
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    active ? 'text-kim-quang' : 'text-slate-300'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}

          {isAdmin && (
            <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
              <button
                type="button"
                onClick={() => setRoute('admin-settings')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  route === 'admin-settings'
                    ? 'bg-white/12 text-kim-quang ring-1 ring-minh-kim/35'
                    : 'text-slate-200/90 hover:bg-lam-tri-tue/75 hover:text-white'
                }`}
              >
                <Settings
                  className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    route === 'admin-settings' ? 'text-kim-quang' : 'text-slate-300'
                  }`}
                />
                <span>Cài đặt quản trị</span>
              </button>
            </div>
          )}
        </nav>

        {/* Signed-in Google Profile, Export & Logout */}
        <div className="p-3 border-t border-white/10 space-y-2.5 text-xs">
          <div className="px-2.5 py-2 rounded-lg bg-huyen-lam-deep border border-lam-tri-tue/60 space-y-0.5">
            <div className="font-semibold text-nga-thien truncate">
              {currentUser.displayName}
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              {currentUser.email}
            </div>
            <div className="text-[11px] text-kim-quang font-medium">
              {roleDisplay}
              {currentUser.canApprove &&
              currentUser.role !== 'admin' &&
              currentUser.role !== 'moderator'
                ? ' · Được duyệt'
                : ''}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-white/10 hover:bg-lam-tri-tue text-nga-thien transition-colors"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>CSV</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={handleExportJSON}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-white/10 hover:bg-lam-tri-tue text-nga-thien transition-colors"
              >
                <FileJson className="w-3.5 h-3.5 shrink-0" />
                <span>JSON</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              title="Đăng xuất"
              aria-label="Đăng xuất"
              className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-chu-sa text-nga-thien transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col lg:pl-60 min-w-0">
        {/* Compact Top Bar (52px) — Huyền Lam & Minh Kim */}
        <header className="sticky top-0 z-30 h-[52px] bg-huyen-lam text-[#E6EAF2] border-b border-minh-kim/35 px-3 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 lg:hidden min-w-0">
            <TbhgnLogo size={28} variant="dark" showWordmark />
          </div>

          <div className="hidden lg:flex items-center gap-2.5 text-xs whitespace-nowrap min-w-0">
            <span className="text-sm font-bold text-kim-quang tracking-[0.02em]">
              TBHGN
            </span>
            <span aria-hidden="true" className="text-minh-kim/70 font-medium">
              /
            </span>
            <span className="text-[13px] font-medium text-[#E6EAF2] truncate">
              {activeRouteLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <span
              className="text-xs font-medium text-[#E6EAF2] max-w-[84px] sm:max-w-[140px] lg:max-w-[180px] truncate"
              title={currentUser.displayName}
            >
              {currentUser.displayName}
            </span>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setRoute('admin-settings')}
                aria-label="Cài đặt quản trị"
                title="Cài đặt quản trị"
                className={`lg:hidden inline-flex items-center justify-center p-2 text-xs font-medium border rounded-lg min-h-[40px] min-w-[40px] transition-colors focus-visible:outline-2 focus-visible:outline-kim-quang focus-visible:outline-offset-2 ${
                  route === 'admin-settings'
                    ? 'bg-lam-tri-tue text-kim-quang border-minh-kim/65'
                    : 'bg-transparent text-[#E6EAF2] border-white/15 hover:bg-lam-tri-tue hover:text-kim-quang hover:border-minh-kim/40'
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              aria-label="Xuất dữ liệu sao lưu CSV"
              title="Xuất CSV"
              className="inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-kim-quang bg-white/[0.04] border border-minh-kim/45 hover:bg-lam-tri-tue hover:border-kim-quang/70 rounded-lg whitespace-nowrap shrink-0 min-h-[40px] min-w-[40px] transition-colors focus-visible:outline-2 focus-visible:outline-kim-quang focus-visible:outline-offset-2"
            >
              <Download className="w-3.5 h-3.5 shrink-0 text-kim-quang" />
              <span className="hidden sm:inline">Xuất CSV</span>
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Đăng xuất"
              title="Đăng xuất"
              className="lg:hidden inline-flex items-center justify-center p-2 text-xs font-medium text-[#E6EAF2]/85 bg-transparent border border-white/15 hover:bg-lam-tri-tue hover:text-white hover:border-white/30 rounded-lg min-h-[40px] min-w-[40px] transition-colors focus-visible:outline-2 focus-visible:outline-kim-quang focus-visible:outline-offset-2"
            >
              <LogOut className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </header>

        {/* Main Viewport Content */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 lg:pb-8">
          {(() => {
            const directoryUnavailable = directoryState.status === 'error';
            const isNonManager =
              currentUser.role !== 'admin' && currentUser.role !== 'moderator';
            const knownMemberUids = new Set(members.map((m) => m.uid));
            const hasUnresolvedTaskAssignees =
              isNonManager &&
              directoryState.status === 'ready' &&
              directoryState.docCount <= 1 &&
              tasks.some(
                (t) =>
                  !t.archivedAt &&
                  !t.isTestRecord &&
                  t.assigneeUids.some((uid) => !knownMemberUids.has(uid))
              );

            if (!directoryUnavailable && !hasUnresolvedTaskAssignees) {
              return null;
            }

            return (
              <div
                role="status"
                className="mb-4 rounded-xl border border-minh-kim-border bg-minh-kim-soft/75 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-minh-kim-ink shrink-0 mt-0.5" />
                  <div className="min-w-0 text-xs text-huyen-lam leading-relaxed">
                    <span className="font-semibold">
                      {directoryUnavailable
                        ? 'Chưa tải được danh bạ thành viên'
                        : 'Danh bạ thành viên chưa đồng bộ đầy đủ'}
                    </span>
                    <span className="text-huyen-lam/80">
                      {' — '}
                      {directoryUnavailable
                        ? directoryState.isPermissionDenied
                          ? 'Chưa đọc được danh bạ tên chính thức của dự án. Bạn vẫn xem công việc bình thường và có thể thử tải lại.'
                          : 'Kết nối danh bạ tạm gián đoạn. Bạn vẫn xem công việc bình thường và có thể thử tải lại.'
                        : 'Một số tên người phụ trách chưa có trong danh bạ chung. Vui lòng báo Quản trị viên đồng bộ danh bạ rồi tải lại.'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDirectoryRetryKey((k) => k + 1)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-minh-kim-border bg-white text-huyen-lam hover:bg-[#FAF8F3] text-xs font-medium whitespace-nowrap shrink-0 min-h-[36px] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>Thử tải lại</span>
                </button>
              </div>
            );
          })()}

          {route === 'overview' && (
            <OverviewView
              tasks={tasks}
              categories={categories}
              members={members}
              currentUser={currentUser}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onNavigateToTasks={(preset) => {
                setTasksFilterPreset({
                  status: preset?.status,
                  reviewOnly: preset?.reviewOnly,
                  key: Date.now(),
                });
                setRoute('tasks');
              }}
            />
          )}

          {route === 'tasks' && (
            <TasksView
              key={tasksFilterPreset.key}
              tasks={tasks}
              categories={categories}
              members={members}
              currentUser={currentUser}
              directoryUnavailable={directoryState.status === 'error'}
              initialStatusFilter={tasksFilterPreset.status ?? 'all'}
              initialCategoryFilter={tasksFilterPreset.categoryId ?? 'all'}
              initialReviewOnly={tasksFilterPreset.reviewOnly ?? false}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onOpenNewTask={(parentId) => setNewTaskParentId(parentId ?? null)}
              onNavigateToDocuments={() => setRoute('documents')}
            />
          )}

          {route === 'my-tasks' && (
            <MyTasksView
              tasks={tasks}
              categories={categories}
              members={members}
              currentUser={currentUser}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onNavigateToTasks={() => setRoute('tasks')}
              onQuickUpdate={handleQuickUpdate}
            />
          )}

          {route === 'documents' && (
            <DocumentsView
              tasks={tasks}
              categories={categories}
              members={members}
              currentUser={currentUser}
              directoryUnavailable={directoryState.status === 'error'}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onNavigateToTasks={() => setRoute('tasks')}
              onSaveTask={handleSaveTask}
            />
          )}

          {route === 'categories' && (
            <CategoriesView
              categories={categories}
              tasks={tasks}
              currentUser={currentUser}
              onSeedDefaults={handleSeedDefaultCategories}
              onCreateCategory={handleCreateCategory}
              onUpdateCategory={handleUpdateCategory}
              onSwapOrder={handleSwapCategoryOrder}
              onDeleteUnusedCategory={handleDeleteUnusedCategory}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onFilterTasksByCategory={(categoryId) => {
                setTasksFilterPreset({
                  categoryId,
                  key: Date.now(),
                });
                setRoute('tasks');
              }}
            />
          )}

          {route === 'members' && (
            <MembersView
              members={members}
              invites={invites}
              tasks={tasks}
              currentUser={currentUser}
              onSyncMemberDirectory={
                isAdmin ? handleSyncMemberDirectory : undefined
              }
              onAssignTasksToMember={handleAssignTasksToMember}
              onTransferTaskUid={handleTransferTaskUid}
              onAddInvite={handleAddInvite}
              onUpdateMember={handleUpdateMember}
              onUpdateInvite={handleUpdateInvite}
              onDeleteInvite={handleDeleteInvite}
            />
          )}

          {route === 'admin-settings' && (
            <AdminSettingsView
              currentUser={currentUser}
              authSettings={authSettings}
              members={members}
              categoriesCount={categories.length}
              tasksCount={tasks.filter((t) => !t.archivedAt).length}
              onToggleOpenGoogleLogin={handleToggleOpenGoogleLogin}
              onExportCSV={handleExportCSV}
              onExportJSON={handleExportJSON}
              onNavigateToCategories={() => setRoute('categories')}
              onNavigateToMembers={() => setRoute('members')}
              importPanel={importPanel}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (5 clean slots + Thêm overflow menu) */}
      <div className="lg:hidden" data-mobile-more-root>
        {mobileMoreOpen && (
          <div
            role="menu"
            aria-label="Menu điều hướng mở rộng"
            className="fixed bottom-[calc(env(safe-area-inset-bottom)+64px)] right-2.5 z-40 min-w-[206px] bg-trang-nga border border-[#DFD8CA] rounded-2xl shadow-[0_14px_34px_-10px_rgba(20,36,63,0.22)] p-1.5 space-y-0.5"
          >
            {mobileMoreItems.map((item) => {
              const Icon = item.icon;
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRoute(item.id);
                    setMobileMoreOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors min-h-[44px] ${
                    active
                      ? 'bg-[#F5EFE0] text-huyen-lam font-semibold'
                      : 'text-huyen-lam hover:bg-[#FAF8F3]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-minh-kim-ink' : 'text-[#6E7889]'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <nav
          aria-label="Điều hướng di động"
          className="fixed bottom-0 left-0 right-0 z-30 min-h-[56px] pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-sm border-t border-nga-xam grid grid-cols-5"
        >
          {mobilePrimaryNavItems.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setRoute(item.id)}
                className={`relative min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'text-huyen-lam font-semibold'
                    : 'text-ink-muted hover:text-huyen-lam'
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-minh-kim"
                  />
                )}
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 ${
                    active ? 'text-huyen-lam' : 'text-ink-muted'
                  }`}
                />
                <span className="truncate max-w-full px-1">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileMoreOpen((v) => !v)}
            aria-expanded={mobileMoreOpen}
            aria-haspopup="menu"
            aria-label="Mở thêm trang quản lý"
            className={`relative min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              mobileMoreOpen || isMobileMoreActive
                ? 'text-huyen-lam font-semibold'
                : 'text-ink-muted hover:text-huyen-lam'
            }`}
          >
            {isMobileMoreActive && (
              <span
                aria-hidden="true"
                className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-minh-kim"
              />
            )}
            <MoreHorizontal
              className={`w-[18px] h-[18px] shrink-0 ${
                mobileMoreOpen || isMobileMoreActive
                  ? 'text-huyen-lam'
                  : 'text-ink-muted'
              }`}
            />
            <span className="truncate max-w-full px-1">Thêm</span>
          </button>
        </nav>
      </div>

      {/* Task Detail Slide-Over / Sheet */}
      <TaskDetailDrawer
        task={selectedTask}
        allTasks={tasks}
        categories={categories}
        currentUser={currentUser}
        members={members}
        directoryUnavailable={directoryState.status === 'error'}
        onClose={() => setSelectedTaskId(null)}
        onSelectTask={(id) => setSelectedTaskId(id)}
        onSaveTask={handleSaveTask}
        onAddComment={handleAddComment}
        onOpenAddSubtask={(parentId) => setNewTaskParentId(parentId)}
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreTask}
      />

      {/* New Task Modal */}
      <NewTaskModal
        isOpen={newTaskParentId !== undefined}
        defaultParentId={newTaskParentId ?? null}
        tasks={tasks}
        members={members}
        categories={categories}
        currentUser={currentUser}
        onClose={() => setNewTaskParentId(undefined)}
        onCreateTask={handleCreateTask}
      />

      {/* Toast Notification */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-[4.5rem] lg:bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-50 sm:max-w-md px-3.5 py-2.5 rounded-xl border shadow-lg flex items-center gap-2.5 text-xs font-medium ${
            toast.type === 'success'
              ? 'bg-huyen-lam text-nga-thien border-lam-tri-tue'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-700" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-kim-quang" />
          )}
          <span className="flex-1 break-words">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Đóng thông báo"
            className="min-w-[32px] min-h-[32px] flex items-center justify-center opacity-75 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
