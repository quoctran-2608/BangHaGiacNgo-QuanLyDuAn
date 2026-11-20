import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ActivityLog,
  AuthSettings,
  CategoryItem,
  MemberDirectoryEntry,
  MemberDirectorySyncResult,
  MemberInvite,
  ProjectMember,
  TaskCategory,
  TaskComment,
  TaskItem,
  TaskStatus,
  UserRole,
} from '../types/project';
import {
  buildOfficialTaskFirestoreWritePayloads,
  computeOfficialFirestoreVerification,
  OfficialImportExecutionResult,
  OfficialImportPlanItem,
  OfficialImportSummary,
  OfficialImportVerification,
  validateOfficialImportPreflight,
} from '../utils/officialImport';

export const DEFAULT_TBHGN_CATEGORIES: Array<{
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}> = [
  {
    id: 'cat_outline',
    name: 'Đề cương',
    color: '#13294B',
    sortOrder: 1,
  },
  {
    id: 'cat_foundation',
    name: 'Nền tảng & quy chuẩn',
    color: '#1E5631',
    sortOrder: 2,
  },
  {
    id: 'cat_research',
    name: 'Truy nguồn & nghiên cứu',
    color: '#8A5A00',
    sortOrder: 3,
  },
];

function toIsoString(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function mapTaskDoc(id: string, data: Record<string, unknown>): TaskItem {
  return {
    id,
    displayCode: String(data.displayCode ?? ''),
    parentId: typeof data.parentId === 'string' ? data.parentId : null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    title: String(data.title ?? ''),
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
    category: (data.category as TaskCategory | null) ?? null,
    assignees: Array.isArray(data.assignees)
      ? (data.assignees as string[])
      : [],
    assigneeUids: Array.isArray(data.assigneeUids)
      ? (data.assigneeUids as string[])
      : [],
    approverUids: Array.isArray(data.approverUids)
      ? (data.approverUids as string[])
      : undefined,
    status: (data.status as TaskStatus | null) ?? null,
    nextStep: typeof data.nextStep === 'string' ? data.nextStep : null,
    dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    referenceLinks: Array.isArray(data.referenceLinks)
      ? (data.referenceLinks as TaskItem['referenceLinks'])
      : [],
    resultLinks: Array.isArray(data.resultLinks)
      ? (data.resultLinks as TaskItem['resultLinks'])
      : [],
    reviewFlags: Array.isArray(data.reviewFlags)
      ? (data.reviewFlags as TaskItem['reviewFlags'])
      : [],
    version: typeof data.version === 'number' ? data.version : 1,
    updatedAt: toIsoString(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    updatedByUid:
      typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
    archivedAt: toIsoString(data.archivedAt),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : null,
    isTestRecord: Boolean(data.isTestRecord),
  };
}

function mapCategoryDoc(
  id: string,
  data: Record<string, unknown>
): CategoryItem {
  return {
    id,
    name: String(data.name ?? ''),
    color: typeof data.color === 'string' ? data.color : '#13294B',
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    isActive: data.isActive !== false,
    createdAt: toIsoString(data.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(data.updatedAt) ?? new Date().toISOString(),
    createdBy: String(data.createdBy ?? ''),
    updatedBy: String(data.updatedBy ?? ''),
  };
}

function mapUserDoc(uid: string, data: Record<string, unknown>): ProjectMember {
  return {
    uid,
    displayName: String(data.displayName ?? ''),
    email: String(data.email ?? ''),
    role: (data.role as UserRole) ?? 'viewer',
    canApprove: Boolean(data.canApprove),
    isActive: Boolean(data.isActive),
    sheetAlias: String(data.sheetAlias ?? ''),
    createdAt: toIsoString(data.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(data.updatedAt) ?? undefined,
  };
}

function mapInviteDoc(
  emailId: string,
  data: Record<string, unknown>
): MemberInvite {
  return {
    email: String(data.email ?? emailId),
    displayName: String(data.displayName ?? ''),
    sheetAlias: String(data.sheetAlias ?? ''),
    role: (data.role as UserRole) ?? 'viewer',
    canApprove: Boolean(data.canApprove),
    isActive: Boolean(data.isActive),
    createdBy: String(data.createdBy ?? ''),
    createdAt: toIsoString(data.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(data.updatedAt) ?? new Date().toISOString(),
  };
}

function mapMemberDirectoryDoc(
  uid: string,
  data: Record<string, unknown>
): MemberDirectoryEntry {
  return {
    uid,
    displayName: String(data.displayName ?? ''),
    isActive: data.isActive !== false,
    updatedAt: toIsoString(data.updatedAt) ?? undefined,
  };
}

async function syncOwnMemberDirectoryBestEffort(
  profile: Pick<ProjectMember, 'uid' | 'displayName' | 'isActive'>
): Promise<void> {
  if (
    !profile.uid ||
    !profile.isActive ||
    !profile.displayName.trim() ||
    profile.displayName.length > 120
  ) {
    return;
  }
  try {
    const dirRef = doc(db, 'memberDirectory', profile.uid);
    const snap = await getDoc(dirRef);
    if (snap.exists()) {
      const existing = mapMemberDirectoryDoc(
        snap.id,
        snap.data() as Record<string, unknown>
      );
      if (
        existing.displayName === profile.displayName &&
        existing.isActive === profile.isActive
      ) {
        return;
      }
    }
    await setDoc(dirRef, {
      uid: profile.uid,
      displayName: profile.displayName,
      isActive: profile.isActive,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Best-effort self-sync; never block login if rules deployment is pending
  }
}

export type AuthResolutionResult =
  | { status: 'active'; profile: ProjectMember }
  | { status: 'locked'; profile: ProjectMember }
  | { status: 'bootstrap_eligible'; email: string; displayName: string }
  | { status: 'unauthorized'; email: string };

/**
 * Checks Firestore membership for a signed-in Google user.
 * Never auto-promotes arbitrary Google logins.
 */
export async function resolveUserMembership(
  authUser: User
): Promise<AuthResolutionResult> {
  const emailLower = (authUser.email || '').trim().toLowerCase();
  const userPath = `users/${authUser.uid}`;

  try {
    const userSnap = await getDoc(doc(db, 'users', authUser.uid));
    if (userSnap.exists()) {
      const profile = mapUserDoc(
        userSnap.id,
        userSnap.data() as Record<string, unknown>
      );
      if (profile.isActive) {
        void syncOwnMemberDirectoryBestEffort(profile);
      }
      return profile.isActive
        ? { status: 'active', profile }
        : { status: 'locked', profile };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  // Check if Admin pre-invited this Google email in /invites/{emailLower}
  if (emailLower) {
    const invitePath = `invites/${emailLower}`;
    try {
      const inviteSnap = await getDoc(doc(db, 'invites', emailLower));
      if (inviteSnap.exists()) {
        const inv = mapInviteDoc(
          inviteSnap.id,
          inviteSnap.data() as Record<string, unknown>
        );
        if (!inv.isActive) {
          return {
            status: 'locked',
            profile: {
              uid: authUser.uid,
              displayName: inv.displayName,
              email: emailLower,
              role: inv.role,
              canApprove: inv.canApprove,
              isActive: false,
              sheetAlias: inv.sheetAlias,
              createdAt: inv.createdAt,
            },
          };
        }

        const newProfilePayload = {
          uid: authUser.uid,
          email: emailLower,
          displayName: inv.displayName || authUser.displayName || emailLower,
          sheetAlias: inv.sheetAlias,
          role: inv.role,
          canApprove: inv.canApprove,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'users', authUser.uid), newProfilePayload);
        const createdSnap = await getDoc(doc(db, 'users', authUser.uid));
        const profile = mapUserDoc(
          createdSnap.id,
          createdSnap.data() as Record<string, unknown>
        );
        await syncOwnMemberDirectoryBestEffort(profile);
        return { status: 'active', profile };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : '';
      if (!msg.includes('permission') && !msg.includes('missing')) {
        handleFirestoreError(error, OperationType.GET, invitePath);
      }
    }
  }

  // Check with trusted server endpoint if this verified account is the designated bootstrap owner
  try {
    const idToken = await authUser.getIdToken();
    const resp = await fetch('/api/auth/verify-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (resp.ok) {
      const body = (await resp.json()) as {
        verified?: boolean;
        isBootstrapOwner?: boolean;
      };
      if (body.verified && body.isBootstrapOwner) {
        return {
          status: 'bootstrap_eligible',
          email: emailLower,
          displayName: authUser.displayName || 'Quản trị viên TBHGN',
        };
      }
    }
  } catch {
    // Fallback cleanly to unauthorized if verification endpoint unavailable
  }

  // Check if Open Google Login is enabled by Admin (/settings/auth)
  if (emailLower && authUser.emailVerified) {
    const settingsPath = 'settings/auth';
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'auth'));
      const allowOpen =
        settingsSnap.exists() &&
        Boolean(
          (settingsSnap.data() as Record<string, unknown>)?.allowOpenGoogleLogin
        );

      if (allowOpen) {
        const viewerPayload = {
          uid: authUser.uid,
          email: emailLower,
          displayName: authUser.displayName || emailLower,
          sheetAlias: '',
          role: 'viewer' as const,
          canApprove: false,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'users', authUser.uid), viewerPayload);
        const createdSnap = await getDoc(doc(db, 'users', authUser.uid));
        const profile = mapUserDoc(
          createdSnap.id,
          createdSnap.data() as Record<string, unknown>
        );
        await syncOwnMemberDirectoryBestEffort(profile);
        return { status: 'active', profile };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : '';
      if (!msg.includes('permission') && !msg.includes('missing')) {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      }
    }
  }

  return { status: 'unauthorized', email: emailLower };
}

/**
 * Trusted first-admin bootstrap verified by backend ID token check + Firestore rules.
 */
export async function bootstrapOwnerAdmin(
  authUser: User,
  sheetAlias: string
): Promise<ProjectMember> {
  const idToken = await authUser.getIdToken(true);
  const resp = await fetch('/api/auth/verify-bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });
  const body = (await resp.json()) as {
    allowed?: boolean;
    error?: string;
    email?: string;
  };
  if (!resp.ok || !body.allowed) {
    throw new Error(
      body.error || 'Không được phép khởi tạo Quản trị viên đầu tiên.'
    );
  }

  const emailLower = (authUser.email || '').trim().toLowerCase();
  const initialDisplayName =
    emailLower === 'ngaothuyet2023@gmail.com'
      ? 'Sư Phụ'
      : authUser.displayName || emailLower;
  const path = `users/${authUser.uid}`;
  try {
    await setDoc(doc(db, 'users', authUser.uid), {
      uid: authUser.uid,
      email: emailLower,
      displayName: initialDisplayName,
      sheetAlias: sheetAlias.trim() || initialDisplayName || 'Admin',
      role: 'admin',
      canApprove: true,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(doc(db, 'users', authUser.uid));
    const profile = mapUserDoc(snap.id, snap.data() as Record<string, unknown>);
    await syncOwnMemberDirectoryBestEffort(profile);
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path, {
      uid: authUser.uid,
      role: 'admin',
    });
  }
}

export function subscribeTasks(
  onData: (tasks: TaskItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'tasks'), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) =>
        mapTaskDoc(d.id, d.data() as Record<string, unknown>)
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'tasks');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeCategories(
  onData: (categories: CategoryItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'categories'), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) =>
        mapCategoryDoc(d.id, d.data() as Record<string, unknown>)
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'categories');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeUsers(
  onData: (members: ProjectMember[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const members = snapshot.docs.map((d) =>
        mapUserDoc(d.id, d.data() as Record<string, unknown>)
      );
      onData(members);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

/**
 * Non-PII display directory listener for Member/Viewer accounts so teammates'
 * official Project Display Names render identically without exposing `/users` PII emails.
 * Never silently masks Firestore read errors as an empty/self-only directory.
 */
export function subscribeMemberDirectory(
  currentUser: ProjectMember,
  onData: (
    members: ProjectMember[],
    meta: { directoryDocCount: number }
  ) => void,
  onError?: (err: Error, meta: { isPermissionDenied: boolean }) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'memberDirectory'),
    (snapshot) => {
      const byUid = new Map<string, ProjectMember>();
      byUid.set(currentUser.uid, currentUser);

      snapshot.docs.forEach((d) => {
        const entry = mapMemberDirectoryDoc(
          d.id,
          d.data() as Record<string, unknown>
        );
        const cleanName = entry.displayName.trim();
        if (!cleanName) return;

        if (entry.uid === currentUser.uid) {
          byUid.set(entry.uid, {
            ...currentUser,
            displayName: cleanName || currentUser.displayName,
            isActive: entry.isActive,
          });
        } else {
          byUid.set(entry.uid, {
            uid: entry.uid,
            displayName: cleanName,
            email: '',
            role: 'member',
            canApprove: false,
            isActive: entry.isActive,
            sheetAlias: '',
            createdAt: '',
            updatedAt: entry.updatedAt,
          });
        }
      });

      onData(Array.from(byUid.values()), {
        directoryDocCount: snapshot.size,
      });
    },
    (error) => {
      const code =
        typeof (error as { code?: unknown })?.code === 'string'
          ? String((error as { code?: unknown }).code)
          : '';
      const rawMessage = error instanceof Error ? error.message : String(error);
      const isPermissionDenied =
        code === 'permission-denied' ||
        rawMessage.toLowerCase().includes('permission');

      try {
        handleFirestoreError(error, OperationType.LIST, 'memberDirectory');
      } catch (wrapped) {
        if (onError) {
          onError(wrapped as Error, { isPermissionDenied });
        }
      }
    }
  );
}

/**
 * Synchronizes minimal non-PII profiles (`uid`, `displayName`, `isActive`, `updatedAt`)
 * from `/users` into `/memberDirectory` for Admin.
 * Never falls back to email and never silently swallows write/read errors.
 */
export async function syncMemberDirectoryForAdmin(
  members: ProjectMember[]
): Promise<MemberDirectorySyncResult> {
  if (members.length === 0) {
    return {
      totalUsers: 0,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      directoryCount: 0,
    };
  }
  try {
    const snap = await getDocsFromServer(collection(db, 'memberDirectory'));
    const existingByUid = new Map<string, MemberDirectoryEntry>();
    snap.docs.forEach((d) => {
      existingByUid.set(
        d.id,
        mapMemberDirectoryDoc(d.id, d.data() as Record<string, unknown>)
      );
    });

    const pendingWrites: Array<{
      uid: string;
      displayName: string;
      isActive: boolean;
    }> = [];
    let unchangedCount = 0;
    let skippedCount = 0;
    let newlyAddedCount = 0;

    for (const m of members) {
      const cleanName = m.displayName.trim().slice(0, 120);
      if (!m.uid || !cleanName) {
        skippedCount++;
        continue;
      }
      const existing = existingByUid.get(m.uid);
      if (
        !existing ||
        existing.displayName !== cleanName ||
        existing.isActive !== m.isActive
      ) {
        if (!existing) {
          newlyAddedCount++;
        }
        pendingWrites.push({
          uid: m.uid,
          displayName: cleanName,
          isActive: m.isActive,
        });
      } else {
        unchangedCount++;
      }
    }

    const CHUNK_SIZE = 400;
    for (let i = 0; i < pendingWrites.length; i += CHUNK_SIZE) {
      const chunk = pendingWrites.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        batch.set(doc(db, 'memberDirectory', item.uid), {
          uid: item.uid,
          displayName: item.displayName,
          isActive: item.isActive,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    return {
      totalUsers: members.length,
      updatedCount: pendingWrites.length,
      unchangedCount,
      skippedCount,
      directoryCount: existingByUid.size + newlyAddedCount,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'memberDirectory', {
      memberCount: members.length,
    });
  }
}

export function subscribeInvites(
  onData: (invites: MemberInvite[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'invites'),
    (snapshot) => {
      const invites = snapshot.docs.map((d) =>
        mapInviteDoc(d.id, d.data() as Record<string, unknown>)
      );
      onData(invites);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'invites');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeAuthSettings(
  onData: (settings: AuthSettings) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'settings', 'auth'),
    (snap) => {
      if (!snap.exists()) {
        onData({
          allowOpenGoogleLogin: false,
          updatedAt: null,
          updatedBy: null,
        });
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      onData({
        allowOpenGoogleLogin: Boolean(data.allowOpenGoogleLogin),
        updatedAt: toIsoString(data.updatedAt),
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'settings/auth');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function updateOpenGoogleLoginSetting(
  allowOpenGoogleLogin: boolean,
  adminUser: ProjectMember
): Promise<void> {
  const path = 'settings/auth';
  try {
    await setDoc(doc(db, 'settings', 'auth'), {
      allowOpenGoogleLogin,
      updatedAt: serverTimestamp(),
      updatedBy: adminUser.uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path, {
      allowOpenGoogleLogin,
    });
  }
}

export function subscribeTaskComments(
  taskId: string,
  onData: (comments: TaskComment[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `tasks/${taskId}/comments`;
  const q = query(collection(db, 'tasks', taskId, 'comments'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: TaskComment[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          taskId: String(data.taskId ?? taskId),
          authorUid: String(data.authorUid ?? ''),
          authorName: String(data.authorName ?? ''),
          content: String(data.content ?? ''),
          createdAt: toIsoString(data.createdAt) ?? new Date().toISOString(),
        };
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeTaskLogs(
  taskId: string,
  onData: (logs: ActivityLog[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `tasks/${taskId}/activityLogs`;
  const q = query(
    collection(db, 'tasks', taskId, 'activityLogs'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ActivityLog[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          taskId: String(data.taskId ?? taskId),
          actorUid: String(data.actorUid ?? ''),
          actorName: String(data.actorName ?? ''),
          action: (data.action as ActivityLog['action']) ?? 'update',
          summary: String(data.summary ?? ''),
          createdAt: toIsoString(data.createdAt) ?? new Date().toISOString(),
        };
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

/**
 * Seeds the 3 baseline TBHGN categories idempotently (Admin only).
 */
export async function seedDefaultCategories(
  adminUser: ProjectMember
): Promise<number> {
  const batch = writeBatch(db);
  let createdCount = 0;

  try {
    for (const cat of DEFAULT_TBHGN_CATEGORIES) {
      const ref = doc(db, 'categories', cat.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        batch.set(ref, {
          name: cat.name,
          color: cat.color,
          sortOrder: cat.sortOrder,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: adminUser.uid,
          updatedBy: adminUser.uid,
        });
        createdCount++;
      }
    }
    if (createdCount > 0) {
      await batch.commit();
    }
    return createdCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'categories', {
      createdCount,
    });
  }
}

export async function createCategoryInFirestore(
  input: {
    name: string;
    color: string;
    sortOrder: number;
  },
  adminUser: ProjectMember
): Promise<string> {
  const slug = input.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const categoryId = `cat_${slug || 'item'}_${Date.now().toString(36)}`;
  const path = `categories/${categoryId}`;
  const payload = {
    name: input.name.trim(),
    color: /^#[0-9a-fA-F]{6}$/.test(input.color.trim())
      ? input.color.trim()
      : '#13294B',
    sortOrder: input.sortOrder,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: adminUser.uid,
    updatedBy: adminUser.uid,
  };

  try {
    await setDoc(doc(db, 'categories', categoryId), payload);
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path, {
      categoryId,
      name: payload.name,
      sortOrder: payload.sortOrder,
    });
  }
}

export async function updateCategoryInFirestore(
  categoryId: string,
  patch: Partial<Pick<CategoryItem, 'name' | 'color' | 'sortOrder' | 'isActive'>>,
  adminUser: ProjectMember
): Promise<void> {
  const path = `categories/${categoryId}`;
  const cleanPatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: adminUser.uid,
  };
  if (patch.name !== undefined) cleanPatch.name = patch.name.trim();
  if (patch.color !== undefined) {
    cleanPatch.color = /^#[0-9a-fA-F]{6}$/.test(patch.color.trim())
      ? patch.color.trim()
      : '#13294B';
  }
  if (patch.sortOrder !== undefined) cleanPatch.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) cleanPatch.isActive = patch.isActive;

  try {
    await updateDoc(doc(db, 'categories', categoryId), cleanPatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path, cleanPatch);
  }
}

export async function swapCategoryOrderInFirestore(
  catA: CategoryItem,
  catB: CategoryItem,
  adminUser: ProjectMember
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'categories', catA.id), {
    sortOrder: catB.sortOrder,
    updatedAt: serverTimestamp(),
    updatedBy: adminUser.uid,
  });
  batch.update(doc(db, 'categories', catB.id), {
    sortOrder: catA.sortOrder,
    updatedAt: serverTimestamp(),
    updatedBy: adminUser.uid,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'categories', {
      catA: catA.id,
      catB: catB.id,
    });
  }
}

export async function deleteUnusedCategoryInFirestore(
  categoryId: string,
  tasks: TaskItem[]
): Promise<void> {
  const usedCount = tasks.filter((t) => t.categoryId === categoryId).length;
  if (usedCount > 0) {
    throw new Error(
      `Không thể xóa vĩnh viễn hạng mục đang được sử dụng bởi ${usedCount} công việc. Vui lòng dùng "Ngừng sử dụng".`
    );
  }
  const path = `categories/${categoryId}`;
  try {
    await deleteDoc(doc(db, 'categories', categoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function generateUniqueSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildCreateTaskPayloads(
  input: {
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
    sortOrder: number;
  },
  currentUser: ProjectMember,
  ids?: { taskId?: string; logId?: string; isTestRecord?: boolean }
) {
  const suffix = generateUniqueSuffix();
  const isTestRecord = ids?.isTestRecord ?? true;
  const taskId = ids?.taskId ?? `${isTestRecord ? 'test_task_' : 'task_'}${suffix}`;
  const logId = ids?.logId ?? `log_${suffix}`;
  const actorDisplayName = (
    currentUser.displayName ||
    currentUser.sheetAlias ||
    currentUser.email ||
    'Thành viên'
  )
    .trim()
    .slice(0, 120);
  const nowTs = serverTimestamp();

  const taskPayload = {
    id: taskId,
    displayCode: input.displayCode,
    parentId: input.parentId,
    sortOrder: input.sortOrder,
    title: input.title,
    categoryId: input.categoryId,
    category: input.category,
    assignees: input.assignees,
    assigneeUids: input.assigneeUids,
    status: input.status,
    nextStep: input.nextStep,
    dueDate: input.dueDate,
    notes: null,
    referenceLinks: [],
    resultLinks: [],
    reviewFlags: input.assigneeUids.length === 0 ? ['missing_assignee'] : [],
    version: 1,
    updatedAt: nowTs,
    updatedBy: actorDisplayName,
    updatedByUid: currentUser.uid,
    archivedAt: null,
    archivedBy: null,
    isTestRecord,
  };

  const logPayload = {
    id: logId,
    taskId,
    actorUid: currentUser.uid,
    actorName: actorDisplayName,
    action: 'create' as const,
    summary: isTestRecord
      ? `Tạo đầu việc kiểm thử (${input.displayCode})`
      : `Tạo công việc mới (${input.displayCode})`,
    createdAt: nowTs,
  };

  return { taskId, logId, taskPayload, logPayload };
}

/**
 * Creates a task + atomic activityLog inside one Firestore writeBatch.
 */
export async function createTaskInFirestore(
  input: {
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
    sortOrder: number;
  },
  currentUser: ProjectMember
): Promise<string> {
  const { taskId, logId, taskPayload, logPayload } = buildCreateTaskPayloads(
    input,
    currentUser,
    {
      taskId: `task_${generateUniqueSuffix()}`,
      isTestRecord: false,
    }
  );
  const taskRef = doc(db, 'tasks', taskId);
  const logRef = doc(db, 'tasks', taskId, 'activityLogs', logId);

  try {
    const batch = writeBatch(db);
    batch.set(taskRef, taskPayload);
    batch.set(logRef, logPayload);
    await batch.commit();
    return taskId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${taskId}`, {
      displayCode: input.displayCode,
      parentId: input.parentId,
      categoryId: input.categoryId,
      assigneeUidsCount: input.assigneeUids.length,
      status: input.status,
      isTestRecord: false,
    });
  }
}

/**
 * Updates a task inside a Firestore transaction with optimistic concurrency version check
 * and atomic immutable activityLog creation.
 */
export async function updateTaskInFirestore(
  taskId: string,
  patch: Partial<TaskItem>,
  expectedVersion: number,
  currentUser: ProjectMember
): Promise<{ newVersion: number }> {
  const taskRef = doc(db, 'tasks', taskId);
  const logId = `log_${Date.now()}`;
  const logRef = doc(db, 'tasks', taskId, 'activityLogs', logId);

  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(taskRef);
      if (!snap.exists()) {
        throw new Error('Công việc không còn tồn tại.');
      }
      const existing = mapTaskDoc(
        snap.id,
        snap.data() as Record<string, unknown>
      );

      if (existing.version !== expectedVersion) {
        throw new Error(
          `CONFLICT:Dữ liệu vừa được ${existing.updatedBy ?? 'thành viên khác'} cập nhật lên phiên bản v${existing.version} (bạn đang mở v${expectedVersion}).`
        );
      }

      const nextVersion = existing.version + 1;
      const isManager =
        currentUser.role === 'admin' || currentUser.role === 'moderator';

      const updatePayload: Record<string, unknown> = {
        version: nextVersion,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      };

      if (isManager) {
        if (patch.displayCode !== undefined) updatePayload.displayCode = patch.displayCode;
        if (patch.parentId !== undefined) updatePayload.parentId = patch.parentId;
        if (patch.sortOrder !== undefined) updatePayload.sortOrder = patch.sortOrder;
        if (patch.title !== undefined) updatePayload.title = patch.title;
        if (patch.categoryId !== undefined) updatePayload.categoryId = patch.categoryId;
        if (patch.category !== undefined) updatePayload.category = patch.category;
        if (patch.assignees !== undefined) updatePayload.assignees = patch.assignees;
        if (patch.assigneeUids !== undefined) updatePayload.assigneeUids = patch.assigneeUids;
        if (patch.approverUids !== undefined) updatePayload.approverUids = patch.approverUids;
        if (patch.dueDate !== undefined) updatePayload.dueDate = patch.dueDate;
        if (patch.reviewFlags !== undefined) updatePayload.reviewFlags = patch.reviewFlags;
      }

      if (patch.status !== undefined) updatePayload.status = patch.status;
      if (patch.nextStep !== undefined) updatePayload.nextStep = patch.nextStep;
      if (patch.notes !== undefined) updatePayload.notes = patch.notes;
      if (patch.referenceLinks !== undefined) updatePayload.referenceLinks = patch.referenceLinks;
      if (patch.resultLinks !== undefined) updatePayload.resultLinks = patch.resultLinks;

      const changes: string[] = [];
      if (patch.status !== undefined && patch.status !== existing.status) {
        changes.push(
          `Trạng thái: ${existing.status ?? 'Chưa thiết lập'} -> ${
            patch.status ?? 'Chưa thiết lập'
          }`
        );
      }
      if (
        patch.nextStep !== undefined &&
        (patch.nextStep ?? '') !== (existing.nextStep ?? '')
      ) {
        changes.push('Cập nhật bước tiếp theo');
      }
      if (isManager && patch.title && patch.title !== existing.title) {
        changes.push('Đổi tên đầu việc');
      }
      if (isManager && patch.categoryId !== undefined && patch.categoryId !== existing.categoryId) {
        changes.push('Cập nhật hạng mục');
      }
      if (isManager && patch.assigneeUids !== undefined) {
        const prevUids = existing.assigneeUids ?? [];
        const nextUids = patch.assigneeUids ?? [];
        const addedUids = nextUids.filter((u) => !prevUids.includes(u));
        const removedUids = prevUids.filter((u) => !nextUids.includes(u));
        if (addedUids.length > 0 && removedUids.length > 0) {
          changes.push(
            `Đổi liên kết tài khoản UID (thu hồi ${removedUids.length} UID cũ, gán ${addedUids.length} UID mới)`
          );
        } else if (removedUids.length > 0) {
          changes.push(
            nextUids.length === 0
              ? `Thu hồi ${removedUids.length} UID cũ (chuyển về Chưa liên kết tài khoản)`
              : `Thu hồi ${removedUids.length} UID phân công`
          );
        } else if (addedUids.length > 0) {
          changes.push(`Xác nhận liên kết ${addedUids.length} UID thực hiện`);
        }
      }

      tx.update(taskRef, updatePayload);
      tx.set(logRef, {
        id: logId,
        taskId,
        actorUid: currentUser.uid,
        actorName: currentUser.displayName,
        action:
          patch.status === 'Hoàn thành'
            ? 'approve'
            : patch.status !== undefined && patch.status !== existing.status
            ? 'status_change'
            : 'update',
        summary:
          changes.length > 0 ? changes.join(' · ') : 'Cập nhật thông tin công việc',
        createdAt: serverTimestamp(),
      });

      return { newVersion: nextVersion };
    });

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONFLICT:')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, {
      expectedVersion,
      patchKeys: Object.keys(patch),
    });
  }
}

export async function archiveOrRestoreTaskInFirestore(
  taskId: string,
  archive: boolean,
  currentUser: ProjectMember
): Promise<void> {
  const taskRef = doc(db, 'tasks', taskId);
  const logId = `log_${Date.now()}`;
  const logRef = doc(db, 'tasks', taskId, 'activityLogs', logId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(taskRef);
      if (!snap.exists()) throw new Error('Không tìm thấy công việc.');
      const existingVersion = Number(snap.data().version ?? 1);

      tx.update(taskRef, {
        archivedAt: archive ? serverTimestamp() : null,
        archivedBy: archive ? currentUser.displayName : null,
        version: existingVersion + 1,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
      });

      tx.set(logRef, {
        id: logId,
        taskId,
        actorUid: currentUser.uid,
        actorName: currentUser.displayName,
        action: archive ? 'archive' : 'restore',
        summary: archive
          ? 'Chuyển công việc vào lưu trữ'
          : 'Khôi phục công việc từ lưu trữ',
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, {
      archive,
    });
  }
}

/**
 * Atomically writes a comment + matching activityLog using the same document ID.
 */
export async function addCommentInFirestore(
  taskId: string,
  content: string,
  currentUser: ProjectMember
): Promise<void> {
  const cmtId = `cmt_${Date.now()}`;
  const cmtRef = doc(db, 'tasks', taskId, 'comments', cmtId);
  const logRef = doc(db, 'tasks', taskId, 'activityLogs', cmtId);

  try {
    const batch = writeBatch(db);
    batch.set(cmtRef, {
      id: cmtId,
      taskId,
      authorUid: currentUser.uid,
      authorName: currentUser.displayName,
      content,
      createdAt: serverTimestamp(),
    });
    batch.set(logRef, {
      id: cmtId,
      taskId,
      actorUid: currentUser.uid,
      actorName: currentUser.displayName,
      action: 'comment',
      summary: `Góp ý mới: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `tasks/${taskId}/comments/${cmtId}`,
      { taskId, cmtId }
    );
  }
}

/**
 * Stage B1 ONLY: Ensures 3 default categories exist and seeds 3 test tasks (T1, T1.1, T2)
 * idempotently in one atomic writeBatch (supported by existsAfter/getAfter in firestore.rules).
 */
export async function seedB1SandboxTasks(
  currentUser: ProjectMember
): Promise<number> {
  await seedDefaultCategories(currentUser);

  const items = [
    {
      id: 'b1_test_parent',
      displayCode: 'T1',
      parentId: null,
      sortOrder: 0,
      title: '[Kiểm thử B1] Nhóm công việc thử nghiệm phân quyền',
      categoryId: 'cat_foundation',
      category: 'Nền tảng & quy chuẩn',
      assignees: [currentUser.displayName || currentUser.sheetAlias || 'Admin'],
      assigneeUids: [currentUser.uid],
      status: 'Đang làm',
      nextStep: 'Thử mở việc con và cập nhật trạng thái',
      notes: 'Dữ liệu kiểm thử Giai đoạn B1 — không phải 20 đầu việc chính thức.',
    },
    {
      id: 'b1_test_child_1',
      displayCode: 'T1.1',
      parentId: 'b1_test_parent',
      sortOrder: 1,
      title: '[Kiểm thử B1] Việc con thử nghiệm đồng bộ thời gian thực',
      categoryId: 'cat_foundation',
      category: 'Nền tảng & quy chuẩn',
      assignees: [currentUser.displayName || currentUser.sheetAlias || 'Admin'],
      assigneeUids: [currentUser.uid],
      status: 'Chờ duyệt',
      nextStep: 'Thử duyệt chuyển sang Hoàn thành',
      notes: 'Việc con kiểm thử tiến độ tự động (kế thừa hạng mục từ T1).',
    },
    {
      id: 'b1_test_unassigned',
      displayCode: 'T2',
      parentId: null,
      sortOrder: 2,
      title: '[Kiểm thử B1] Việc chưa phân công (kiểm tra chặn Member sửa trái phép)',
      categoryId: 'cat_outline',
      category: 'Đề cương',
      assignees: [],
      assigneeUids: [],
      status: 'Chưa bắt đầu',
      nextStep: 'Member không được giao UID sẽ bị Firestore Rules từ chối nếu cố sửa',
      notes: null,
    },
  ];

  const batch = writeBatch(db);
  const logStamp = Date.now();
  let createdCount = 0;

  try {
    for (const item of items) {
      const taskRef = doc(db, 'tasks', item.id);
      const existingSnap = await getDoc(taskRef);
      if (existingSnap.exists()) {
        continue;
      }

      const logId = `init_log_${logStamp}`;
      const logRef = doc(db, 'tasks', item.id, 'activityLogs', logId);
      batch.set(taskRef, {
        id: item.id,
        displayCode: item.displayCode,
        parentId: item.parentId,
        sortOrder: item.sortOrder,
        title: item.title,
        categoryId: item.categoryId,
        category: item.category,
        assignees: item.assignees,
        assigneeUids: item.assigneeUids,
        status: item.status,
        nextStep: item.nextStep,
        dueDate: null,
        notes: item.notes,
        referenceLinks: [],
        resultLinks: [],
        reviewFlags: item.assigneeUids.length === 0 ? ['missing_assignee'] : [],
        version: 1,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.displayName,
        updatedByUid: currentUser.uid,
        archivedAt: null,
        archivedBy: null,
        isTestRecord: true,
      });
      batch.set(logRef, {
        id: logId,
        taskId: item.id,
        actorUid: currentUser.uid,
        actorName: currentUser.displayName,
        action: 'create',
        summary: `Khởi tạo bản ghi kiểm thử Giai đoạn B1 (${item.displayCode})`,
        createdAt: serverTimestamp(),
      });
      createdCount++;
    }

    if (createdCount > 0) {
      await batch.commit();
    }
    return createdCount;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      'tasks (batch: b1_test_parent, b1_test_child_1, b1_test_unassigned)',
      {
        createdCount,
        ids: items.map((i) => i.id),
        isTestRecord: true,
      }
    );
  }
}

/**
 * Reads live Firestore server tasks directly (bypassing local cache) to reconcile
 * the 20 official TBHGN tasks, parent-child structure, 0/2-0/5-0/4 progress,
 * statuses, and 13 resultLinks URLs against Firestore truth.
 */
export async function verifyOfficialImportInFirestore(
  expectedIds: string[]
): Promise<OfficialImportVerification> {
  try {
    const snap = await getDocsFromServer(collection(db, 'tasks'));
    const serverTasks = snap.docs.map((d) =>
      mapTaskDoc(d.id, d.data() as Record<string, unknown>)
    );
    return computeOfficialFirestoreVerification(serverTasks, expectedIds);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      'tasks (official TBHGN server verification)'
    );
  }
}

/**
 * Stage B2.2: Idempotent official TBHGN project data import (Admin only, separate from B1 test-task creation).
 * Performs strict preflight validation + fresh server-side ID/displayCode conflict checks before staging
 * writes so reruns never duplicate or overwrite existing tasks, then reads back from Firestore server.
 */
export async function importOfficialTasksToFirestore(
  items: OfficialImportPlanItem[],
  summary: OfficialImportSummary,
  adminUser: ProjectMember
): Promise<OfficialImportExecutionResult> {
  if (adminUser.role !== 'admin' || !adminUser.isActive) {
    throw new Error('Chỉ Quản trị viên đang hoạt động mới có quyền nhập dữ liệu dự án.');
  }

  const preflight = validateOfficialImportPreflight(items, summary);
  if (!preflight.ok) {
    throw new Error(`PREFLIGHT:${preflight.errors.join(' ')}`);
  }

  const batch = writeBatch(db);
  const nowTs = serverTimestamp();
  const logSuffix = Date.now().toString(36);
  const skippedIds: string[] = [];
  let importedCount = 0;

  try {
    // Re-check live Firestore server right before writing to prevent stale-cache collisions or overwrites
    const liveSnap = await getDocsFromServer(collection(db, 'tasks'));
    const liveTasks = liveSnap.docs.map((d) =>
      mapTaskDoc(d.id, d.data() as Record<string, unknown>)
    );
    const liveById = new Map(liveTasks.map((t) => [t.id, t]));
    const liveByCode = new Map<string, TaskItem[]>();
    for (const t of liveTasks) {
      if (t.archivedAt) continue;
      const key = t.displayCode.trim();
      const arr = liveByCode.get(key) ?? [];
      arr.push(t);
      liveByCode.set(key, arr);
    }

    for (const item of items) {
      const targetId = item.normalizedPayload.id;
      if (liveById.has(targetId)) {
        skippedIds.push(targetId);
        continue;
      }

      const codeConflicts = (
        liveByCode.get(item.normalizedPayload.displayCode.trim()) ?? []
      ).filter((t) => t.id !== targetId);
      if (codeConflicts.length > 0) {
        throw new Error(
          `PREFLIGHT:Phát hiện xung đột mã hiển thị "${item.normalizedPayload.displayCode}" trên Firestore thật với bản ghi ${codeConflicts
            .map((t) => t.id)
            .join(', ')}. Đã dừng nhập và không ghi đè.`
        );
      }

      const { taskId, logId, taskPayload, logPayload } =
        buildOfficialTaskFirestoreWritePayloads(
          item,
          adminUser,
          nowTs,
          logSuffix
        );

      const taskRef = doc(db, 'tasks', taskId);
      const logRef = doc(db, 'tasks', taskId, 'activityLogs', logId);
      batch.set(taskRef, taskPayload);
      batch.set(logRef, logPayload);
      importedCount++;
    }

    if (importedCount > 0) {
      await batch.commit();
    }

    const verification = await verifyOfficialImportInFirestore(
      items.map((i) => i.normalizedPayload.id)
    );

    return {
      importedCount,
      skippedIds,
      errorCount: 0,
      verification,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PREFLIGHT:')) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.WRITE,
      'tasks (official TBHGN import batch)',
      {
        importedCount,
        skippedCount: skippedIds.length,
        isTestRecord: false,
      }
    );
  }
}

export async function createOrUpdateInvite(
  input: {
    email: string;
    displayName: string;
    sheetAlias: string;
    role: UserRole;
    canApprove: boolean;
  },
  adminUser: ProjectMember
): Promise<void> {
  const emailLower = input.email.trim().toLowerCase();
  const path = `invites/${emailLower}`;
  try {
    await setDoc(doc(db, 'invites', emailLower), {
      email: emailLower,
      displayName: input.displayName.trim(),
      sheetAlias: input.sheetAlias.trim(),
      role: input.role,
      canApprove:
        input.role === 'admin' || input.role === 'moderator'
          ? true
          : input.canApprove,
      isActive: true,
      createdBy: adminUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path, {
      role: input.role,
      canApprove: input.canApprove,
    });
  }
}

export async function updateMemberInFirestore(
  uid: string,
  email: string,
  patch: Partial<Pick<ProjectMember, 'role' | 'canApprove' | 'isActive' | 'sheetAlias' | 'displayName'>>
): Promise<{ directorySynced: boolean; directoryError?: string }> {
  const userPath = `users/${uid}`;
  const cleanPatch: Record<string, unknown> = { ...patch };
  if (patch.displayName !== undefined) {
    const trimmedName = patch.displayName.trim().slice(0, 120);
    if (!trimmedName) {
      throw new Error('Tên hiển thị không được để trống.');
    }
    cleanPatch.displayName = trimmedName;
  }
  if (patch.sheetAlias !== undefined) {
    cleanPatch.sheetAlias = patch.sheetAlias.trim().slice(0, 80);
  }

  try {
    await updateDoc(doc(db, 'users', uid), {
      ...cleanPatch,
      updatedAt: serverTimestamp(),
    });

    const emailLower = email.trim().toLowerCase();
    if (emailLower) {
      const inviteSnap = await getDoc(doc(db, 'invites', emailLower));
      if (inviteSnap.exists()) {
        await updateDoc(doc(db, 'invites', emailLower), {
          ...cleanPatch,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (
      cleanPatch.displayName !== undefined ||
      cleanPatch.isActive !== undefined
    ) {
      try {
        const updatedSnap = await getDoc(doc(db, 'users', uid));
        if (updatedSnap.exists()) {
          const updatedProfile = mapUserDoc(
            updatedSnap.id,
            updatedSnap.data() as Record<string, unknown>
          );
          const cleanName = updatedProfile.displayName.trim().slice(0, 120);
          if (cleanName) {
            await setDoc(doc(db, 'memberDirectory', uid), {
              uid,
              displayName: cleanName,
              isActive: updatedProfile.isActive,
              updatedAt: serverTimestamp(),
            });
          } else {
            return {
              directorySynced: false,
              directoryError:
                'Tên hiển thị đang trống nên chưa đồng bộ sang danh bạ chung.',
            };
          }
        }
      } catch (dirError) {
        const dirMsg =
          dirError instanceof Error ? dirError.message : String(dirError);
        return {
          directorySynced: false,
          directoryError: dirMsg,
        };
      }
    }
    return { directorySynced: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath, cleanPatch);
  }
}

export async function updateInviteInFirestore(
  emailLower: string,
  patch: Partial<Pick<MemberInvite, 'displayName' | 'role' | 'canApprove' | 'isActive'>>
): Promise<void> {
  const path = `invites/${emailLower}`;
  const cleanPatch: Record<string, unknown> = { ...patch };
  if (patch.displayName !== undefined) {
    const trimmedName = patch.displayName.trim().slice(0, 120);
    if (!trimmedName) {
      throw new Error('Tên hiển thị không được để trống.');
    }
    cleanPatch.displayName = trimmedName;
  }
  try {
    await updateDoc(doc(db, 'invites', emailLower), {
      ...cleanPatch,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path, cleanPatch);
  }
}

export async function removeInviteInFirestore(emailLower: string): Promise<void> {
  const path = `invites/${emailLower}`;
  try {
    await deleteDoc(doc(db, 'invites', emailLower));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Admin-only explicit confirmation: assigns a member's Firebase UID to selected tasks
 * inside one atomic transaction without overwriting original `assignees` text.
 */
export async function assignMemberToTasksInFirestore(
  member: ProjectMember,
  selectedTaskIds: string[],
  adminUser: ProjectMember
): Promise<{ updatedCount: number; skippedCount: number }> {
  if (adminUser.role !== 'admin' || !adminUser.isActive) {
    throw new Error('Chỉ Quản trị viên đang hoạt động mới được giao công việc.');
  }
  if (!member.isActive) {
    throw new Error('Không thể giao việc cho tài khoản đang bị khóa.');
  }
  const uniqueTaskIds = Array.from(new Set(selectedTaskIds)).filter(Boolean);
  if (uniqueTaskIds.length === 0) {
    return { updatedCount: 0, skippedCount: 0 };
  }

  try {
    const result = await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        uniqueTaskIds.map((id) => tx.get(doc(db, 'tasks', id)))
      );

      let updatedCount = 0;
      let skippedCount = 0;
      const nowTs = serverTimestamp();
      const logPrefix = `log_assign_${Date.now().toString(36)}`;

      snaps.forEach((snap, idx) => {
        if (!snap.exists()) {
          skippedCount++;
          return;
        }
        const existing = mapTaskDoc(
          snap.id,
          snap.data() as Record<string, unknown>
        );
        if (existing.archivedAt || existing.assigneeUids.includes(member.uid)) {
          skippedCount++;
          return;
        }

        const nextUids = [...existing.assigneeUids, member.uid];
        const nextFlags = existing.reviewFlags.filter(
          (f) => f !== 'missing_assignee'
        );
        const taskRef = doc(db, 'tasks', snap.id);
        const logId = `${logPrefix}_${idx}`;
        const logRef = doc(db, 'tasks', snap.id, 'activityLogs', logId);

        tx.update(taskRef, {
          assigneeUids: nextUids,
          reviewFlags: nextFlags,
          version: existing.version + 1,
          updatedAt: nowTs,
          updatedBy: adminUser.displayName,
          updatedByUid: adminUser.uid,
        });

        tx.set(logRef, {
          id: logId,
          taskId: snap.id,
          actorUid: adminUser.uid,
          actorName: adminUser.displayName,
          action: 'update',
          summary: `Xác nhận giao việc cho ${member.displayName} (${member.email})`,
          createdAt: nowTs,
        });

        updatedCount++;
      });

      return { updatedCount, skippedCount };
    });

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'tasks (batch assign)', {
      targetUid: member.uid,
      taskCount: uniqueTaskIds.length,
    });
  }
}

/**
 * Admin-only explicit confirmation: transfers task UID ownership from an old/replaced
 * temporary account to a newly signed-in official account inside one atomic transaction.
 * Preserves original `assignees` text, statuses, links, and existing activityLogs.
 */
export async function transferTaskUidInFirestore(
  oldMember: ProjectMember,
  newMember: ProjectMember,
  selectedTaskIds: string[],
  adminUser: ProjectMember
): Promise<{ updatedCount: number; skippedCount: number }> {
  if (adminUser.role !== 'admin' || !adminUser.isActive) {
    throw new Error('Chỉ Quản trị viên đang hoạt động mới được chuyển UID công việc.');
  }
  if (!newMember.isActive) {
    throw new Error('Không thể chuyển công việc sang tài khoản đang bị khóa.');
  }
  if (oldMember.uid === newMember.uid) {
    return { updatedCount: 0, skippedCount: selectedTaskIds.length };
  }
  const uniqueTaskIds = Array.from(new Set(selectedTaskIds)).filter(Boolean);
  if (uniqueTaskIds.length === 0) {
    return { updatedCount: 0, skippedCount: 0 };
  }

  const actorName = (
    adminUser.displayName ||
    adminUser.sheetAlias ||
    adminUser.email ||
    'Admin'
  )
    .trim()
    .slice(0, 120);

  try {
    const result = await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        uniqueTaskIds.map((id) => tx.get(doc(db, 'tasks', id)))
      );

      let updatedCount = 0;
      let skippedCount = 0;
      const nowTs = serverTimestamp();
      const logPrefix = `log_xfer_${Date.now().toString(36)}`;

      snaps.forEach((snap, idx) => {
        if (!snap.exists()) {
          skippedCount++;
          return;
        }
        const existing = mapTaskDoc(
          snap.id,
          snap.data() as Record<string, unknown>
        );
        const hasOldAssignee = existing.assigneeUids.includes(oldMember.uid);
        const hasOldApprover = (existing.approverUids ?? []).includes(oldMember.uid);
        if (existing.archivedAt || (!hasOldAssignee && !hasOldApprover)) {
          skippedCount++;
          return;
        }

        const updatePayload: Record<string, unknown> = {
          version: existing.version + 1,
          updatedAt: nowTs,
          updatedBy: actorName,
          updatedByUid: adminUser.uid,
        };

        if (hasOldAssignee) {
          const replacedUids = existing.assigneeUids.map((u) =>
            u === oldMember.uid ? newMember.uid : u
          );
          const nextAssigneeUids = Array.from(new Set(replacedUids));
          updatePayload.assigneeUids = nextAssigneeUids;
          if (
            nextAssigneeUids.length > 0 &&
            existing.reviewFlags.includes('missing_assignee')
          ) {
            updatePayload.reviewFlags = existing.reviewFlags.filter(
              (f) => f !== 'missing_assignee'
            );
          }
        }

        if (hasOldApprover && Array.isArray(existing.approverUids)) {
          const replacedApprovers = existing.approverUids.map((u) =>
            u === oldMember.uid ? newMember.uid : u
          );
          updatePayload.approverUids = Array.from(new Set(replacedApprovers));
        }

        const taskRef = doc(db, 'tasks', snap.id);
        const logId = `${logPrefix}_${idx}`;
        const logRef = doc(db, 'tasks', snap.id, 'activityLogs', logId);

        tx.update(taskRef, updatePayload);
        tx.set(logRef, {
          id: logId,
          taskId: snap.id,
          actorUid: adminUser.uid,
          actorName,
          action: 'update',
          summary: `Chuyển phân công UID từ ${oldMember.email} sang ${newMember.email} (giữ nguyên tên gốc và lịch sử)`.slice(
            0,
            500
          ),
          createdAt: nowTs,
        });

        updatedCount++;
      });

      return { updatedCount, skippedCount };
    });

    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'tasks (batch uid transfer)', {
      oldUid: oldMember.uid,
      newUid: newMember.uid,
      taskCount: uniqueTaskIds.length,
    });
  }
}


