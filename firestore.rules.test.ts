import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebaseConfig from './firebase-applet-config.json';
import {
  buildProjectDocumentEntries,
  buildTaskLinkAddPatch,
  buildTaskLinkRemovePatch,
  buildTaskLinkUpdatePatch,
  canBeParent,
  canUserApproveTask,
  canUserCreateSubtask,
  canUserCreateSubtaskInParent,
  canUserEditTask,
  compareTasksForMyWork,
  computeParentProgress,
  evaluateMyWorkAttention,
  exportTasksToCSV,
  getCategoryVisualTheme,
  getDocumentDisplayLabel,
  getDocumentSourceLabel,
  getEffectiveCategory,
  getMyWorkCoAssigneesInfo,
  getOfficialMemberDisplayName,
  getStatusMeta,
  getTaskDataReviewSummary,
  hasDuplicateUrlInGroup,
  isB1TestTask,
  isGenericDocumentLabel,
  isTaskManagerRole,
  MAX_LINKS_PER_GROUP,
  partitionMyWorkTasks,
  resolveParentExpandedState,
  resolveTaskAssignees,
  STATUS_META,
  summarizeChildAttention,
  UNSET_STATUS_META,
  validateHttpUrl,
} from './src/utils/taskHelpers';
import { DocumentLink } from './src/types/project';
import { SEED_TASKS } from './src/data/seedTasks';
import { buildCreateTaskPayloads, DEFAULT_TBHGN_CATEGORIES } from './src/services/firestoreService';
import {
  buildOfficialImportPlan,
  buildOfficialTaskFirestoreWritePayloads,
  computeOfficialFirestoreVerification,
  parseOfficialJsonDataset,
  validateOfficialImportPreflight,
} from './src/utils/officialImport';
import {
  buildConfirmedAssignmentUpdates,
  buildMemberMappingPreview,
  COLLECTIVE_GROUP_LABEL,
  computeUpdatedAssigneeNamesOnUidToggle,
  doesMemberMatchProjectPerson,
  doesTaskMatchExpectedAccount,
  EXPECTED_TBHGN_ACCOUNTS,
  formatStandardMemberLabel,
  getSafeInviteDefaults,
  isTemporaryAccountEmail,
} from './src/utils/memberMapping';
import { CategoryItem, MemberInvite, ProjectMember, TaskItem } from './src/types/project';

const rootDir = process.cwd();
const rulesText = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
const appText = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
const myTasksText = fs.readFileSync(
  path.join(rootDir, 'src/components/MyTasksView.tsx'),
  'utf8'
);
const drawerText = fs.readFileSync(
  path.join(rootDir, 'src/components/TaskDetailDrawer.tsx'),
  'utf8'
);
const membersViewText = fs.readFileSync(
  path.join(rootDir, 'src/components/MembersView.tsx'),
  'utf8'
);
const adminSettingsViewText = fs.readFileSync(
  path.join(rootDir, 'src/components/AdminSettingsView.tsx'),
  'utf8'
);
const categoriesViewText = fs.readFileSync(
  path.join(rootDir, 'src/components/CategoriesView.tsx'),
  'utf8'
);
const memberMappingText = fs.readFileSync(
  path.join(rootDir, 'src/utils/memberMapping.ts'),
  'utf8'
);
const serverText = fs.readFileSync(path.join(rootDir, 'server.ts'), 'utf8');
const importPreviewText = fs.readFileSync(
  path.join(rootDir, 'src/components/ImportPreviewView.tsx'),
  'utf8'
);
const serviceText = fs.readFileSync(
  path.join(rootDir, 'src/services/firestoreService.ts'),
  'utf8'
);

function createSyntheticOfficialDataset() {
  const mkLink = (idx: number) => [
    {
      id: `lnk_res_${idx}`,
      label: `Tai lieu ${idx}`,
      url: `https://example.com/doc-${idx}`,
      type: 'google_drive_link' as const,
      needsUrlExtraction: false,
    },
  ];
  // 9 parents + 11 children = 20 tasks; 3 (0/2), 4 (0/5), 5 (0/4);
  // 7 Đang làm, 2 Chờ duyệt, 10 Tạm dừng, 1 null (4.5); 13 result URLs;
  // 6 missing_assignee + 1 missing_status = 7 flagged tasks; Nhóm on 1 & 5.
  const tasks = [
    { id: 'tbhgn_1', displayCode: '1', parentId: null, sortOrder: 1, title: 'Nhom viec 1', category: 'Đề cương', assignees: ['Quốc', 'Nhóm'], status: 'Đang làm', resultLinks: mkLink(1), reviewFlags: [] },
    { id: 'tbhgn_2', displayCode: '2', parentId: null, sortOrder: 2, title: 'Nhom viec 2', category: 'Nền tảng & quy chuẩn', assignees: ['Khả Tuệ'], status: 'Đang làm', resultLinks: mkLink(2), reviewFlags: [] },
    { id: 'tbhgn_3', displayCode: '3', parentId: null, sortOrder: 3, title: 'Nhom viec 3', category: 'Nền tảng & quy chuẩn', assignees: ['Khánh'], status: 'Đang làm', resultLinks: mkLink(3), reviewFlags: [] },
    { id: 'tbhgn_3_1', displayCode: '3.1', parentId: 'tbhgn_3', sortOrder: 4, title: 'Viec con 3.1', category: null, assignees: ['Quốc'], status: 'Đang làm', resultLinks: mkLink(4), reviewFlags: [] },
    { id: 'tbhgn_3_2', displayCode: '3.2', parentId: 'tbhgn_3', sortOrder: 5, title: 'Viec con 3.2', category: null, assignees: ['Sư Minh Hạnh'], status: 'Chờ duyệt', resultLinks: mkLink(5), reviewFlags: [] },
    { id: 'tbhgn_4', displayCode: '4', parentId: null, sortOrder: 6, title: 'Nhom viec 4', category: 'Truy nguồn & nghiên cứu', assignees: ['Sư Pháp Tín'], status: 'Đang làm', resultLinks: mkLink(6), reviewFlags: [] },
    { id: 'tbhgn_4_1', displayCode: '4.1', parentId: 'tbhgn_4', sortOrder: 7, title: 'Viec con 4.1', category: null, assignees: ['Quốc'], status: 'Đang làm', resultLinks: mkLink(7), reviewFlags: [] },
    { id: 'tbhgn_4_2', displayCode: '4.2', parentId: 'tbhgn_4', sortOrder: 8, title: 'Viec con 4.2', category: null, assignees: ['Khánh'], status: 'Chờ duyệt', resultLinks: mkLink(8), reviewFlags: [] },
    { id: 'tbhgn_4_3', displayCode: '4.3', parentId: 'tbhgn_4', sortOrder: 9, title: 'Viec con 4.3', category: null, assignees: ['Mỵ'], status: 'Tạm dừng', resultLinks: mkLink(9), reviewFlags: [] },
    { id: 'tbhgn_4_4', displayCode: '4.4', parentId: 'tbhgn_4', sortOrder: 10, title: 'Viec con 4.4', category: null, assignees: [], status: 'Tạm dừng', resultLinks: mkLink(10), reviewFlags: ['missing_assignee'] },
    { id: 'tbhgn_4_5', displayCode: '4.5', parentId: 'tbhgn_4', sortOrder: 11, title: 'Viec con 4.5', category: null, assignees: ['Mỵ'], status: null, resultLinks: mkLink(11), reviewFlags: ['missing_status'] },
    { id: 'tbhgn_5', displayCode: '5', parentId: null, sortOrder: 12, title: 'Nhom viec 5', category: 'Truy nguồn & nghiên cứu', assignees: ['Khánh', 'Nhóm'], status: 'Đang làm', notes: 'Trạng thái gốc: Đang chỉnh sửa', resultLinks: mkLink(12), reviewFlags: [] },
    { id: 'tbhgn_5_1', displayCode: '5.1', parentId: 'tbhgn_5', sortOrder: 13, title: 'Viec con 5.1', category: null, assignees: [], status: 'Tạm dừng', resultLinks: mkLink(13), reviewFlags: ['missing_assignee'] },
    { id: 'tbhgn_5_2', displayCode: '5.2', parentId: 'tbhgn_5', sortOrder: 14, title: 'Viec con 5.2', category: null, assignees: ['Quốc'], status: 'Tạm dừng', resultLinks: [], reviewFlags: [] },
    { id: 'tbhgn_5_3', displayCode: '5.3', parentId: 'tbhgn_5', sortOrder: 15, title: 'Viec con 5.3', category: null, assignees: [], status: 'Tạm dừng', resultLinks: [], reviewFlags: ['missing_assignee'] },
    { id: 'tbhgn_5_4', displayCode: '5.4', parentId: 'tbhgn_5', sortOrder: 16, title: 'Viec con 5.4', category: null, assignees: [], status: 'Tạm dừng', resultLinks: [], reviewFlags: ['missing_assignee'] },
    { id: 'tbhgn_6', displayCode: '6', parentId: null, sortOrder: 17, title: 'Nhom viec 6', category: 'Đề cương', assignees: ['Quốc'], status: 'Tạm dừng', resultLinks: [], reviewFlags: [] },
    { id: 'tbhgn_7', displayCode: '7', parentId: null, sortOrder: 18, title: 'Nhom viec 7', category: 'Nền tảng & quy chuẩn', assignees: ['Mỵ'], status: 'Tạm dừng', resultLinks: [], reviewFlags: [] },
    { id: 'tbhgn_8', displayCode: '8', parentId: null, sortOrder: 19, title: 'Nhom viec 8', category: 'Đề cương', assignees: [], status: 'Tạm dừng', resultLinks: [], reviewFlags: ['missing_assignee'] },
    { id: 'tbhgn_9', displayCode: '9', parentId: null, sortOrder: 20, title: 'Nhom viec 9', category: 'Đề cương', assignees: [], status: 'Tạm dừng', resultLinks: [], reviewFlags: ['missing_assignee'] },
  ].map((t) => ({
    assigneeUids: [],
    nextStep: null,
    dueDate: null,
    notes: null,
    referenceLinks: [],
    version: 1,
    updatedAt: null,
    updatedBy: null,
    archivedAt: null,
    archivedBy: null,
    lastCheckedAt: '2026-01-01',
    migrationSourceRow: t.sortOrder,
    ...t,
  }));

  return {
    dataset: 'tbhgn_synthetic_test_fixture',
    schemaVersion: '1.0',
    source: {
      kind: 'synthetic_test_fixture',
      fileName: 'synthetic_20_tasks.json',
      spreadsheetUrl: '',
      tab: 'Test',
      rows: '1-20',
      linkColumn: 'resultLinks',
    },
    qualityNotes: [],
    counts: {
      tasks: 20,
      parents: 9,
      children: 11,
      tasksWithRecoveredRealUrls: 13,
      missingAssignee: 6,
      missingStatus: 1,
      missingHyperlinkUrl: 0,
    },
    tasks,
  };
}

const officialJsonPath = path.join(
  rootDir,
  'server_data/TBHGN_du_lieu_20_cong_viec_da_khoi_phuc_URL_38662941.json'
);
const officialJsonRaw = fs.existsSync(officialJsonPath)
  ? JSON.parse(fs.readFileSync(officialJsonPath, 'utf8'))
  : createSyntheticOfficialDataset();

const adminUser: ProjectMember = {
  uid: 'uid_admin',
  displayName: 'Khánh (Admin)',
  email: 'ngaothuyet2023@gmail.com',
  role: 'admin',
  canApprove: true,
  isActive: true,
  sheetAlias: 'Khánh',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const moderatorUser: ProjectMember = {
  uid: 'uid_moderator',
  displayName: 'Điều phối (Mod)',
  email: 'mod@example.com',
  role: 'moderator',
  canApprove: true,
  isActive: true,
  sheetAlias: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const memberUser: ProjectMember = {
  uid: 'uid_member',
  displayName: 'Quốc',
  email: 'quoc@example.com',
  role: 'member',
  canApprove: false,
  isActive: true,
  sheetAlias: 'Quốc',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const scopedApproverMember: ProjectMember = {
  uid: 'uid_approver',
  displayName: 'Biên tập',
  email: 'editor@example.com',
  role: 'member',
  canApprove: true,
  isActive: true,
  sheetAlias: 'Biên tập',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const viewerUser: ProjectMember = {
  uid: 'uid_viewer',
  displayName: 'Khách xem',
  email: 'viewer@example.com',
  role: 'viewer',
  canApprove: false,
  isActive: true,
  sheetAlias: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const lockedMember: ProjectMember = {
  ...memberUser,
  uid: 'uid_locked',
  isActive: false,
};

const sampleCategories: CategoryItem[] = [
  {
    id: 'cat_foundation',
    name: 'Nền tảng & quy chuẩn',
    color: '#1E5631',
    sortOrder: 2,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'uid_admin',
    updatedBy: 'uid_admin',
  },
];

const sampleTasks: TaskItem[] = [
  {
    id: 'b1_test_parent',
    displayCode: 'T1',
    parentId: null,
    sortOrder: 0,
    title: 'Nhóm việc cha kiểm thử',
    categoryId: 'cat_foundation',
    category: 'Nền tảng & quy chuẩn',
    assignees: ['Quốc'],
    assigneeUids: ['uid_member'],
    approverUids: ['uid_approver'],
    status: 'Đang làm',
    nextStep: null,
    dueDate: null,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    reviewFlags: [],
    notes: null,
    archivedAt: null,
    archivedBy: null,
    isTestRecord: true,
  },
  {
    id: 'b1_test_unassigned',
    displayCode: 'T2',
    parentId: null,
    sortOrder: 1,
    title: 'Nhóm chỉ có tên text Quốc nhưng chưa gắn UID',
    categoryId: null,
    category: null,
    assignees: ['Quốc', 'Nhóm'],
    assigneeUids: [],
    status: 'Chưa bắt đầu',
    nextStep: null,
    dueDate: null,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    reviewFlags: [],
    notes: null,
    archivedAt: null,
    archivedBy: null,
    isTestRecord: true,
  },
  {
    id: 'b1_test_child_1',
    displayCode: 'T1.1',
    parentId: 'b1_test_parent',
    sortOrder: 2,
    title: 'Việc con kế thừa hạng mục từ T1',
    categoryId: null,
    category: null,
    assignees: ['Khả Tuệ'],
    assigneeUids: ['uid_other'],
    status: 'Chờ duyệt',
    nextStep: null,
    dueDate: null,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    reviewFlags: [],
    notes: null,
    archivedAt: null,
    archivedBy: null,
    isTestRecord: true,
  },
];

function evaluateSimulatedSubtaskCreate(
  actor: ProjectMember,
  parentTask: TaskItem | null,
  taskPayload: ReturnType<typeof buildCreateTaskPayloads>['taskPayload'],
  logPayload: ReturnType<typeof buildCreateTaskPayloads>['logPayload']
): { allowed: boolean; reason?: string } {
  if (!actor.isActive) return { allowed: false, reason: 'inactive_user' };
  if (actor.role === 'viewer') return { allowed: false, reason: 'viewer_readonly' };
  if (taskPayload.updatedByUid !== actor.uid) {
    return { allowed: false, reason: 'updatedByUid_mismatch' };
  }
  if (logPayload.actorUid !== actor.uid || logPayload.taskId !== taskPayload.id) {
    return { allowed: false, reason: 'activityLog_actor_or_task_mismatch' };
  }
  if (taskPayload.version !== 1 || taskPayload.archivedAt !== null) {
    return { allowed: false, reason: 'invalid_initial_version_or_archive' };
  }
  if (taskPayload.parentId === null) {
    return actor.role === 'admin' || actor.role === 'moderator'
      ? { allowed: true }
      : { allowed: false, reason: 'member_cannot_create_parent_task' };
  }
  if (!parentTask || parentTask.parentId !== null || parentTask.archivedAt !== null) {
    return { allowed: false, reason: 'invalid_parent_task' };
  }
  if (actor.role === 'admin' || actor.role === 'moderator') return { allowed: true };
  if (actor.role !== 'member') return { allowed: false, reason: 'not_member' };
  if (!parentTask.assigneeUids.includes(actor.uid)) {
    return { allowed: false, reason: 'member_uid_not_assigned_on_parent' };
  }
  if (taskPayload.status === 'Hoàn thành') {
    return { allowed: false, reason: 'member_cannot_create_completed' };
  }
  if (
    taskPayload.assigneeUids.length !== 1 ||
    taskPayload.assigneeUids[0] !== actor.uid
  ) {
    return { allowed: false, reason: 'member_must_assign_only_self_uid' };
  }
  return { allowed: true };
}

test('Live Firebase SDK: unauthenticated reads/writes are rejected by deployed rules on named database', async () => {
  const probeApp = initializeApp(firebaseConfig, `probe_${Date.now()}`);
  const probeDb = getFirestore(probeApp, firebaseConfig.firestoreDatabaseId);
  try {
    await assert.rejects(
      () => getDoc(doc(probeDb, 'tasks', 'b1_test_parent')),
      (err: unknown) => {
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        return code === 'permission-denied' || msg.toLowerCase().includes('permission');
      }
    );

    await assert.rejects(
      () =>
        setDoc(doc(probeDb, 'categories', 'cat_illegal_unauth'), {
          name: 'Unauthorized',
          color: '#000000',
          sortOrder: 99,
          isActive: true,
        }),
      (err: unknown) => {
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        return code === 'permission-denied' || msg.toLowerCase().includes('permission');
      }
    );
    await assert.rejects(
      () => getDoc(doc(probeDb, 'settings', 'auth')),
      (err: unknown) => {
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        return code === 'permission-denied' || msg.toLowerCase().includes('permission');
      }
    );

    await assert.rejects(
      () =>
        setDoc(doc(probeDb, 'settings', 'auth'), {
          allowOpenGoogleLogin: true,
        }),
      (err: unknown) => {
        const code = (err as { code?: string })?.code ?? '';
        const msg = err instanceof Error ? err.message : String(err);
        return code === 'permission-denied' || msg.toLowerCase().includes('permission');
      }
    );
  } finally {
    await terminate(probeDb);
    await deleteApp(probeApp);
  }
});

test('Firestore Rules use single-fetch let bindings, exists/get first for existing parent, UID-bound assignment, and locked open-login guardrails', () => {
  assert.match(rulesText, /function canCreateTask\(taskId\)/);
  assert.match(rulesText, /function canUpdateTask\(taskId\)/);
  assert.match(rulesText, /function canCreateActivityLog\(taskId, logId\)/);
  assert.match(rulesText, /exists\(pPath\)\s*\?\s*isParentValidForSubtask\(get\(pPath\)\.data/);
  assert.match(rulesText, /existsAfter\(pPath\)\s*&&\s*isParentValidForSubtask\(getAfter\(pPath\)\.data/);
  assert.match(rulesText, /data\.assigneeUids == \[request\.auth\.uid\]/);
  assert.match(rulesText, /function isAssignedToTask\(taskData\) \{\s*return request\.auth\.uid in taskData\.assigneeUids;\s*\}/);
  assert.equal(rulesText.includes("'Nhóm' in taskData.assignees"), false);

  // Open Google Login rules invariants
  assert.match(rulesText, /match \/settings\/\{docId\}/);
  assert.match(rulesText, /allow get: if isVerifiedUser\(\) && docId == 'auth';/);
  assert.match(rulesText, /allow create, update: if isAdmin\(\)\s*&& docId == 'auth'\s*&& isValidAuthSettings\(incoming\(\)\);/);
  assert.match(rulesText, /!hasInvite\s*&& isOpenGoogleLoginEnabled\(\)\s*&& data\.role == 'viewer'\s*&& data\.canApprove == false\s*&& data\.sheetAlias == ''/);
  assert.match(rulesText, /hasInvite\s*&& matchesActiveInvite\(data, iPath\)/);

  // Moderator rules invariants: can manage categories and all tasks, cannot mutate users/invites/settings
  assert.match(rulesText, /function isTaskManager\(\)/);
  assert.match(rulesText, /data\.role in \['admin', 'moderator', 'member', 'viewer'\]/);
  assert.match(rulesText, /match \/categories\/\{categoryId\}[\s\S]*allow create: if isTaskManager\(\)/);
  assert.match(rulesText, /match \/users\/\{uid\}[\s\S]*allow update: if isAdmin\(\)/);
  assert.match(rulesText, /match \/invites\/\{emailId\}[\s\S]*allow create: if isAdmin\(\)/);
});

test('Firestore Emulator: atomic task + activityLog create, update, comment, and RBAC boundaries', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('Run inside firebase emulators:exec to execute real Rules engine checks');
    return;
  }

  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: firebaseConfig.projectId,
    firestore: {
      rules: rulesText,
      host,
      port: Number(portStr),
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const edb = ctx.firestore();
      for (const u of [adminUser, moderatorUser, memberUser, scopedApproverMember, viewerUser]) {
        await setDoc(doc(edb, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          sheetAlias: u.sheetAlias,
          role: u.role,
          canApprove: u.canApprove,
          isActive: u.isActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await setDoc(doc(edb, 'tasks', 'b1_test_parent'), {
        id: 'b1_test_parent',
        displayCode: 'T1',
        parentId: null,
        sortOrder: 0,
        title: '[Kiểm thử B1] T1',
        categoryId: 'cat_foundation',
        category: 'Nền tảng & quy chuẩn',
        assignees: [memberUser.displayName],
        assigneeUids: [memberUser.uid],
        approverUids: [scopedApproverMember.uid],
        status: 'Đang làm',
        nextStep: null,
        dueDate: null,
        notes: null,
        referenceLinks: [],
        resultLinks: [],
        reviewFlags: [],
        version: 1,
        updatedAt: serverTimestamp(),
        updatedBy: adminUser.displayName,
        updatedByUid: adminUser.uid,
        archivedAt: null,
        archivedBy: null,
        isTestRecord: true,
      });
      await setDoc(doc(edb, 'tasks', 'b1_test_unassigned'), {
        id: 'b1_test_unassigned',
        displayCode: 'T2',
        parentId: null,
        sortOrder: 1,
        title: '[Kiểm thử B1] T2',
        categoryId: null,
        category: null,
        assignees: ['Quốc'],
        assigneeUids: [],
        status: 'Chưa bắt đầu',
        nextStep: null,
        dueDate: null,
        notes: null,
        referenceLinks: [],
        resultLinks: [],
        reviewFlags: ['missing_assignee'],
        version: 1,
        updatedAt: serverTimestamp(),
        updatedBy: adminUser.displayName,
        updatedByUid: adminUser.uid,
        archivedAt: null,
        archivedBy: null,
        isTestRecord: true,
      });
    });

    const memberDb = testEnv
      .authenticatedContext(memberUser.uid, {
        email: memberUser.email,
        email_verified: true,
      })
      .firestore();
    const viewerDb = testEnv
      .authenticatedContext(viewerUser.uid, {
        email: viewerUser.email,
        email_verified: true,
      })
      .firestore();

    // Assigned Member creates T1.2 + activityLog atomically
    const sub = buildCreateTaskPayloads(
      {
        displayCode: 'T1.2',
        title: 'Việc con kiểm thử của Member',
        parentId: 'b1_test_parent',
        categoryId: 'cat_foundation',
        category: 'Nền tảng & quy chuẩn',
        assignees: [memberUser.displayName],
        assigneeUids: [memberUser.uid],
        status: 'Chưa bắt đầu',
        nextStep: null,
        dueDate: null,
        sortOrder: 2,
      },
      memberUser,
      { taskId: 'test_task_emu_t12', logId: 'log_emu_t12' }
    );
    const batch = writeBatch(memberDb);
    batch.set(doc(memberDb, 'tasks', sub.taskId), sub.taskPayload);
    batch.set(
      doc(memberDb, 'tasks', sub.taskId, 'activityLogs', sub.logId),
      sub.logPayload
    );
    await assertSucceeds(batch.commit());

    // Member updates own T1.2 + activityLog via transaction
    await assertSucceeds(
      runTransaction(memberDb, async (tx) => {
        tx.update(doc(memberDb, 'tasks', sub.taskId), {
          status: 'Đang làm',
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: memberUser.displayName,
          updatedByUid: memberUser.uid,
        });
        tx.set(
          doc(memberDb, 'tasks', sub.taskId, 'activityLogs', 'log_emu_upd'),
          {
            id: 'log_emu_upd',
            taskId: sub.taskId,
            actorUid: memberUser.uid,
            actorName: memberUser.displayName,
            action: 'status_change',
            summary: 'Đổi trạng thái',
            createdAt: serverTimestamp(),
          }
        );
      })
    );

    // Member cannot create parent task, edit unassigned T2, or write orphan activityLog
    const parentAttempt = buildCreateTaskPayloads(
      {
        displayCode: 'T3',
        title: 'Illegal parent',
        parentId: null,
        categoryId: null,
        category: null,
        assignees: [memberUser.displayName],
        assigneeUids: [memberUser.uid],
        status: 'Chưa bắt đầu',
        nextStep: null,
        dueDate: null,
        sortOrder: 3,
      },
      memberUser,
      { taskId: 'test_task_bad_parent', logId: 'log_bad_parent' }
    );
    await assertFails(
      setDoc(doc(memberDb, 'tasks', parentAttempt.taskId), parentAttempt.taskPayload)
    );
    await assertFails(
      updateDoc(doc(memberDb, 'tasks', 'b1_test_unassigned'), {
        nextStep: 'hack',
        version: 2,
        updatedAt: serverTimestamp(),
        updatedByUid: memberUser.uid,
      })
    );
    await assertFails(
      setDoc(
        doc(memberDb, 'tasks', 'b1_test_parent', 'activityLogs', 'orphan_log'),
        {
          id: 'orphan_log',
          taskId: 'b1_test_parent',
          actorUid: memberUser.uid,
          actorName: memberUser.displayName,
          action: 'update',
          summary: 'Orphan log',
          createdAt: serverTimestamp(),
        }
      )
    );

    // Viewer cannot create, update, or delete
    await assertFails(
      setDoc(doc(viewerDb, 'tasks', 'viewer_illegal_create'), {
        id: 'viewer_illegal_create',
        displayCode: 'V1',
        parentId: null,
        sortOrder: 99,
        title: 'Viewer create',
        categoryId: null,
        category: null,
        assignees: [],
        assigneeUids: [],
        status: 'Chưa bắt đầu',
        nextStep: null,
        dueDate: null,
        notes: null,
        referenceLinks: [],
        resultLinks: [],
        reviewFlags: [],
        version: 1,
        updatedAt: serverTimestamp(),
        updatedBy: viewerUser.displayName,
        updatedByUid: viewerUser.uid,
        archivedAt: null,
        archivedBy: null,
        isTestRecord: true,
      })
    );
    await assertFails(
      updateDoc(doc(viewerDb, 'tasks', 'b1_test_parent'), {
        nextStep: 'viewer',
        version: 2,
        updatedAt: serverTimestamp(),
        updatedByUid: viewerUser.uid,
      })
    );

    // Stage B2.1 dry-run verification against unmodified firestore.rules in Emulator:
    // Admin can atomically write the 20 official tasks (isTestRecord: false, assigneeUids: []) + 20 logs
    // while keeping B1 test records (T1, T1.2, T2) untouched.
    const adminDb = testEnv
      .authenticatedContext(adminUser.uid, {
        email: adminUser.email,
        email_verified: true,
      })
      .firestore();

    const dataset = parseOfficialJsonDataset(officialJsonRaw);
    const fullCategories: CategoryItem[] = DEFAULT_TBHGN_CATEGORIES.map((c) => ({
      ...c,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: adminUser.uid,
      updatedBy: adminUser.uid,
    }));
    const plan = buildOfficialImportPlan(dataset, sampleTasks, fullCategories);
    assert.equal(plan.summary.readyToImportCount, 20);

    const officialBatch = writeBatch(adminDb);
    const batchTs = serverTimestamp();
    for (const item of plan.items) {
      const { taskId, logId, taskPayload, logPayload } =
        buildOfficialTaskFirestoreWritePayloads(
          item,
          adminUser,
          batchTs,
          'emu_b2'
        );
      officialBatch.set(doc(adminDb, 'tasks', taskId), taskPayload);
      officialBatch.set(
        doc(adminDb, 'tasks', taskId, 'activityLogs', logId),
        logPayload
      );
    }
    await assertSucceeds(officialBatch.commit());

    // Confirm B1 test tasks persisted untouched alongside official tasks
    const b1ParentSnap = await getDoc(doc(adminDb, 'tasks', 'b1_test_parent'));
    assert.equal(b1ParentSnap.exists(), true);
    assert.equal(b1ParentSnap.data()?.isTestRecord, true);

    const official5Snap = await getDoc(doc(adminDb, 'tasks', 'tbhgn_5'));
    assert.equal(official5Snap.exists(), true);
    assert.equal(official5Snap.data()?.isTestRecord, false);
    assert.equal(official5Snap.data()?.notes, 'Trạng thái gốc: Đang chỉnh sửa');
    assert.deepEqual(official5Snap.data()?.assigneeUids, []);

    const official45Snap = await getDoc(doc(adminDb, 'tasks', 'tbhgn_4_5'));
    assert.equal(official45Snap.exists(), true);
    assert.equal(official45Snap.data()?.status, null);

    // Stage B2.2 Readback verification against Firestore Emulator tasks collection
    const allDocsSnap = await getDocs(collection(adminDb, 'tasks'));
    const readbackTasks: TaskItem[] = allDocsSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        displayCode: String(data.displayCode ?? ''),
        parentId: typeof data.parentId === 'string' ? data.parentId : null,
        sortOrder: Number(data.sortOrder ?? 0),
        title: String(data.title ?? ''),
        categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
        category: (data.category as string | null) ?? null,
        assignees: Array.isArray(data.assignees) ? (data.assignees as string[]) : [],
        assigneeUids: Array.isArray(data.assigneeUids) ? (data.assigneeUids as string[]) : [],
        status: (data.status as TaskItem['status']) ?? null,
        nextStep: typeof data.nextStep === 'string' ? data.nextStep : null,
        dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
        updatedAt: null,
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
        version: Number(data.version ?? 1),
        referenceLinks: Array.isArray(data.referenceLinks) ? (data.referenceLinks as TaskItem['referenceLinks']) : [],
        resultLinks: Array.isArray(data.resultLinks) ? (data.resultLinks as TaskItem['resultLinks']) : [],
        reviewFlags: Array.isArray(data.reviewFlags) ? (data.reviewFlags as TaskItem['reviewFlags']) : [],
        notes: typeof data.notes === 'string' ? data.notes : null,
        archivedAt: null,
        archivedBy: null,
        isTestRecord: Boolean(data.isTestRecord),
      };
    });

    const verification = computeOfficialFirestoreVerification(
      readbackTasks,
      plan.items.map((i) => i.normalizedPayload.id)
    );
    assert.equal(verification.allChecksPassed, true);
    assert.equal(verification.officialCount, 20);
    assert.equal(verification.parentCount, 9);
    assert.equal(verification.childCount, 11);
    assert.deepEqual(verification.groupProgress, {
      tbhgn_3: { completed: 0, total: 2 },
      tbhgn_4: { completed: 0, total: 5 },
      tbhgn_5: { completed: 0, total: 4 },
    });
    assert.equal(verification.resultUrlCount, 13);
    assert.equal(verification.statusCounts.inProgress, 7);
    assert.equal(verification.statusCounts.pendingApproval, 2);
    assert.equal(verification.statusCounts.paused, 10);
    assert.equal(verification.statusCounts.unsetNull, 1);
    assert.equal(verification.nonEmptyAssigneeUidCount, 0);
    assert.equal(verification.wrongTestFlagCount, 0);
    assert.ok(verification.b1TestTaskCount >= 2);

    // Stage B2.2 Idempotency check: re-evaluating plan against server readback skips all 20
    const rerunPlan = buildOfficialImportPlan(dataset, readbackTasks, fullCategories);
    assert.equal(rerunPlan.summary.duplicateIdCount, 20);
    assert.equal(rerunPlan.summary.readyToImportCount, 0);
    assert.equal(rerunPlan.summary.readiness, 'already_imported');

    // Stage B2.3 Emulator check: Admin assigns temp UID -> swaps to official UID & revokes old UID
    // without losing task data, resultLinks, or prior activityLogs
    const tempUid = 'uid_temp_khanh';
    const officialUid = 'uid_official_khanh';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const edb = ctx.firestore();
      for (const [uid, email, name] of [
        [tempUid, 'filmfata02@gmail.com', 'Khánh (Tạm)'],
        [officialUid, 'khanh.official@gmail.com', 'Khánh (Chính thức)'],
      ]) {
        await setDoc(doc(edb, 'users', uid), {
          uid,
          email,
          displayName: name,
          sheetAlias: 'Khánh',
          role: 'member',
          canApprove: false,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    const tempDb = testEnv
      .authenticatedContext(tempUid, {
        email: 'filmfata02@gmail.com',
        email_verified: true,
      })
      .firestore();
    const officialDb = testEnv
      .authenticatedContext(officialUid, {
        email: 'khanh.official@gmail.com',
        email_verified: true,
      })
      .firestore();

    // 1. Assign temp UID to official task tbhgn_5
    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        tx.update(doc(adminDb, 'tasks', 'tbhgn_5'), {
          assigneeUids: [tempUid],
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: adminUser.displayName,
          updatedByUid: adminUser.uid,
        });
        tx.set(doc(adminDb, 'tasks', 'tbhgn_5', 'activityLogs', 'log_b23_assign_temp'), {
          id: 'log_b23_assign_temp',
          taskId: 'tbhgn_5',
          actorUid: adminUser.uid,
          actorName: adminUser.displayName,
          action: 'update',
          summary: 'Xác nhận liên kết 1 UID thực hiện',
          createdAt: serverTimestamp(),
        });
      })
    );

    // 2. Temp account can update while assigned
    await assertSucceeds(
      runTransaction(tempDb, async (tx) => {
        tx.update(doc(tempDb, 'tasks', 'tbhgn_5'), {
          nextStep: 'Temp member cập nhật bước tiếp theo',
          version: 3,
          updatedAt: serverTimestamp(),
          updatedBy: 'Khánh (Tạm)',
          updatedByUid: tempUid,
        });
        tx.set(doc(tempDb, 'tasks', 'tbhgn_5', 'activityLogs', 'log_b23_temp_edit'), {
          id: 'log_b23_temp_edit',
          taskId: 'tbhgn_5',
          actorUid: tempUid,
          actorName: 'Khánh (Tạm)',
          action: 'update',
          summary: 'Cập nhật bước tiếp theo',
          createdAt: serverTimestamp(),
        });
      })
    );

    // 3. Admin swaps to official UID and revokes old temp UID
    await assertSucceeds(
      runTransaction(adminDb, async (tx) => {
        tx.update(doc(adminDb, 'tasks', 'tbhgn_5'), {
          assigneeUids: [officialUid],
          version: 4,
          updatedAt: serverTimestamp(),
          updatedBy: adminUser.displayName,
          updatedByUid: adminUser.uid,
        });
        tx.set(doc(adminDb, 'tasks', 'tbhgn_5', 'activityLogs', 'log_b23_swap_official'), {
          id: 'log_b23_swap_official',
          taskId: 'tbhgn_5',
          actorUid: adminUser.uid,
          actorName: adminUser.displayName,
          action: 'update',
          summary: 'Đổi liên kết tài khoản UID (thu hồi 1 UID cũ, gán 1 UID mới)',
          createdAt: serverTimestamp(),
        });
      })
    );

    // 4. Old temp UID is immediately blocked; official UID can edit; history & task data preserved
    await assertFails(
      updateDoc(doc(tempDb, 'tasks', 'tbhgn_5'), {
        nextStep: 'Old UID stale write',
        version: 5,
        updatedAt: serverTimestamp(),
        updatedByUid: tempUid,
      })
    );
    await assertSucceeds(
      runTransaction(officialDb, async (tx) => {
        tx.update(doc(officialDb, 'tasks', 'tbhgn_5'), {
          nextStep: 'Official member tiếp quản mượt mà',
          version: 5,
          updatedAt: serverTimestamp(),
          updatedBy: 'Khánh (Chính thức)',
          updatedByUid: officialUid,
        });
        tx.set(doc(officialDb, 'tasks', 'tbhgn_5', 'activityLogs', 'log_b23_official_edit'), {
          id: 'log_b23_official_edit',
          taskId: 'tbhgn_5',
          actorUid: officialUid,
          actorName: 'Khánh (Chính thức)',
          action: 'update',
          summary: 'Cập nhật bước tiếp theo',
          createdAt: serverTimestamp(),
        });
      })
    );

    const swappedSnap = await getDoc(doc(adminDb, 'tasks', 'tbhgn_5'));
    assert.equal(swappedSnap.data()?.notes, 'Trạng thái gốc: Đang chỉnh sửa');
    assert.deepEqual(swappedSnap.data()?.assigneeUids, [officialUid]);
    const logsSnap = await getDocs(collection(adminDb, 'tasks', 'tbhgn_5', 'activityLogs'));
    assert.ok(logsSnap.docs.length >= 4);

    // Open Google Login Emulator tests (Cases 1-7)
    // Case 1 & 2: Non-admin cannot enable open login; uninvited user rejected when OFF
    await assertFails(
      setDoc(doc(memberDb, 'settings', 'auth'), {
        allowOpenGoogleLogin: true,
        updatedAt: serverTimestamp(),
        updatedBy: memberUser.uid,
      })
    );
    const strangerDb = testEnv
      .authenticatedContext('uid_stranger_1', {
        email: 'stranger1@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(strangerDb, 'users', 'uid_stranger_1'), {
        uid: 'uid_stranger_1',
        email: 'stranger1@gmail.com',
        displayName: 'Stranger 1',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Admin enables open login
    await assertSucceeds(
      setDoc(doc(adminDb, 'settings', 'auth'), {
        allowOpenGoogleLogin: true,
        updatedAt: serverTimestamp(),
        updatedBy: adminUser.uid,
      })
    );

    // Case 2: Stranger cannot self-escalate to member/admin, only viewer
    await assertFails(
      setDoc(doc(strangerDb, 'users', 'uid_stranger_1'), {
        uid: 'uid_stranger_1',
        email: 'stranger1@gmail.com',
        displayName: 'Stranger 1',
        sheetAlias: '',
        role: 'member',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(doc(strangerDb, 'users', 'uid_stranger_1'), {
        uid: 'uid_stranger_1',
        email: 'stranger1@gmail.com',
        displayName: 'Stranger 1',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Case 3: Locked user or locked invite cannot bypass lock when open login is ON
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const edb = ctx.firestore();
      await setDoc(doc(edb, 'users', 'uid_locked_user'), {
        uid: 'uid_locked_user',
        email: 'locked.user@gmail.com',
        displayName: 'Locked User',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(edb, 'invites', 'locked.invite@gmail.com'), {
        email: 'locked.invite@gmail.com',
        displayName: 'Locked Invite',
        sheetAlias: '',
        role: 'member',
        canApprove: false,
        isActive: false,
        createdBy: adminUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const lockedUserDb = testEnv
      .authenticatedContext('uid_locked_user', {
        email: 'locked.user@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(lockedUserDb, 'users', 'uid_locked_user'), {
        uid: 'uid_locked_user',
        email: 'locked.user@gmail.com',
        displayName: 'Locked User',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const lockedInviteDb = testEnv
      .authenticatedContext('uid_locked_inv', {
        email: 'locked.invite@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(lockedInviteDb, 'users', 'uid_locked_inv'), {
        uid: 'uid_locked_inv',
        email: 'locked.invite@gmail.com',
        displayName: 'Locked Invite',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Case 4: Admin disables open login; brand-new stranger2 fails, existing stranger1 still reads tasks
    await assertSucceeds(
      setDoc(doc(adminDb, 'settings', 'auth'), {
        allowOpenGoogleLogin: false,
        updatedAt: serverTimestamp(),
        updatedBy: adminUser.uid,
      })
    );
    const stranger2Db = testEnv
      .authenticatedContext('uid_stranger_2', {
        email: 'stranger2@gmail.com',
        email_verified: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(stranger2Db, 'users', 'uid_stranger_2'), {
        uid: 'uid_stranger_2',
        email: 'stranger2@gmail.com',
        displayName: 'Stranger 2',
        sheetAlias: '',
        role: 'viewer',
        canApprove: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(getDoc(doc(strangerDb, 'tasks', 'tbhgn_5')));

    // Case 9: Moderator Emulator tests — manages categories and all tasks, blocked from Admin-only collections
    const modDb = testEnv
      .authenticatedContext(moderatorUser.uid, {
        email: moderatorUser.email,
        email_verified: true,
      })
      .firestore();

    // Moderator creates & updates a category
    await assertSucceeds(
      setDoc(doc(modDb, 'categories', 'cat_mod_emu'), {
        name: 'Biên tập Moderator',
        color: '#274467',
        sortOrder: 4,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: moderatorUser.uid,
        updatedBy: moderatorUser.uid,
      })
    );
    await assertSucceeds(
      updateDoc(doc(modDb, 'categories', 'cat_mod_emu'), {
        name: 'Biên tập & Chế bản',
        updatedAt: serverTimestamp(),
        updatedBy: moderatorUser.uid,
      })
    );

    // Moderator creates parent task, edits another task, and approves Hoàn thành
    const modParent = buildCreateTaskPayloads(
      {
        displayCode: '10',
        title: 'Nhóm việc mới do Moderator tạo',
        parentId: null,
        categoryId: 'cat_mod_emu',
        category: 'Biên tập & Chế bản',
        assignees: ['Quốc'],
        assigneeUids: [memberUser.uid],
        status: 'Đang làm',
        nextStep: null,
        dueDate: null,
        sortOrder: 21,
      },
      moderatorUser,
      { taskId: 'mod_created_parent', logId: 'log_mod_parent', isTestRecord: false }
    );
    const modBatch = writeBatch(modDb);
    modBatch.set(doc(modDb, 'tasks', modParent.taskId), modParent.taskPayload);
    modBatch.set(
      doc(modDb, 'tasks', modParent.taskId, 'activityLogs', modParent.logId),
      modParent.logPayload
    );
    await assertSucceeds(modBatch.commit());

    await assertSucceeds(
      runTransaction(modDb, async (tx) => {
        tx.update(doc(modDb, 'tasks', 'mod_created_parent'), {
          status: 'Hoàn thành',
          version: 2,
          updatedAt: serverTimestamp(),
          updatedBy: moderatorUser.displayName,
          updatedByUid: moderatorUser.uid,
        });
        tx.set(
          doc(modDb, 'tasks', 'mod_created_parent', 'activityLogs', 'log_mod_approve'),
          {
            id: 'log_mod_approve',
            taskId: 'mod_created_parent',
            actorUid: moderatorUser.uid,
            actorName: moderatorUser.displayName,
            action: 'approve',
            summary: 'Phê duyệt Hoàn thành',
            createdAt: serverTimestamp(),
          }
        );
      })
    );

    // Moderator can list /users (for task assignment) but CANNOT modify /users, /invites, or /settings/auth
    await assertSucceeds(getDocs(collection(modDb, 'users')));
    await assertFails(
      updateDoc(doc(modDb, 'users', memberUser.uid), {
        role: 'admin',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(modDb, 'invites', 'mod_illegal@gmail.com'), {
        email: 'mod_illegal@gmail.com',
        displayName: 'Illegal',
        sheetAlias: '',
        role: 'member',
        canApprove: false,
        isActive: true,
        createdBy: moderatorUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(modDb, 'settings', 'auth'), {
        allowOpenGoogleLogin: true,
        updatedAt: serverTimestamp(),
        updatedBy: moderatorUser.uid,
      })
    );
  } finally {
    await testEnv.cleanup();
  }
});

test('Case 1: Assigned Member on T1 produces valid T1.2 + atomic activityLog payload matching Firestore Rules', () => {
  const parentT1 = sampleTasks[0];
  assert.equal(canUserCreateSubtaskInParent(memberUser, parentT1), true);

  const { taskId, logId, taskPayload, logPayload } = buildCreateTaskPayloads(
    {
      displayCode: 'T1.2',
      title: 'Việc con kiểm thử T1.2 của Member',
      parentId: parentT1.id,
      categoryId: parentT1.categoryId ?? null,
      category: parentT1.category ?? null,
      assignees: [memberUser.displayName],
      assigneeUids: [memberUser.uid],
      status: 'Chưa bắt đầu',
      nextStep: 'Cập nhật tiến độ',
      dueDate: null,
      sortOrder: 3,
    },
    memberUser
  );

  assert.match(taskId, /^[a-zA-Z0-9_\-]+$/);
  assert.match(logId, /^[a-zA-Z0-9_\-]+$/);
  assert.equal(taskPayload.id, taskId);
  assert.equal(taskPayload.parentId, 'b1_test_parent');
  assert.deepEqual(taskPayload.assigneeUids, ['uid_member']);
  assert.equal(taskPayload.updatedByUid, 'uid_member');
  assert.equal(taskPayload.version, 1);
  assert.equal(taskPayload.archivedAt, null);
  assert.equal(taskPayload.isTestRecord, true);
  assert.equal(logPayload.taskId, taskId);
  assert.equal(logPayload.actorUid, 'uid_member');
  assert.equal(logPayload.action, 'create');
  assert.equal(taskPayload.updatedAt, logPayload.createdAt);

  const check = evaluateSimulatedSubtaskCreate(
    memberUser,
    parentT1,
    taskPayload,
    logPayload
  );
  assert.deepEqual(check, { allowed: true });
});

test('Case 2: Member cannot create parent task, inject foreign assigneeUid, or edit/subtask unassigned T2', () => {
  const unassignedT2 = sampleTasks[1];
  const parentT1 = sampleTasks[0];

  assert.equal(canUserEditTask(memberUser, unassignedT2), false);
  assert.equal(canUserCreateSubtaskInParent(memberUser, unassignedT2), false);
  assert.equal(canUserApproveTask(memberUser, parentT1), false);

  const parentAttempt = buildCreateTaskPayloads(
    {
      displayCode: 'T3',
      title: 'Việc cha trái phép',
      parentId: null,
      categoryId: 'cat_foundation',
      category: 'Nền tảng & quy chuẩn',
      assignees: [memberUser.displayName],
      assigneeUids: [memberUser.uid],
      status: 'Chưa bắt đầu',
      nextStep: null,
      dueDate: null,
      sortOrder: 4,
    },
    memberUser
  );
  assert.equal(
    evaluateSimulatedSubtaskCreate(
      memberUser,
      null,
      parentAttempt.taskPayload,
      parentAttempt.logPayload
    ).allowed,
    false
  );

  const foreignUidAttempt = buildCreateTaskPayloads(
    {
      displayCode: 'T1.3',
      title: 'Gán UID người khác',
      parentId: parentT1.id,
      categoryId: parentT1.categoryId ?? null,
      category: parentT1.category ?? null,
      assignees: ['Admin'],
      assigneeUids: ['uid_admin'],
      status: 'Chưa bắt đầu',
      nextStep: null,
      dueDate: null,
      sortOrder: 5,
    },
    memberUser
  );
  assert.equal(
    evaluateSimulatedSubtaskCreate(
      memberUser,
      parentT1,
      foreignUidAttempt.taskPayload,
      foreignUidAttempt.logPayload
    ).allowed,
    false
  );
});

test('Case 3: Viewer cannot create or edit any task', () => {
  const parentT1 = sampleTasks[0];
  const unassignedT2 = sampleTasks[1];

  assert.equal(canUserCreateSubtask(viewerUser), false);
  assert.equal(canUserCreateSubtaskInParent(viewerUser, parentT1), false);
  assert.equal(canUserEditTask(viewerUser, parentT1), false);
  assert.equal(canUserEditTask(viewerUser, unassignedT2), false);
  assert.equal(canUserApproveTask(viewerUser, parentT1), false);
  assert.equal(canUserEditTask(lockedMember, parentT1), false);

  const viewerAttempt = buildCreateTaskPayloads(
    {
      displayCode: 'T1.4',
      title: 'Viewer tạo trái phép',
      parentId: parentT1.id,
      categoryId: parentT1.categoryId ?? null,
      category: parentT1.category ?? null,
      assignees: [viewerUser.displayName],
      assigneeUids: [viewerUser.uid],
      status: 'Chưa bắt đầu',
      nextStep: null,
      dueDate: null,
      sortOrder: 6,
    },
    viewerUser
  );
  assert.equal(
    evaluateSimulatedSubtaskCreate(
      viewerUser,
      parentT1,
      viewerAttempt.taskPayload,
      viewerAttempt.logPayload
    ).allowed,
    false
  );
});

test('Category inheritance by categoryId and 2-level hierarchy checks work accurately', () => {
  const child = sampleTasks[2];
  const eff = getEffectiveCategory(child, sampleTasks, sampleCategories);
  assert.equal(eff.categoryId, 'cat_foundation');
  assert.equal(eff.category, 'Nền tảng & quy chuẩn');
  assert.equal(eff.inherited, true);

  assert.equal(canBeParent('b1_test_parent', null, sampleTasks).ok, true);
  assert.equal(canBeParent('b1_test_child_1', null, sampleTasks).ok, false);
  assert.deepEqual(computeParentProgress('b1_test_parent', sampleTasks), {
    completed: 0,
    total: 1,
    percentage: 0,
  });
});

test('Stage B1 & B2.2 boundary: App.tsx never imports Stage A seed and ImportPreviewView never auto-imports on mount', () => {
  assert.equal(appText.includes('SEED_TASKS'), false);
  assert.equal(appText.includes('localStorage'), false);
  assert.equal(serviceText.includes('isTestRecord: true'), true);
  assert.equal(importPreviewText.includes('importOfficialTasksToFirestore'), false);
  assert.equal(appText.includes('onExecuteImport={handleExecuteOfficialImport}'), true);
});

test('Stage B2.1 official import plan preserves exact 20 tasks, 13 URLs, 7 flagged items, and conflict/duplicate detection', () => {
  const dataset = parseOfficialJsonDataset(officialJsonRaw);
  const fullCategories: CategoryItem[] = DEFAULT_TBHGN_CATEGORIES.map((c) => ({
    ...c,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: adminUser.uid,
    updatedBy: adminUser.uid,
  }));

  const { items, summary } = buildOfficialImportPlan(
    dataset,
    sampleTasks,
    fullCategories
  );

  assert.equal(summary.totalTasks, 20);
  assert.equal(summary.parentCount, 9);
  assert.equal(summary.childCount, 11);
  assert.deepEqual(summary.groupProgress, {
    tbhgn_3: { completed: 0, total: 2 },
    tbhgn_4: { completed: 0, total: 5 },
    tbhgn_5: { completed: 0, total: 4 },
  });
  assert.equal(summary.preservedResultUrlCount, 13);
  assert.equal(summary.statusCounts.inProgress, 7);
  assert.equal(summary.statusCounts.pendingApproval, 2);
  assert.equal(summary.statusCounts.paused, 10);
  assert.equal(summary.statusCounts.unsetNull, 1);
  assert.equal(summary.missingAssigneeTasks.length, 6);
  assert.equal(summary.missingStatusTasks.length, 1);
  assert.equal(summary.missingHyperlinkTasks.length, 0);
  assert.equal(summary.flaggedTasks.length, 7);
  assert.equal(summary.duplicateIdCount, 0);
  assert.equal(summary.codeConflictCount, 0);
  assert.equal(summary.readyToImportCount, 20);
  assert.equal(summary.existingTestRecordCount, 3);
  assert.equal(summary.missingRequiredCategories.length, 0);
  assert.equal(summary.readiness, 'ready');

  // Verify stripped non-rule fields & preserved fields
  const task5 = items.find((i) => i.normalizedPayload.id === 'tbhgn_5')!;
  assert.equal(task5.normalizedPayload.notes, 'Trạng thái gốc: Đang chỉnh sửa');
  assert.equal(task5.normalizedPayload.categoryId, 'cat_research');
  assert.equal(task5.normalizedPayload.isTestRecord, false);
  assert.deepEqual(task5.normalizedPayload.assigneeUids, []);

  const payloadCheck = buildOfficialTaskFirestoreWritePayloads(
    task5,
    adminUser,
    'TS',
    'test'
  );
  assert.equal('lastCheckedAt' in payloadCheck.taskPayload, false);
  assert.equal('migrationSourceRow' in payloadCheck.taskPayload, false);

  // Verify idempotent duplicate detection, code conflict detection, and preflight gate
  assert.equal(validateOfficialImportPreflight(items, summary).ok, true);

  const task1AsExisting: TaskItem = {
    ...sampleTasks[0],
    id: 'tbhgn_1',
    displayCode: '1',
    isTestRecord: false,
  };
  const codeConflictTask: TaskItem = {
    ...sampleTasks[0],
    id: 'custom_other_id',
    displayCode: '2',
    isTestRecord: true,
  };
  const conflictPlan = buildOfficialImportPlan(
    dataset,
    [task1AsExisting, codeConflictTask],
    fullCategories
  );
  assert.equal(conflictPlan.summary.duplicateIdCount, 1);
  assert.equal(conflictPlan.summary.codeConflictCount, 1);
  assert.equal(conflictPlan.summary.readyToImportCount, 18);
  assert.equal(conflictPlan.summary.readiness, 'has_conflicts');
  assert.equal(
    validateOfficialImportPreflight(conflictPlan.items, conflictPlan.summary).ok,
    false
  );

  // Verify missing category readiness gate
  const missingCatPlan = buildOfficialImportPlan(dataset, sampleTasks, []);
  assert.equal(missingCatPlan.summary.missingRequiredCategories.length, 3);
  assert.equal(missingCatPlan.summary.readiness, 'needs_categories');
  assert.equal(
    validateOfficialImportPreflight(missingCatPlan.items, missingCatPlan.summary).ok,
    false
  );
});

test('Stage B2.3 member mapping preview, temporary account guardrails, and safe UID toggle merger', () => {
  const dataset = parseOfficialJsonDataset(officialJsonRaw);
  const fullCategories: CategoryItem[] = DEFAULT_TBHGN_CATEGORIES.map((c) => ({
    ...c,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: adminUser.uid,
    updatedBy: adminUser.uid,
  }));
  const { items } = buildOfficialImportPlan(dataset, sampleTasks, fullCategories);
  const officialTasks: TaskItem[] = items.map((i) => ({
    ...i.normalizedPayload,
    updatedAt: null,
    updatedBy: null,
  }));

  const quocSignedIn: ProjectMember = {
    uid: 'uid_quoc_live',
    displayName: 'Quốc',
    email: 'tduyquoc@gmail.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Quốc',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const khanhInvitedOnly: MemberInvite = {
    email: 'khanhqn312@gmail.com',
    displayName: 'Khánh',
    sheetAlias: 'Khánh',
    role: 'member',
    canApprove: false,
    isActive: true,
    createdBy: adminUser.uid,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Temporary account defaults never grant admin or canApprove
  for (const acc of EXPECTED_TBHGN_ACCOUNTS) {
    const safe = getSafeInviteDefaults(acc);
    assert.equal(safe.role, 'member');
    assert.equal(safe.canApprove, false);
    if (acc.email.startsWith('filmfata')) {
      assert.equal(isTemporaryAccountEmail(acc.email), true);
    } else {
      assert.equal(isTemporaryAccountEmail(acc.email), false);
    }
  }

  const unpairedAdmin: ProjectMember = {
    ...adminUser,
    email: 'admin.other@example.com',
    displayName: 'Quản trị viên',
    sheetAlias: '',
  };

  const preview = buildMemberMappingPreview(
    EXPECTED_TBHGN_ACCOUNTS,
    [unpairedAdmin, quocSignedIn],
    [khanhInvitedOnly],
    [...sampleTasks, ...officialTasks]
  );

  // Focuses on the 20 official tasks when present, never auto-assigns UIDs
  assert.equal(preview.scopeTaskCount, 20);
  assert.equal(preview.tasksUnlinkedUidCount, 20);
  assert.equal(preview.signedInExpectedCount, 1);
  assert.equal(preview.invitedPendingExpectedCount, 1);
  assert.equal(preview.temporaryExpectedCount, 1);
  assert.equal(EXPECTED_TBHGN_ACCOUNTS.length, 6);
  assert.deepEqual(preview.collectiveGroupTaskCodes, ['1', '5']);
  assert.equal(
    preview.aliasRows.some((r) => r.alias === COLLECTIVE_GROUP_LABEL),
    false
  );

  // Account with similar Google displayName ("Sư phụ") and unconfirmed sheetAlias MUST NEVER auto-match "Sư Phụ"
  const adminLookalike: ProjectMember = {
    ...adminUser,
    email: 'admin.lookalike@example.com',
    displayName: 'Sư phụ',
    sheetAlias: '',
  };
  const suPhuSpec = EXPECTED_TBHGN_ACCOUNTS.find(
    (a) => a.email === 'ngaothuyet2023@gmail.com'
  )!;
  assert.equal(suPhuSpec.originalName, 'Sư Phụ');
  assert.equal(suPhuSpec.displayName, 'Sư Phụ');
  assert.equal(formatStandardMemberLabel(suPhuSpec), 'Sư Phụ');
  assert.equal(
    doesTaskMatchExpectedAccount({ assignees: ['Sư Minh Hạnh'] }, suPhuSpec),
    true
  );
  assert.equal(
    doesTaskMatchExpectedAccount({ assignees: ['Sư Phụ'] }, suPhuSpec),
    true
  );
  assert.equal(
    doesMemberMatchProjectPerson(adminLookalike, suPhuSpec),
    false
  );
  const lookalikePreview = buildMemberMappingPreview(
    EXPECTED_TBHGN_ACCOUNTS,
    [adminLookalike, quocSignedIn],
    [],
    officialTasks
  );
  const suPhuLookalikeRow = lookalikePreview.accountRows.find(
    (r) => r.account.email === 'ngaothuyet2023@gmail.com'
  )!;
  assert.equal(suPhuLookalikeRow.matchedMember, null);
  assert.equal(suPhuLookalikeRow.signInStatus, 'not_invited');

  // Admin pairing a signed-in user to "Khả Tuệ" (Tuấn) works without changing task originalName
  const pairedTuan: ProjectMember = {
    uid: 'uid_tuan_gmail',
    displayName: 'Nguyễn Văn Tuấn',
    email: 'tuan.personal@gmail.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Khả Tuệ',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const khaTueSpec = EXPECTED_TBHGN_ACCOUNTS.find(
    (a) => a.originalName === 'Khả Tuệ'
  )!;
  assert.equal(doesMemberMatchProjectPerson(pairedTuan, khaTueSpec), true);

  const quocRow = preview.accountRows.find(
    (r) => r.account.email === 'tduyquoc@gmail.com'
  )!;
  assert.equal(quocRow.signInStatus, 'signed_in');
  assert.equal(quocRow.linkedTaskCodes.length, 0);
  assert.ok(quocRow.readyToConfirmCount > 0);

  const suPhuRow = preview.accountRows.find(
    (r) => r.account.email === 'ngaothuyet2023@gmail.com'
  )!;
  assert.equal(suPhuRow.signInStatus, 'not_invited');
  assert.equal(suPhuRow.hasPrivilegeWarning, false);

  // Alias rows keep uninvited/temporary aliases in "Chưa liên kết tài khoản"
  const quocAlias = preview.aliasRows.find((r) => r.alias === 'Quốc')!;
  assert.equal(quocAlias.linkStatus, 'ready_to_link');
  const myAlias = preview.aliasRows.find((r) => r.alias === 'Mỵ')!;
  assert.equal(myAlias.linkStatus, 'unlinked');
  assert.equal(myAlias.statusLabel, 'Chưa liên kết tài khoản');

  // Verify temporary privilege warning triggers if someone manually gave temp account admin/approve
  const escalatedPreview = buildMemberMappingPreview(
    EXPECTED_TBHGN_ACCOUNTS,
    [
      {
        uid: 'uid_bad_temp',
        displayName: 'Tuấn',
        email: 'filmfata03@gmail.com',
        role: 'admin',
        canApprove: true,
        isActive: true,
        sheetAlias: 'Khả Tuệ',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    [],
    officialTasks
  );
  const escalatedTemp = escalatedPreview.accountRows.find(
    (r) => r.account.email === 'filmfata03@gmail.com'
  )!;
  assert.equal(escalatedTemp.hasPrivilegeWarning, true);

  // Verify TaskDetailDrawer UID toggle preserves unrelated Sheet aliases & "Chưa liên kết tài khoản"
  const merged1 = computeUpdatedAssigneeNamesOnUidToggle(
    'Quốc, Khả Tuệ',
    quocSignedIn,
    [quocSignedIn.uid],
    [quocSignedIn]
  );
  assert.equal(merged1, 'Quốc, Khả Tuệ');

  // Revoking the last UID keeps human name for "Chưa liên kết tài khoản"
  const tempKhanh: ProjectMember = {
    uid: 'uid_temp_khanh',
    displayName: 'Khánh (Tạm)',
    email: 'filmfata02@gmail.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Khánh',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const officialKhanh: ProjectMember = {
    uid: 'uid_official_khanh',
    displayName: 'Khánh (Chính thức)',
    email: 'khanh@tbhgn.vn',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Khánh',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  assert.equal(
    computeUpdatedAssigneeNamesOnUidToggle(
      'Khánh',
      tempKhanh,
      [],
      [tempKhanh, officialKhanh]
    ),
    'Khánh'
  );
  // Swapping temp UID -> official UID keeps shared alias "Khánh"
  assert.equal(
    computeUpdatedAssigneeNamesOnUidToggle(
      'Khánh',
      tempKhanh,
      [officialKhanh.uid],
      [tempKhanh, officialKhanh]
    ),
    'Khánh'
  );
});

test('Case 7: B1 test tasks are strictly hidden from normal counts, parent totals (9/11/20), and CSV export', () => {
  const dataset = parseOfficialJsonDataset(officialJsonRaw);
  const fullCategories: CategoryItem[] = DEFAULT_TBHGN_CATEGORIES.map((c) => ({
    ...c,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: adminUser.uid,
    updatedBy: adminUser.uid,
  }));
  const { items } = buildOfficialImportPlan(dataset, sampleTasks, fullCategories);
  const officialTasks: TaskItem[] = items.map((i) => ({
    ...i.normalizedPayload,
    updatedAt: null,
    updatedBy: null,
  }));
  const legacyB1Doc: TaskItem = {
    ...sampleTasks[1],
    id: 'test_task_legacy_abc',
    displayCode: 'T1.2',
    parentId: 'b1_test_parent',
    isTestRecord: false,
  };

  const mixedTasks = [...sampleTasks, legacyB1Doc, ...officialTasks];
  const visibleTasks = mixedTasks.filter((t) => !t.archivedAt && !isB1TestTask(t));

  assert.equal(visibleTasks.length, 20);
  assert.equal(visibleTasks.filter((t) => t.parentId === null).length, 9);
  assert.equal(visibleTasks.filter((t) => t.parentId !== null).length, 11);

  const csv = exportTasksToCSV(mixedTasks, fullCategories);
  assert.equal(csv.includes('b1_test_parent'), false);
  assert.equal(csv.includes('b1_test_unassigned'), false);
  assert.equal(csv.includes('test_task_legacy_abc'), false);
  assert.equal(csv.includes('tbhgn_1'), true);
  assert.equal(csv.includes('tbhgn_5_4'), true);

  // Regular tasks created through UI use isTestRecord: false so they are NOT hidden
  const normalNewTask = buildCreateTaskPayloads(
    {
      displayCode: '10',
      title: 'Công việc mới chính thức',
      parentId: null,
      categoryId: 'cat_outline',
      category: 'Đề cương',
      assignees: ['Quốc'],
      assigneeUids: ['uid_quoc'],
      status: 'Chưa bắt đầu',
      nextStep: null,
      dueDate: null,
      sortOrder: 21,
    },
    adminUser,
    { taskId: 'task_new_10', isTestRecord: false }
  );
  assert.equal(isB1TestTask({ id: normalNewTask.taskId, isTestRecord: normalNewTask.taskPayload.isTestRecord }), false);
});

test('Case 8: Pre-release safety audit, explicit two-step assignment, and draft preservation on save failure', () => {
  // 1. Raw project JSON/CSV must NOT be exposed publicly under public/assets
  assert.equal(
    fs.existsSync(
      path.join(
        rootDir,
        'public/assets/aistudio/TBHGN_du_lieu_20_cong_viec_da_khoi_phuc_URL_38662941.json'
      )
    ),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(
        rootDir,
        'public/assets/aistudio/UPGRADE_TBHTGN_Danh_muc_cong_viec_du_an_6eb9e9c3'
      )
    ),
    false
  );
  assert.equal(
    serverText.includes("app.get('/api/admin/official-import-source'"),
    true
  );
  assert.equal(serverText.includes('verifyFirebaseIdToken(token)'), true);
  assert.equal(
    serverText.includes("userDoc.fields?.role?.stringValue === 'admin'"),
    true
  );

  assert.equal(serverText.includes("'/server_data'"), true);
  const viteConfigText = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  assert.equal(viteConfigText.includes("'**/server_data/**'"), true);

  // 2. Full JSON backup export in App.tsx is restricted to active Admin
  assert.match(
    appText,
    /\{isAdmin\s*&&\s*\(\s*<button[\s\S]{0,120}onClick=\{handleExportJSON\}/
  );
  assert.equal(
    appText.includes("if (!currentUser || currentUser.role !== 'admin' || !currentUser.isActive)"),
    true
  );

  // 3. Explicit two-step task assignment helper preserves original assignee names & clears missing_assignee
  const targetTasks: TaskItem[] = [
    {
      ...sampleTasks[0],
      id: 'tbhgn_2',
      displayCode: '2',
      assignees: ['Quốc', 'Khả Tuệ'],
      assigneeUids: [],
      reviewFlags: ['missing_assignee'],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 'tbhgn_3',
      displayCode: '3',
      assignees: ['Quốc'],
      assigneeUids: [memberUser.uid],
      reviewFlags: [],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 'b1_test_parent',
      displayCode: 'T1',
      assignees: ['Quốc'],
      assigneeUids: [],
      reviewFlags: ['missing_assignee'],
      isTestRecord: true,
    },
  ];
  const updates = buildConfirmedAssignmentUpdates(
    memberUser,
    ['tbhgn_2', 'tbhgn_3', 'b1_test_parent'],
    targetTasks
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].taskId, 'tbhgn_2');
  assert.deepEqual(updates[0].nextAssigneeUids, [memberUser.uid]);
  assert.deepEqual(updates[0].nextReviewFlags, []);

  // 4. Draft preservation on failure & completed-task status lock for non-approvers
  assert.match(myTasksText, /if\s*\(res\.ok\)\s*\{\s*setEditingNextStepId\(null\);/);
  assert.match(drawerText, /if\s*\(res\.ok\)\s*\{\s*setCommentText\(''\);/);
  assert.equal(myTasksText.includes('statusLockedForNonApprover'), true);
  assert.equal(drawerText.includes('statusLockedByCompletion'), true);
});

test('Case 9: Sư Phụ label simplification, AdminSettingsView separation from MembersView, and Moderator RBAC', () => {
  // 1. "Sư Minh Hạnh (Sư Phụ)" removed from memberMapping display
  assert.equal(memberMappingText.includes('Sư Minh Hạnh (Sư Phụ)'), false);

  // 2. Admin settings & import separated out of MembersView into AdminSettingsView
  assert.equal(membersViewText.includes('allowOpenGoogleLogin'), false);
  assert.equal(membersViewText.includes('categoriesPanel'), false);
  assert.equal(membersViewText.includes('importPanel'), false);
  assert.equal(adminSettingsViewText.includes('Cài đặt quản trị'), true);
  assert.equal(adminSettingsViewText.includes('allowOpenGoogleLogin'), true);
  assert.equal(appText.includes("route === 'admin-settings'"), true);
  assert.equal(appText.includes("route === 'categories'"), true);
  assert.equal(categoriesViewText.includes("currentUser.role === 'moderator'"), true);

  // 3. Moderator permissions in helpers
  const parentT1 = sampleTasks[0];
  const unassignedT2 = sampleTasks[1];
  assert.equal(isTaskManagerRole(moderatorUser), true);
  assert.equal(isTaskManagerRole(memberUser), false);
  assert.equal(canUserEditTask(moderatorUser, unassignedT2), true);
  assert.equal(canUserCreateSubtask(moderatorUser), true);
  assert.equal(canUserCreateSubtaskInParent(moderatorUser, parentT1), true);
  assert.equal(canUserCreateSubtaskInParent(moderatorUser, unassignedT2), true);
  assert.equal(canUserApproveTask(moderatorUser, unassignedT2), true);

  const modParent = buildCreateTaskPayloads(
    {
      displayCode: '10',
      title: 'Đầu việc cha của Moderator',
      parentId: null,
      categoryId: 'cat_outline',
      category: 'Đề cương',
      assignees: ['Quốc'],
      assigneeUids: [memberUser.uid],
      status: 'Đang làm',
      nextStep: null,
      dueDate: null,
      sortOrder: 21,
    },
    moderatorUser,
    { taskId: 'task_mod_parent', isTestRecord: false }
  );
  assert.deepEqual(
    evaluateSimulatedSubtaskCreate(
      moderatorUser,
      null,
      modParent.taskPayload,
      modParent.logPayload
    ),
    { allowed: true }
  );
});

test('Case 10: Single official Project Display Name source, standardized task assignee resolution, CSV export, and UI source guards', () => {
  const renamedSuTin: ProjectMember = {
    uid: 'uid_su_tin',
    displayName: 'Sư Tín (Mới)',
    email: 'linhgiangtu1991@gmail.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Sư Pháp Tín',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const lockedTuan: ProjectMember = {
    uid: 'uid_tuan_locked',
    displayName: 'Tuấn',
    email: 'filmfata03@gmail.com',
    role: 'member',
    canApprove: false,
    isActive: false,
    sheetAlias: 'Khả Tuệ',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const projectMembers: ProjectMember[] = [
    memberUser,
    renamedSuTin,
    lockedTuan,
  ];

  // 1. Admin rename on /users/{uid}.displayName overrides any static alias/email lookup
  assert.equal(getOfficialMemberDisplayName(renamedSuTin), 'Sư Tín (Mới)');

  // 2. Linked UID resolves to official displayName (never spreadsheet alias "Sư Pháp Tín")
  const linkedRes = resolveTaskAssignees(
    { assignees: ['Sư Pháp Tín'], assigneeUids: ['uid_su_tin'] },
    projectMembers
  );
  assert.equal(linkedRes.displayText, 'Sư Tín (Mới)');
  assert.equal(linkedRes.displayText.includes('Sư Pháp Tín'), false);

  // 3. Collective "Nhóm" renders distinctly as "Việc nhóm"
  const collectiveLinked = resolveTaskAssignees(
    { assignees: ['Quốc', 'Nhóm'], assigneeUids: ['uid_member'] },
    projectMembers
  );
  assert.equal(collectiveLinked.isCollectiveGroup, true);
  assert.equal(collectiveLinked.displayText, 'Quốc, Việc nhóm');

  const collectiveUnlinked = resolveTaskAssignees(
    { assignees: ['Nhóm'], assigneeUids: [] },
    projectMembers
  );
  assert.equal(collectiveUnlinked.isCollectiveGroup, true);
  assert.equal(collectiveUnlinked.isUnlinkedAccount, false);
  assert.equal(collectiveUnlinked.displayText, 'Việc nhóm');

  // 4. Unlinked legacy personal aliases never leak spreadsheet names ("Khả Tuệ", "Sư Pháp Tín")
  const unlinkedRes = resolveTaskAssignees(
    { assignees: ['Khả Tuệ', 'Sư Pháp Tín'], assigneeUids: [] },
    projectMembers
  );
  assert.equal(unlinkedRes.isUnlinkedAccount, true);
  assert.equal(unlinkedRes.displayText, 'Chưa liên kết tài khoản');
  assert.equal(unlinkedRes.displayText.includes('Khả Tuệ'), false);
  assert.equal(unlinkedRes.searchText.includes('Khả Tuệ'), false);

  // 5. Empty assignees & assigneeUids -> "Chưa phân công"
  const emptyRes = resolveTaskAssignees(
    { assignees: [], assigneeUids: [] },
    projectMembers
  );
  assert.equal(emptyRes.isUnassigned, true);
  assert.equal(emptyRes.displayText, 'Chưa phân công');

  // 6. Locked member UID -> "Tên (Đã khóa)"; unknown UID -> "Tài khoản không xác định" (never raw UID)
  const lockedRes = resolveTaskAssignees(
    { assignees: ['Khả Tuệ'], assigneeUids: ['uid_tuan_locked'] },
    projectMembers
  );
  assert.equal(lockedRes.displayText, 'Tuấn (Đã khóa)');

  const unknownRes = resolveTaskAssignees(
    { assignees: [], assigneeUids: ['raw_secret_uid_999'] },
    projectMembers
  );
  assert.equal(unknownRes.displayText, 'Tài khoản không xác định');
  assert.equal(unknownRes.displayText.includes('raw_secret_uid_999'), false);

  // 7. CSV export uses resolved official displayName & hides spreadsheet personal aliases
  const csvTasks: TaskItem[] = [
    {
      ...sampleTasks[0],
      id: 'tbhgn_csv_1',
      displayCode: '1',
      assignees: ['Sư Pháp Tín'],
      assigneeUids: ['uid_su_tin'],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 'tbhgn_csv_2',
      displayCode: '2',
      assignees: ['Khả Tuệ'],
      assigneeUids: [],
      isTestRecord: false,
    },
  ];
  const csvOut = exportTasksToCSV(csvTasks, sampleCategories, projectMembers);
  assert.equal(csvOut.includes('Sư Tín (Mới)'), true);
  assert.equal(csvOut.includes('Chưa liên kết tài khoản'), true);
  assert.equal(csvOut.includes('Sư Pháp Tín'), false);
  assert.equal(csvOut.includes('Khả Tuệ'), false);

  // 8. Source guards across components
  const tasksViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );
  const newTaskModalText = fs.readFileSync(
    path.join(rootDir, 'src/components/NewTaskModal.tsx'),
    'utf8'
  );
  const overviewText = fs.readFileSync(
    path.join(rootDir, 'src/components/OverviewView.tsx'),
    'utf8'
  );

  for (const [name, src] of [
    ['TasksView', tasksViewText],
    ['TaskDetailDrawer', drawerText],
    ['OverviewView', overviewText],
    ['MyTasksView', myTasksText],
  ] as const) {
    assert.equal(
      src.includes('resolveTaskAssignees') ||
        (name === 'MyTasksView' && src.includes('getMyWorkCoAssigneesInfo')),
      true,
      `${name} must use resolveTaskAssignees`
    );
    assert.equal(
      src.includes('task.assignees.join'),
      false,
      `${name} must not render raw task.assignees.join`
    );
  }

  assert.equal(drawerText.includes('task-assignees-text'), false);
  assert.equal(drawerText.includes('assigneesText'), false);
  assert.equal(newTaskModalText.includes('customAssigneeNote'), false);
  assert.equal(membersViewText.includes('Đổi tên hiển thị'), true);
});

test('Case 11: Reference vs Result link helpers, validation, duplicate detection, and UI source guards', () => {
  // 1. Display label normalization (preserves custom names, neutralizes generic legacy placeholders)
  assert.equal(isGenericDocumentLabel('Mở tài liệu'), true);
  assert.equal(isGenericDocumentLabel('  tài liệu  '), true);
  assert.equal(isGenericDocumentLabel(''), true);
  assert.equal(isGenericDocumentLabel('Bản thảo chương 3'), false);

  assert.deepEqual(getDocumentDisplayLabel({ label: 'Mở tài liệu' }), {
    text: 'Tài liệu chưa đặt tên',
    isPlaceholder: true,
  });
  assert.deepEqual(
    getDocumentDisplayLabel({ label: 'Kinh Kim Cang đối chiếu' }),
    {
      text: 'Kinh Kim Cang đối chiếu',
      isPlaceholder: false,
    }
  );

  // 2. Source label detection
  assert.equal(
    getDocumentSourceLabel('https://docs.google.com/document/d/abc123/edit'),
    'Google Docs'
  );
  assert.equal(
    getDocumentSourceLabel('https://docs.google.com/spreadsheets/d/xyz/edit'),
    'Google Sheets'
  );
  assert.equal(
    getDocumentSourceLabel('https://docs.google.com/presentation/d/p1/edit'),
    'Google Slides'
  );
  assert.equal(
    getDocumentSourceLabel('https://docs.google.com/forms/d/f1/viewform'),
    'Google Forms'
  );
  assert.equal(
    getDocumentSourceLabel('https://drive.google.com/drive/folders/123'),
    'Google Drive'
  );
  assert.equal(
    getDocumentSourceLabel('https://www.buddhistlibrary.org/texts/1'),
    'buddhistlibrary.org'
  );
  assert.equal(getDocumentSourceLabel(null), 'Chưa gắn đường dẫn');

  // 3. URL validation (http/https only)
  assert.deepEqual(
    validateHttpUrl('  https://drive.google.com/file/d/123/view  '),
    {
      ok: true,
      normalizedUrl: 'https://drive.google.com/file/d/123/view',
    }
  );
  assert.equal(validateHttpUrl('').ok, false);
  assert.equal(validateHttpUrl('javascript:alert(1)').ok, false);
  assert.equal(validateHttpUrl('ftp://example.com/file.pdf').ok, false);
  assert.equal(validateHttpUrl('not-a-valid-url').ok, false);

  // 4. Duplicate URL detection strictly within same group
  const groupLinks = [
    {
      id: 'lnk_1',
      label: 'Tài liệu 1',
      url: 'https://drive.google.com/file/d/abc/view',
      type: 'reference' as const,
    },
  ];
  assert.equal(
    hasDuplicateUrlInGroup(
      groupLinks,
      'HTTPS://Drive.Google.com/file/d/abc/view'
    ),
    true
  );
  assert.equal(
    hasDuplicateUrlInGroup(
      groupLinks,
      'https://drive.google.com/file/d/abc/view',
      'lnk_1'
    ),
    false
  );
  assert.equal(
    hasDuplicateUrlInGroup(
      groupLinks,
      'https://drive.google.com/file/d/different/view'
    ),
    false
  );

  // 5. UI source guards for clear Input/Output separation and zero generic fallback strings
  const tasksViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );

  assert.equal(drawerText.includes('Tài liệu cần đọc / tham khảo'), true);
  assert.equal(
    drawerText.includes('Nguồn tài liệu để thực hiện công việc'),
    true
  );
  assert.equal(drawerText.includes('Kết quả nghiên cứu'), true);
  assert.equal(
    drawerText.includes('Bản thảo, báo cáo và sản phẩm đã tạo ra'),
    true
  );
  assert.equal(drawerText.includes('Chuyển sang Kết quả'), true);
  assert.equal(drawerText.includes('Chuyển sang Tham khảo'), true);

  for (const [name, src] of [
    ['TaskDetailDrawer', drawerText],
    ['TasksView', tasksViewText],
    ['MyTasksView', myTasksText],
  ] as const) {
    assert.equal(
      src.includes('Tài liệu KQ'),
      false,
      `${name} must not display "Tài liệu KQ"`
    );
    assert.equal(
      src.includes('Mở tài liệu'),
      false,
      `${name} must not display "Mở tài liệu"`
    );
    assert.equal(
      src.includes('Kết quả hiện tại'),
      false,
      `${name} must not display "Kết quả hiện tại"`
    );
  }

  assert.equal(tasksViewText.includes('tham khảo'), true);
  assert.equal(tasksViewText.includes('kết quả'), true);
  assert.equal(myTasksText.includes('tham khảo'), true);
  assert.equal(myTasksText.includes('kết quả'), true);

  // 6. Official 20 seed tasks & 13 preserved resultLinks URLs remain untouched
  assert.equal(SEED_TASKS.length, 20);
  const preservedResultUrls = SEED_TASKS.reduce(
    (sum, t) => sum + t.resultLinks.filter((l) => Boolean(l.url)).length,
    0
  );
  assert.equal(preservedResultUrls, 13);
});

test('Case 12: Project Documents Center aggregation, review/duplicate classification, immutable link patches, RBAC, and UI guards', () => {
  const baseTask = sampleTasks[0];
  const sharedDuplicateUrl = 'https://docs.google.com/document/d/shared_doc_1/edit';

  const docMembers: ProjectMember[] = [
    adminUser,
    moderatorUser,
    memberUser,
    viewerUser,
  ];

  const t1: TaskItem = {
    ...baseTask,
    id: 'doc_t1',
    displayCode: '1',
    title: 'Đầu việc 1',
    parentId: null,
    sortOrder: 1,
    categoryId: 'cat_foundation',
    category: 'Nền tảng & quy chuẩn',
    assignees: ['Legacy Sheet Name'],
    assigneeUids: [memberUser.uid],
    referenceLinks: [
      {
        id: 'ref_1',
        label: 'Kinh đối chiếu bản Hán',
        url: 'https://buddhist.org/han-text',
        type: 'reference',
      },
      {
        id: 'ref_2_bad',
        label: 'Mở tài liệu',
        url: null,
        type: 'reference',
      },
    ],
    resultLinks: [
      {
        id: 'res_1',
        label: 'Bản thảo chương 1',
        url: sharedDuplicateUrl,
        type: 'result',
      },
    ],
    archivedAt: null,
    isTestRecord: false,
  };

  const t2: TaskItem = {
    ...baseTask,
    id: 'doc_t2',
    displayCode: '2',
    title: 'Đầu việc 2',
    parentId: null,
    sortOrder: 2,
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: [],
    assigneeUids: [],
    referenceLinks: [
      {
        id: 'ref_3_dup',
        label: 'Bản thảo chương 1 (tham chiếu lại)',
        url: 'HTTPS://Docs.Google.com/document/d/shared_doc_1/edit',
        type: 'reference',
      },
    ],
    resultLinks: [
      {
        id: 'res_2_invalid',
        label: 'Liên kết lỗi giao thức',
        url: 'javascript:alert(1)',
        type: 'result',
      },
    ],
    archivedAt: null,
    isTestRecord: false,
  };

  const archivedTask: TaskItem = {
    ...t1,
    id: 'doc_archived',
    displayCode: '99',
    sortOrder: 3,
    archivedAt: '2026-01-01T00:00:00.000Z',
    referenceLinks: [
      {
        id: 'arch_ref',
        label: 'Không được gộp',
        url: 'https://example.com/archived',
        type: 'reference',
      },
    ],
    resultLinks: [],
  };

  const b1Task: TaskItem = {
    ...t1,
    id: 'b1_test_hidden',
    displayCode: 'T1',
    sortOrder: 4,
    isTestRecord: true,
    referenceLinks: [
      {
        id: 'b1_ref',
        label: 'Bản ghi test B1 không được gộp',
        url: 'https://example.com/b1',
        type: 'reference',
      },
    ],
    resultLinks: [],
  };

  // 1. Aggregation excludes archived and B1 test records, preserves order and official display names
  const summary = buildProjectDocumentEntries(
    [t2, archivedTask, b1Task, t1],
    sampleCategories,
    docMembers
  );
  assert.equal(summary.totalLinks, 5);
  assert.equal(summary.referenceCount, 3);
  assert.equal(summary.resultCount, 2);
  assert.equal(summary.reviewNeededCount, 2); // ref_2_bad (missing_label + missing_url) and res_2_invalid (invalid_url)
  assert.equal(summary.validUrlLinkCount, 3); // ref_1, res_1, ref_3_dup
  assert.equal(summary.uniqueValidUrlCount, 2); // han-text + shared_doc_1
  assert.equal(summary.duplicateEntryCount, 2); // res_1 + ref_3_dup
  assert.equal(summary.duplicateCrossTaskUrlCount, 1);

  assert.equal(summary.entries[0].taskId, 'doc_t1');
  assert.equal(summary.entries[0].assigneeNamesText, memberUser.displayName);
  assert.equal(summary.entries[0].officialAssigneeText, memberUser.displayName);
  assert.equal(summary.entries[0].assigneeStatusKind, 'named');
  assert.equal(summary.entries[0].neutralAssigneeHint, null);
  assert.equal(summary.entries[0].assigneeSearchText.includes('Legacy Sheet Name'), false);

  const unassignedDocEntry = summary.entries.find((e) => e.taskId === 'doc_t2');
  assert.ok(unassignedDocEntry);
  assert.equal(unassignedDocEntry.officialAssigneeText, null);
  assert.equal(unassignedDocEntry.assigneeStatusKind, 'unassigned');
  assert.equal(unassignedDocEntry.neutralAssigneeHint, 'Chưa phân công');

  const unknownUidTask: TaskItem = {
    ...t2,
    id: 'doc_unknown_uid',
    displayCode: '3',
    sortOrder: 5,
    assigneeUids: ['uid_not_in_directory'],
    referenceLinks: [],
    resultLinks: [
      {
        id: 'res_unknown_1',
        label: 'Bản thảo 3',
        url: 'https://example.com/res3',
        type: 'result',
      },
    ],
  };
  const unknownSummary = buildProjectDocumentEntries(
    [unknownUidTask],
    sampleCategories,
    docMembers
  );
  assert.equal(unknownSummary.entries[0].officialAssigneeText, null);
  assert.equal(unknownSummary.entries[0].assigneeStatusKind, 'unknown_account');
  assert.equal(unknownSummary.entries[0].neutralAssigneeHint, 'TK chưa xác định');

  // 2. Review classification accuracy
  const missingEntry = summary.entries.find((e) => e.linkId === 'ref_2_bad');
  assert.ok(missingEntry);
  assert.equal(missingEntry.needsReview, true);
  assert.deepEqual(missingEntry.reviewReasons, ['missing_label', 'missing_url']);

  const invalidEntry = summary.entries.find((e) => e.linkId === 'res_2_invalid');
  assert.ok(invalidEntry);
  assert.equal(invalidEntry.needsReview, true);
  assert.deepEqual(invalidEntry.reviewReasons, ['invalid_url']);

  const cleanEntry = summary.entries.find((e) => e.linkId === 'ref_1');
  assert.ok(cleanEntry);
  assert.equal(cleanEntry.needsReview, false);
  assert.equal(cleanEntry.taskPendingApproval, false);
  assert.equal(cleanEntry.taskNeedsReview, false);
  assert.equal(cleanEntry.needsAttention, false);
  assert.deepEqual(cleanEntry.reviewReasons, []);

  // 2b. Task-level pending approval ('Chờ duyệt') & task review flags ('reviewFlags' / status null) surface under Cần rà soát
  const pendingApprovalTask: TaskItem = {
    ...t1,
    id: 'doc_pending_approval',
    displayCode: '5.2',
    status: 'Chờ duyệt',
    reviewFlags: [],
    referenceLinks: [],
    resultLinks: [
      {
        id: 'res_pending',
        label: 'Bản nháp chờ Sư phụ duyệt',
        url: 'https://docs.google.com/document/d/pending_doc/edit',
        type: 'result',
      },
    ],
  };
  const taskReviewFlagTask: TaskItem = {
    ...t1,
    id: 'doc_task_flagged',
    displayCode: '3.1',
    status: 'Tạm dừng',
    reviewFlags: ['missing_assignee'],
    referenceLinks: [],
    resultLinks: [
      {
        id: 'res_flagged',
        label: 'Danh sách tác giả',
        url: 'https://docs.google.com/spreadsheets/d/flagged_sheet/edit',
        type: 'result',
      },
    ],
  };
  const attentionSummary = buildProjectDocumentEntries(
    [pendingApprovalTask, taskReviewFlagTask],
    sampleCategories,
    docMembers
  );
  assert.equal(attentionSummary.reviewNeededCount, 0);
  assert.equal(attentionSummary.attentionNeededCount, 2);
  assert.equal(attentionSummary.entries[0].taskPendingApproval, true);
  assert.equal(attentionSummary.entries[0].needsAttention, true);
  assert.equal(attentionSummary.entries[1].taskNeedsReview, true);
  assert.equal(attentionSummary.entries[1].needsAttention, true);

  // 3. Duplicate URLs across tasks are flagged for visibility, never auto-merged or deleted
  const dupRes = summary.entries.find((e) => e.linkId === 'res_1');
  const dupRef = summary.entries.find((e) => e.linkId === 'ref_3_dup');
  assert.ok(dupRes && dupRef);
  assert.equal(dupRes.duplicateOccurrences.length, 1);
  assert.equal(dupRes.duplicateOccurrences[0].taskId, 'doc_t2');
  assert.equal(dupRef.duplicateOccurrences.length, 1);
  assert.equal(dupRef.duplicateOccurrences[0].taskId, 'doc_t1');

  // 4. Immutable patch builders preserve siblings, handle group move, enforce limit & existence checks
  const addedRes = buildTaskLinkAddPatch(t1, 'reference', {
    id: 'ref_added',
    label: 'Tài liệu bổ sung',
    url: 'https://drive.google.com/file/d/added/view',
    type: 'reference',
  });
  assert.equal(addedRes.ok, true);
  if (addedRes.ok) {
    assert.equal(addedRes.patch.referenceLinks?.length, 3);
    assert.equal(addedRes.patch.referenceLinks?.[0].id, 'ref_1');
    assert.equal(addedRes.patch.referenceLinks?.[2].id, 'ref_added');
    assert.equal(addedRes.patch.resultLinks, undefined); // Sibling group untouched in patch
  }

  const movedRes = buildTaskLinkUpdatePatch(t1, 'result', 'res_1', {
    label: 'Chuyển sang tham khảo',
    url: sharedDuplicateUrl,
    toGroup: 'reference',
  });
  assert.equal(movedRes.ok, true);
  if (movedRes.ok) {
    assert.equal(movedRes.patch.resultLinks?.length, 0);
    assert.equal(movedRes.patch.referenceLinks?.length, 3);
    const movedItem = movedRes.patch.referenceLinks?.find((l) => l.id === 'res_1');
    assert.ok(movedItem);
    assert.equal(movedItem.type, 'reference');
    assert.equal(movedItem.label, 'Chuyển sang tham khảo');
  }

  const removedRes = buildTaskLinkRemovePatch(t1, 'reference', 'ref_2_bad');
  assert.equal(removedRes.ok, true);
  if (removedRes.ok) {
    assert.equal(removedRes.patch.referenceLinks?.length, 1);
    assert.equal(removedRes.patch.referenceLinks?.[0].id, 'ref_1');
  }

  const missingRemove = buildTaskLinkRemovePatch(t1, 'reference', 'non_existent');
  assert.equal(missingRemove.ok, false);

  const maxedLinks: DocumentLink[] = Array.from(
    { length: MAX_LINKS_PER_GROUP },
    (_, i) => ({
      id: `max_${i}`,
      label: `Link ${i}`,
      url: `https://example.com/${i}`,
      type: 'reference',
    })
  );
  const maxTask: TaskItem = { ...t1, referenceLinks: maxedLinks };
  const overLimit = buildTaskLinkAddPatch(maxTask, 'reference', {
    id: 'extra',
    label: 'Extra',
    url: 'https://example.com/extra',
    type: 'reference',
  });
  assert.equal(overLimit.ok, false);

  // 5. RBAC editability matches task permissions
  assert.equal(canUserEditTask(viewerUser, t1), false);
  assert.equal(canUserEditTask(viewerUser, t2), false);
  assert.equal(canUserEditTask(memberUser, t1), true);
  assert.equal(canUserEditTask(memberUser, t2), false);
  assert.equal(canUserEditTask(moderatorUser, t2), true);
  assert.equal(canUserEditTask(adminUser, t2), true);

  // 6. Seed tasks baseline integrity (20 tasks, 13 preserved URLs)
  const seedDocs = buildProjectDocumentEntries(
    SEED_TASKS,
    sampleCategories,
    []
  );
  assert.equal(seedDocs.validUrlLinkCount, 13);

  // 7. Source & Navigation contracts (including V1.1 UI polish & smart reference guidance)
  const appText = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const docsViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/DocumentsView.tsx'),
    'utf8'
  );
  const tasksViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );

  assert.equal(appText.includes("id: 'documents'"), true);
  assert.equal(appText.includes("label: 'Tài liệu dự án'"), true);
  assert.equal(appText.includes('<DocumentsView'), true);
  assert.equal(appText.includes('onNavigateToDocuments'), true);
  assert.equal(appText.includes("label: 'Thư viện'"), false);
  assert.equal(appText.includes('mobileMoreItems'), true);
  assert.equal(appText.includes('Thêm'), true);

  assert.equal(tasksViewText.includes('onNavigateToDocuments'), true);
  assert.equal(tasksViewText.includes('Tài liệu dự án'), true);

  assert.equal(docsViewText.includes('buildProjectDocumentEntries'), true);
  assert.equal(docsViewText.includes('canUserEditTask'), true);
  assert.equal(docsViewText.includes('onSaveTask'), true);
  assert.equal(docsViewText.includes('onSelectTask'), true);
  assert.equal(docsViewText.includes('assigneeNamesText'), true);
  assert.equal(docsViewText.includes('officialAssigneeText'), true);
  assert.equal(docsViewText.includes('neutralAssigneeHint'), true);
  assert.equal(docsViewText.includes('openedVersion'), true);
  assert.equal(docsViewText.includes('Tải bản mới nhất'), true);
  assert.equal(docsViewText.includes('if (res.ok)'), true);
  assert.equal(docsViewText.includes('Mở liên kết'), true);
  assert.equal(
    docsViewText.includes('Chưa có tài liệu tham khảo. Bạn có thể thêm nguồn cần đọc cho'),
    true
  );
  assert.equal(docsViewText.includes('Thêm tài liệu tham khảo'), true);
  assert.equal(docsViewText.includes('DOCUMENT_LIST_GRID_COLS'), true);
  assert.equal(docsViewText.includes('196px'), true);
  assert.equal(docsViewText.includes('1.15fr)_auto'), false);
  assert.equal(docsViewText.includes('even:bg-'), false);
  assert.equal(docsViewText.includes('border-l-4'), false);
  assert.equal(docsViewText.includes('border-l-2'), false);
  assert.equal(docsViewText.includes("useState<ViewMode>('list')"), true);
  assert.equal(docsViewText.includes('md:grid-cols-2'), true);
  assert.equal(docsViewText.includes('getDocumentKindInfo'), true);
  assert.equal(docsViewText.includes('MoreHorizontal'), true);
  assert.equal(docsViewText.includes('Chế độ hiển thị tài liệu'), true);
  assert.equal(docsViewText.includes('entry.needsAttention'), true);
  assert.equal(docsViewText.includes('summary.attentionNeededCount'), true);
  assert.equal(docsViewText.includes('Công việc chờ duyệt'), true);
});

test('Case 13: Task Visual System V2.0 separates Category, 5 Statuses + Thiếu trạng thái, and deduplicated Data Review warnings', () => {
  // 1. 5 canonical workflow statuses retain exact palette & labels; null maps strictly to "Thiếu trạng thái"
  assert.equal(STATUS_META['Đang làm'].bg, '#BDD7EE');
  assert.equal(STATUS_META['Chờ duyệt'].bg, '#FFE699');
  assert.equal(STATUS_META['Tạm dừng'].bg, '#FFC7CE');
  assert.equal(STATUS_META['Hoàn thành'].bg, '#A9D08E');
  assert.equal(STATUS_META['Chưa bắt đầu'].bg, '#EDEDED');
  assert.equal(UNSET_STATUS_META.label, 'Thiếu trạng thái');
  assert.equal(getStatusMeta(null).label, 'Thiếu trạng thái');
  assert.equal(getStatusMeta('Chờ duyệt').label, 'Chờ duyệt');

  // 2. Normal task produces zero warnings
  const normalSummary = getTaskDataReviewSummary({
    status: 'Đang làm',
    reviewFlags: [],
  });
  assert.equal(normalSummary.isMissingStatus, false);
  assert.deepEqual(normalSummary.dataFlags, []);
  assert.equal(normalSummary.hasAnyIssue, false);

  // 3. status === null + ['missing_status'] does NOT duplicate a second "Cần rà soát dữ liệu" warning
  const missingStatusOnlySummary = getTaskDataReviewSummary({
    status: null,
    reviewFlags: ['missing_status'],
  });
  assert.equal(missingStatusOnlySummary.isMissingStatus, true);
  assert.deepEqual(missingStatusOnlySummary.dataFlags, []);
  assert.equal(missingStatusOnlySummary.hasAnyIssue, true);

  // 4. status === null + multiple flags excludes 'missing_status' while consolidating remaining issues
  const nullPlusMultipleFlags = getTaskDataReviewSummary({
    status: null,
    reviewFlags: ['missing_status', 'missing_assignee', 'missing_hyperlink_url', 'missing_assignee'],
  });
  assert.equal(nullPlusMultipleFlags.isMissingStatus, true);
  assert.deepEqual(nullPlusMultipleFlags.dataFlags, [
    'missing_assignee',
    'missing_hyperlink_url',
  ]);
  assert.equal(nullPlusMultipleFlags.dataFlagLabels.length, 2);

  // 5. "Chờ duyệt" + reviewFlags stays cleanly separated: status = Chờ duyệt, dataFlags = missing_assignee
  const pendingApprovalWithFlag = getTaskDataReviewSummary({
    status: 'Chờ duyệt',
    reviewFlags: ['missing_assignee'],
  });
  assert.equal(pendingApprovalWithFlag.isMissingStatus, false);
  assert.deepEqual(pendingApprovalWithFlag.dataFlags, ['missing_assignee']);
  assert.equal(pendingApprovalWithFlag.hasAnyIssue, true);

  // 6. Category visual themes never reuse the 5 status background colors
  const statusBgs = new Set(Object.values(STATUS_META).map((m) => m.bg.toUpperCase()));
  const catThemes = [
    getCategoryVisualTheme('cat_outline', 'Đề cương'),
    getCategoryVisualTheme('cat_foundation', 'Nền tảng & quy chuẩn'),
    getCategoryVisualTheme('cat_research', 'Truy nguồn & nghiên cứu'),
    getCategoryVisualTheme(null, 'Chưa phân hạng mục'),
  ];
  for (const theme of catThemes) {
    assert.equal(statusBgs.has(theme.softBg.toUpperCase()), false);
    assert.equal(statusBgs.has(theme.accent.toUpperCase()), false);
  }

  // 7. Parent/Child category inheritance check
  const parentCat = getEffectiveCategory(SEED_TASKS[5], SEED_TASKS, sampleCategories); // task 4
  const childInherited = getEffectiveCategory(SEED_TASKS[6], SEED_TASKS, sampleCategories); // task 4.1 inherits 4
  assert.equal(parentCat.inherited, false);
  assert.equal(childInherited.inherited, true);
  assert.equal(childInherited.category, parentCat.category);

  // 8. Component contracts across StatusBadge, CategoryChip, ReviewBadge, TasksView, TaskDetailDrawer, MyTasksView
  const statusBadgeText = fs.readFileSync(
    path.join(rootDir, 'src/components/StatusBadge.tsx'),
    'utf8'
  );
  const categoryChipText = fs.readFileSync(
    path.join(rootDir, 'src/components/CategoryChip.tsx'),
    'utf8'
  );
  const reviewBadgeText = fs.readFileSync(
    path.join(rootDir, 'src/components/ReviewBadge.tsx'),
    'utf8'
  );
  const tasksViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );
  const drawerText = fs.readFileSync(
    path.join(rootDir, 'src/components/TaskDetailDrawer.tsx'),
    'utf8'
  );
  const myTasksText = fs.readFileSync(
    path.join(rootDir, 'src/components/MyTasksView.tsx'),
    'utf8'
  );

  for (const icon of [
    'PlayCircle',
    'Clock3',
    'PauseCircle',
    'CheckCircle2',
    'CircleDashed',
    'AlertTriangle',
  ]) {
    assert.equal(statusBadgeText.includes(icon), true, `StatusBadge missing ${icon}`);
  }
  assert.equal(statusBadgeText.includes('border-dashed'), true);

  assert.equal(categoryChipText.includes('Folder'), true);
  assert.equal(categoryChipText.includes('getCategoryVisualTheme'), true);

  assert.equal(reviewBadgeText.includes('AlertCircle'), true);
  assert.equal(reviewBadgeText.includes('Cần rà soát dữ liệu'), true);
  assert.equal(reviewBadgeText.includes('getTaskDataReviewSummary'), true);

  assert.equal(tasksViewText.includes('<CategoryChip'), true);
  assert.equal(tasksViewText.includes('<ReviewBadge'), true);
  assert.equal(tasksViewText.includes('hasDistinctChildCategory'), true);
  assert.equal(tasksViewText.includes('getTaskDataReviewSummary'), true);
  assert.equal(tasksViewText.includes('TT: Thiếu trạng thái'), true);

  assert.equal(drawerText.includes('<CategoryChip'), true);
  assert.equal(drawerText.includes('<ReviewBadge'), true);
  assert.equal(drawerText.includes('getTaskDataReviewSummary'), true);

  assert.equal(myTasksText.includes('<StatusBadge status={task.status}'), true);
  assert.equal(myTasksText.includes('<CategoryChip'), true);
  assert.equal(myTasksText.includes('<ReviewBadge task={task} />'), true);
});

test('Case 14: My Work Dashboard V2.0 partitions personal vs group tasks, evaluates real attention signals, sorts deterministically, and preserves UI contracts', () => {
  const refToday = new Date('2026-11-18T12:00:00.000Z');
  const memberA: ProjectMember = {
    uid: 'uid_quoc',
    displayName: 'Quốc',
    email: 'quoc@example.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Quốc',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const approverMod: ProjectMember = {
    uid: 'uid_sutinh',
    displayName: 'Sư Tín',
    email: 'sutin@example.com',
    role: 'moderator',
    canApprove: true,
    isActive: true,
    sheetAlias: 'Sư Tín',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const memberIdle: ProjectMember = {
    uid: 'uid_no_tasks',
    displayName: 'Tuấn',
    email: 'tuan@example.com',
    role: 'member',
    canApprove: false,
    isActive: true,
    sheetAlias: 'Khả Tuệ',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const baseTask: TaskItem = {
    id: 't_base',
    displayCode: '1',
    parentId: null,
    sortOrder: 0,
    title: 'Mẫu',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: ['Quốc'],
    assigneeUids: [memberA.uid],
    status: 'Đang làm',
    nextStep: 'Hoàn thiện đề cương',
    dueDate: '2026-11-25',
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
    isTestRecord: false,
  };

  const myTasksPool: TaskItem[] = [
    // 1. Direct task + Collective "Nhóm" (must NOT double count in group section!)
    {
      ...baseTask,
      id: 't_1',
      displayCode: '1',
      assignees: ['Quốc', 'Nhóm'],
      assigneeUids: [memberA.uid],
      status: 'Đang làm',
      nextStep: 'Rà soát mục lục',
      dueDate: '2026-11-30',
    },
    // 2. Direct task overdue + missing nextStep while Đang làm
    {
      ...baseTask,
      id: 't_2',
      displayCode: '3.1',
      assigneeUids: [memberA.uid],
      status: 'Đang làm',
      nextStep: null,
      dueDate: '2026-11-10',
    },
    // 3. Direct task Chờ duyệt (attention only for approver, not plain member)
    {
      ...baseTask,
      id: 't_3',
      displayCode: '5.2',
      assigneeUids: [memberA.uid, approverMod.uid],
      status: 'Chờ duyệt',
      nextStep: 'Chờ duyệt lần cuối',
      dueDate: null,
    },
    // 4. Direct task with null status + reviewFlag
    {
      ...baseTask,
      id: 't_4',
      displayCode: '4.5',
      assigneeUids: [memberA.uid, 'uid_unknown_ghost'],
      status: null,
      nextStep: 'Bổ sung trạng thái',
      reviewFlags: ['missing_status'],
      dueDate: null,
    },
    // 5. Collective-only group task (not assigned to memberA.uid)
    {
      ...baseTask,
      id: 't_group_only',
      displayCode: '5',
      assignees: ['Nhóm'],
      assigneeUids: [],
      status: 'Tạm dừng',
    },
    // 6. Archived & B1 test tasks (strictly excluded)
    {
      ...baseTask,
      id: 't_arch',
      displayCode: '9.1',
      assigneeUids: [memberA.uid],
      archivedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      ...baseTask,
      id: 'b1_test_hidden',
      displayCode: 'T1',
      assigneeUids: [memberA.uid],
      isTestRecord: true,
    },
  ];

  // 1 & 3. Member with 4 direct tasks + non-overlapping collective group section
  const partitionedMember = partitionMyWorkTasks(myTasksPool, memberA.uid);
  assert.equal(partitionedMember.directTasks.length, 4);
  assert.equal(partitionedMember.collectiveOnlyTasks.length, 1);
  assert.equal(partitionedMember.collectiveOnlyTasks[0].id, 't_group_only');

  // 2. User with 0 direct tasks sees both collective "Nhóm" tasks (t_1 + t_group_only)
  const partitionedIdle = partitionMyWorkTasks(myTasksPool, memberIdle.uid);
  assert.equal(partitionedIdle.directTasks.length, 0);
  assert.equal(partitionedIdle.collectiveOnlyTasks.length, 2);

  // 4 & 6. Data-driven attention evaluation (overdue, missing nextStep, missing status, approver role on Chờ duyệt)
  const attNormal = evaluateMyWorkAttention(myTasksPool[0], memberA, refToday);
  assert.equal(attNormal.needsAttention, false);

  const attOverdueMissingStep = evaluateMyWorkAttention(myTasksPool[1], memberA, refToday);
  assert.equal(attOverdueMissingStep.needsAttention, true);
  assert.equal(attOverdueMissingStep.isOverdue, true);
  assert.equal(attOverdueMissingStep.missingNextStep, true);

  const attPendingForMember = evaluateMyWorkAttention(myTasksPool[2], memberA, refToday);
  assert.equal(attPendingForMember.pendingApprovalAction, false);
  const attPendingForMod = evaluateMyWorkAttention(myTasksPool[2], approverMod, refToday);
  assert.equal(attPendingForMod.pendingApprovalAction, true);
  assert.equal(attPendingForMod.needsAttention, true);

  const attNullStatus = evaluateMyWorkAttention(myTasksPool[3], memberA, refToday);
  assert.equal(attNullStatus.hasDataIssue, true);
  assert.equal(attNullStatus.needsAttention, true);

  // 7. Co-assignee & neutral unknown UID resolution without repeating own name
  const singleOwnerCoInfo = getMyWorkCoAssigneesInfo(myTasksPool[0], memberA.uid, [
    memberA,
    approverMod,
  ]);
  assert.deepEqual(singleOwnerCoInfo.coAssigneeNames, []);
  assert.equal(singleOwnerCoInfo.unknownUidCount, 0);

  const sharedTaskCoInfo = getMyWorkCoAssigneesInfo(myTasksPool[2], memberA.uid, [
    memberA,
    approverMod,
  ]);
  assert.deepEqual(sharedTaskCoInfo.coAssigneeNames, ['Sư Tín']);

  const ghostUidCoInfo = getMyWorkCoAssigneesInfo(myTasksPool[3], memberA.uid, [
    memberA,
  ]);
  assert.equal(ghostUidCoInfo.unknownUidCount, 1);

  // 8. Deterministic sorting: priority puts attention tasks + earliest due date first
  const sortedByPriority = [...partitionedMember.directTasks].sort((a, b) =>
    compareTasksForMyWork(a, b, 'priority', memberA, refToday)
  );
  assert.equal(sortedByPriority[0].id, 't_2'); // needsAttention + earliest dueDate
  assert.equal(sortedByPriority[1].id, 't_4'); // needsAttention (null status)
  assert.equal(sortedByPriority[sortedByPriority.length - 1].id, 't_3'); // no attention + null dueDate

  const sortedByCode = [...partitionedMember.directTasks].sort((a, b) =>
    compareTasksForMyWork(a, b, 'code', memberA, refToday)
  );
  assert.deepEqual(
    sortedByCode.map((t) => t.displayCode),
    ['1', '3.1', '4.5', '5.2']
  );

  // 9. MyTasksView V2.0 structural & UI contracts
  const freshMyTasksText = fs.readFileSync(
    path.join(rootDir, 'src/components/MyTasksView.tsx'),
    'utf8'
  );
  assert.equal(freshMyTasksText.includes('from-[#14243F]'), true);
  assert.equal(freshMyTasksText.includes('getOfficialMemberDisplayName(currentUser)'), true);
  assert.equal(freshMyTasksText.includes('currentUser.email'), false);
  assert.equal(freshMyTasksText.includes('partitionMyWorkTasks'), true);
  assert.equal(freshMyTasksText.includes('evaluateMyWorkAttention'), true);
  assert.equal(freshMyTasksText.includes('compareTasksForMyWork'), true);
  assert.equal(freshMyTasksText.includes('getMyWorkCoAssigneesInfo'), true);
  assert.equal(freshMyTasksText.includes('Đã lưu:'), true);
  assert.equal(freshMyTasksText.includes('Đang chọn:'), true);
  assert.equal(freshMyTasksText.includes('Lưu trạng thái'), true);
  assert.equal(freshMyTasksText.includes('Cần quyền duyệt'), false); // uses clean Vietnamese sentence
  assert.equal(freshMyTasksText.includes('Đã duyệt · cần quyền duyệt để đổi'), true);
  assert.equal(freshMyTasksText.includes('Việc chung của nhóm ('), true);
  assert.equal(freshMyTasksText.includes('tài khoản chưa đối chiếu'), true);
  assert.equal(freshMyTasksText.includes('border-l-4'), false);
  assert.equal(freshMyTasksText.includes('border-l-2'), false);
});

test('Case 15: Member Directory official assignee visibility across Admin/Member/Viewer, PII isolation, rename/locked sync, and non-silent error handling', () => {
  // 1. Canonical project members as seen by Admin (/users) vs Member/Viewer (/memberDirectory minimal non-PII)
  const adminUsersList: ProjectMember[] = [
    {
      uid: 'uid_quoc',
      displayName: 'Quốc',
      email: 'tduyquoc@gmail.com',
      role: 'admin',
      canApprove: true,
      isActive: true,
      sheetAlias: 'Quốc',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'uid_khanh',
      displayName: 'Khánh',
      email: 'khanh@tbhgn.vn',
      role: 'member',
      canApprove: false,
      isActive: true,
      sheetAlias: 'Khánh',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'uid_my',
      displayName: 'Mỵ',
      email: 'my@tbhgn.vn',
      role: 'member',
      canApprove: false,
      isActive: true,
      sheetAlias: 'Mỵ',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'uid_sutin',
      displayName: 'Sư Tín',
      email: 'linhgiangtu1991@gmail.com',
      role: 'moderator',
      canApprove: true,
      isActive: true,
      sheetAlias: 'Sư Pháp Tín',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'uid_suphu',
      displayName: 'Sư Phụ',
      email: 'ngaothuyet2023@gmail.com',
      role: 'member',
      canApprove: true,
      isActive: true,
      sheetAlias: 'Sư Phụ',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      uid: 'uid_tuan_locked',
      displayName: 'Tuấn',
      email: 'tuan.old@gmail.com',
      role: 'member',
      canApprove: false,
      isActive: false,
      sheetAlias: 'Khả Tuệ',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  // Simulate minimal non-PII `/memberDirectory` projection received by Member A (Khánh) and Viewer
  const toMinimalDirectoryFor = (self: ProjectMember): ProjectMember[] =>
    adminUsersList.map((u) =>
      u.uid === self.uid
        ? self
        : {
            uid: u.uid,
            displayName: u.displayName,
            email: '',
            role: 'member',
            canApprove: false,
            isActive: u.isActive,
            sheetAlias: '',
            createdAt: '',
          }
    );

  const memberA = adminUsersList[1]; // Khánh (member)
  const viewerAccount: ProjectMember = {
    uid: 'uid_viewer_1',
    displayName: 'Khách xem',
    email: 'viewer@tbhgn.vn',
    role: 'viewer',
    canApprove: false,
    isActive: true,
    sheetAlias: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const memberDirectoryForKhanh = toMinimalDirectoryFor(memberA);
  const memberDirectoryForViewer = [viewerAccount, ...toMinimalDirectoryFor(viewerAccount)];

  // Ensure zero PII leakage in non-self directory entries
  for (const entry of memberDirectoryForKhanh) {
    if (entry.uid !== memberA.uid) {
      assert.equal(entry.email, '');
      assert.equal(entry.canApprove, false);
      assert.equal(entry.sheetAlias, '');
    }
  }

  const sharedTasks: TaskItem[] = [
    {
      ...sampleTasks[0],
      id: 't_my',
      displayCode: '1',
      title: 'Biên tập chương 1',
      assignees: ['Mỵ', 'Sư Pháp Tín'],
      assigneeUids: ['uid_my', 'uid_sutin'],
      referenceLinks: [
        {
          id: 'ref_my_1',
          label: 'Tài liệu gốc chương 1',
          url: 'https://docs.google.com/document/d/ch1/edit',
          type: 'reference',
        },
      ],
      resultLinks: [],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 't_multi',
      displayCode: '2',
      title: 'Rà soát toàn bộ',
      assignees: ['Quốc', 'Khánh', 'Sư Phụ'],
      assigneeUids: ['uid_quoc', 'uid_khanh', 'uid_suphu'],
      referenceLinks: [],
      resultLinks: [],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 't_locked',
      displayCode: '3',
      title: 'Công việc cũ của tài khoản đã khóa',
      assignees: ['Khả Tuệ'],
      assigneeUids: ['uid_tuan_locked'],
      referenceLinks: [],
      resultLinks: [],
      isTestRecord: false,
    },
    {
      ...sampleTasks[0],
      id: 't_orphan',
      displayCode: '4',
      title: 'Công việc chứa UID cũ không tồn tại',
      assignees: [],
      assigneeUids: ['uid_deleted_legacy_999'],
      referenceLinks: [],
      resultLinks: [],
      isTestRecord: false,
    },
  ];

  // 2. Member A viewing Member B's task sees exact official names, matching Admin, with ZERO extra edit rights
  const adminResolvedB = resolveTaskAssignees(sharedTasks[0], adminUsersList);
  const memberResolvedB = resolveTaskAssignees(sharedTasks[0], memberDirectoryForKhanh);
  const viewerResolvedB = resolveTaskAssignees(sharedTasks[0], memberDirectoryForViewer);

  assert.equal(adminResolvedB.displayText, 'Mỵ, Sư Tín');
  assert.equal(memberResolvedB.displayText, adminResolvedB.displayText);
  assert.equal(viewerResolvedB.displayText, adminResolvedB.displayText);
  assert.equal(memberResolvedB.unknownUidCount, 0);
  assert.equal(viewerResolvedB.unknownUidCount, 0);
  assert.equal(canUserEditTask(memberA, sharedTasks[0]), false);
  assert.equal(canUserEditTask(viewerAccount, sharedTasks[0]), false);
  assert.equal(canUserEditTask(memberA, sharedTasks[1]), true); // assigned to Khánh
  assert.equal(canUserEditTask(viewerAccount, sharedTasks[1]), false);

  // 3. Multi-assignee & co-assignee resolution in My Work matches official names
  const coInfoForKhanh = getMyWorkCoAssigneesInfo(
    sharedTasks[1],
    memberA.uid,
    memberDirectoryForKhanh
  );
  assert.deepEqual(coInfoForKhanh.coAssigneeNames, ['Quốc', 'Sư Phụ']);
  assert.equal(coInfoForKhanh.unknownUidCount, 0);

  // 4. Admin renames Member B (Mỵ -> Mỵ (Biên tập)) -> synced directory immediately updates Tasks & Documents
  const renamedDirectory = memberDirectoryForKhanh.map((m) =>
    m.uid === 'uid_my' ? { ...m, displayName: 'Mỵ (Biên tập)' } : m
  );
  assert.equal(
    resolveTaskAssignees(sharedTasks[0], renamedDirectory).displayText,
    'Mỵ (Biên tập), Sư Tín'
  );
  const docsForMember = buildProjectDocumentEntries(
    [sharedTasks[0]],
    sampleCategories,
    renamedDirectory
  );
  assert.equal(docsForMember.entries[0].officialAssigneeText, 'Mỵ (Biên tập), Sư Tín');

  // 5. Locked account preserves UID link and displays "Tuấn (Đã khóa)" identically for Admin/Member/Viewer
  assert.equal(
    resolveTaskAssignees(sharedTasks[2], adminUsersList).displayText,
    'Tuấn (Đã khóa)'
  );
  assert.equal(
    resolveTaskAssignees(sharedTasks[2], memberDirectoryForKhanh).displayText,
    'Tuấn (Đã khóa)'
  );
  assert.equal(
    resolveTaskAssignees(sharedTasks[2], memberDirectoryForViewer).displayText,
    'Tuấn (Đã khóa)'
  );

  // 6. Truly unmatched/old UID still surfaces neutral "Tài khoản không xác định" (never raw UID)
  const orphanResolved = resolveTaskAssignees(sharedTasks[3], memberDirectoryForKhanh);
  assert.equal(orphanResolved.unknownUidCount, 1);
  assert.equal(orphanResolved.displayText, 'Tài khoản không xác định');
  assert.equal(orphanResolved.displayText.includes('uid_deleted_legacy_999'), false);

  // 7. Firestore Rules PII isolation & access control verification
  assert.match(
    rulesText,
    /function isTaskManager\(\)[\s\S]*?p\.role == 'admin' \|\| p\.role == 'moderator'/
  );
  assert.match(
    rulesText,
    /match \/users\/\{uid\}[\s\S]*?allow list:\s*if isTaskManager\(\);/
  );
  assert.match(
    rulesText,
    /function isValidMemberDirectoryEntry\(data, uid\)[\s\S]*?hasOnly\(\['uid', 'displayName', 'isActive', 'updatedAt'\]\)/
  );
  assert.match(
    rulesText,
    /match \/memberDirectory\/\{uid\}[\s\S]*?allow get:\s*if isActiveMember\(\) && isValidId\(uid\);[\s\S]*?allow list:\s*if isActiveMember\(\);[\s\S]*?allow delete:\s*if false;/
  );

  // 8. Non-silent error handling, Admin manual sync button, and UI contracts
  const freshServiceText = fs.readFileSync(
    path.join(rootDir, 'src/services/firestoreService.ts'),
    'utf8'
  );
  const freshAppText = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const freshMembersText = fs.readFileSync(
    path.join(rootDir, 'src/components/MembersView.tsx'),
    'utf8'
  );
  const freshTasksViewText = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );
  const freshDrawerText = fs.readFileSync(
    path.join(rootDir, 'src/components/TaskDetailDrawer.tsx'),
    'utf8'
  );

  assert.equal(
    freshServiceText.includes('Fallback cleanly to currentUser if directory rules are not yet deployed'),
    false
  );
  assert.equal(freshServiceText.includes('onError?: (err: Error, meta: { isPermissionDenied: boolean })'), true);
  assert.equal(freshServiceText.includes('Promise<MemberDirectorySyncResult>'), true);
  assert.equal(freshServiceText.includes('directorySynced: false'), true);

  assert.equal(freshAppText.includes('Chưa tải được danh bạ thành viên'), true);
  assert.equal(freshAppText.includes('Thử tải lại'), true);
  assert.equal(freshAppText.includes('handleSyncMemberDirectory'), true);
  assert.equal(freshAppText.includes('directoryUnavailable={directoryState.status === \'error\'}'), true);

  assert.equal(freshMembersText.includes('Đồng bộ danh bạ'), true);
  assert.equal(freshMembersText.includes('onSyncMemberDirectory'), true);

  assert.equal(freshTasksViewText.includes('directoryUnavailable'), true);
  assert.equal(freshTasksViewText.includes('visibleMembers = resolved.assignedMembers.slice(0, 2)'), true);
  assert.equal(freshTasksViewText.includes('overflowCount > 0'), true);

  assert.equal(freshDrawerText.includes('directoryUnavailable'), true);
});

test('Case 16: Smart Parent-Child Navigation V2.0 — child attention summary, filter expand/collapse override, and UI contracts', () => {
  const refDate = new Date('2026-05-15T12:00:00Z');
  const baseChild: TaskItem = {
    ...sampleTasks[2],
    parentId: 'tbhgn_4',
    isTestRecord: false,
    archivedAt: null,
    status: 'Đang làm',
    dueDate: '2026-06-01',
    reviewFlags: [],
  };

  // 1. Clean children -> zero signals suppressed
  const cleanSummary = summarizeChildAttention(
    [
      { ...baseChild, id: 'c_clean_1', status: 'Đang làm', dueDate: '2026-06-01' },
      { ...baseChild, id: 'c_clean_2', status: 'Hoàn thành', dueDate: '2026-04-01' },
    ],
    refDate
  );
  assert.equal(cleanSummary.overdueCount, 0);
  assert.equal(cleanSummary.pendingApprovalCount, 0);
  assert.equal(cleanSummary.dataReviewCount, 0);
  assert.equal(cleanSummary.signals.length, 0);
  assert.equal(cleanSummary.visibleSignals.length, 0);
  assert.equal(cleanSummary.tooltipText, '');

  // 2. All 3 real signal types -> prioritized order, max 2 inline, 3rd preserved in tooltip
  const mixedChildren: TaskItem[] = [
    {
      ...baseChild,
      id: 'c_overdue',
      status: 'Đang làm',
      dueDate: '2026-05-01',
      reviewFlags: [],
    },
    {
      ...baseChild,
      id: 'c_pending',
      status: 'Chờ duyệt',
      dueDate: '2026-06-01',
      reviewFlags: [],
    },
    {
      ...baseChild,
      id: 'c_review',
      status: 'Tạm dừng',
      dueDate: null,
      reviewFlags: ['missing_assignee'],
    },
    {
      ...baseChild,
      id: 'c_missing_status_only',
      status: null,
      dueDate: null,
      reviewFlags: [],
    },
  ];
  const mixedSummary = summarizeChildAttention(mixedChildren, refDate);
  assert.equal(mixedSummary.overdueCount, 1);
  assert.equal(mixedSummary.pendingApprovalCount, 1);
  assert.equal(mixedSummary.dataReviewCount, 1);
  assert.deepEqual(
    mixedSummary.visibleSignals.map((s) => s.label),
    ['1 quá hạn', '1 chờ duyệt']
  );
  assert.deepEqual(
    mixedSummary.hiddenSignals.map((s) => s.label),
    ['1 cần rà soát']
  );
  assert.equal(
    mixedSummary.tooltipText,
    '1 quá hạn · 1 chờ duyệt · 1 cần rà soát'
  );

  // 3. Smart filter expand/collapse state allows manual collapse while filter is active
  assert.equal(
    resolveParentExpandedState({
      parentId: 'tbhgn_4',
      hasVisibleChildren: true,
      hasActiveFilter: true,
      autoExpand: true,
      expandedParents: { tbhgn_4: false },
      filterOverrides: {},
    }),
    true
  );
  assert.equal(
    resolveParentExpandedState({
      parentId: 'tbhgn_4',
      hasVisibleChildren: true,
      hasActiveFilter: true,
      autoExpand: true,
      expandedParents: { tbhgn_4: true },
      filterOverrides: { tbhgn_4: false },
    }),
    false
  );
  assert.equal(
    resolveParentExpandedState({
      parentId: 'tbhgn_4',
      hasVisibleChildren: true,
      hasActiveFilter: false,
      autoExpand: false,
      expandedParents: { tbhgn_4: true },
      filterOverrides: { tbhgn_4: false },
    }),
    true
  );
  assert.equal(
    resolveParentExpandedState({
      parentId: 'tbhgn_1',
      hasVisibleChildren: false,
      hasActiveFilter: false,
      autoExpand: false,
      expandedParents: { tbhgn_1: true },
      filterOverrides: {},
    }),
    false
  );

  // 4. UI source contracts on TasksView & TaskDetailDrawer
  const freshTasksView = fs.readFileSync(
    path.join(rootDir, 'src/components/TasksView.tsx'),
    'utf8'
  );
  const freshDrawer = fs.readFileSync(
    path.join(rootDir, 'src/components/TaskDetailDrawer.tsx'),
    'utf8'
  );

  assert.equal(freshTasksView.includes('ListTree'), true);
  assert.equal(freshTasksView.includes('việc con phù hợp'), true);
  assert.equal(freshTasksView.includes('Xem việc con'), true);
  assert.equal(freshTasksView.includes('hoàn thành'), true);
  assert.equal(freshTasksView.includes('<span>Chi tiết</span>'), true);
  assert.equal(freshTasksView.includes('aria-expanded={isExpanded}'), true);
  assert.equal(freshTasksView.includes('aria-controls={childrenRegionId}'), true);
  assert.equal(freshTasksView.includes('summarizeChildAttention'), true);
  assert.equal(freshTasksView.includes('resolveParentExpandedState'), true);
  assert.equal(freshTasksView.includes('filterExpansionOverrides'), true);
  assert.equal(freshTasksView.includes('handleParentPrimaryAction'), true);

  // TaskDetailDrawer View Mode places Việc con (N) BEFORE Tài liệu & Kết quả and Ghi chú
  const viewModeStart = freshDrawer.indexOf('TAB: CHI TIẾT — VIEW MODE');
  const editModeStart = freshDrawer.indexOf('TAB: CHI TIẾT — EDIT MODE');
  assert.ok(viewModeStart > 0 && editModeStart > viewModeStart);
  const viewModeChunk = freshDrawer.slice(viewModeStart, editModeStart);
  const subtasksPos = viewModeChunk.indexOf('Việc con ({childTasks.length})');
  const docsPos = viewModeChunk.indexOf('Tài liệu &amp; Kết quả');
  const notesPos = viewModeChunk.indexOf('aria-label="Ghi chú"');
  assert.ok(subtasksPos > 0, 'View mode must render Việc con ({childTasks.length})');
  assert.ok(
    subtasksPos < docsPos && docsPos < notesPos,
    'Việc con must appear before Tài liệu & Kết quả and Ghi chú in View Mode'
  );
  assert.equal(viewModeChunk.includes('canCreateSubHere'), true);
  assert.equal(viewModeChunk.includes("type: 'select_task'"), true);

  // Edit mode also keeps draft-safe subtask jump via handleIntent
  const editModeChunk = freshDrawer.slice(editModeStart);
  assert.equal(editModeChunk.includes('aria-label="Chuyển nhanh việc con"'), true);
  assert.equal(editModeChunk.includes("type: 'select_task'"), true);
});







