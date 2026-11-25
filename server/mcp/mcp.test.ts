import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import express from 'express';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from 'jose';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { CategoryItem, TaskItem } from '../../src/types/project.js';
import { createMcpTokenVerifier } from './auth.js';
import { loadMcpConfig } from './config.js';
import {
  createFirestoreReadRepository,
  createInMemoryMcpRepository,
} from './firestoreReadRepo.js';
import { mountMcpServer } from './router.js';
import { MCP_READ_ONLY_TOOL_NAMES } from './tools.js';
import type { McpAuditEntry, McpUserRecord } from './types.js';

const REFERENCE_DATE = new Date('2026-06-15T12:00:00Z');
const OAUTH_ISSUER = 'https://auth.tbhgn-test.example';
const SECRET_EMAIL_SENTINEL = 'secret-personal-email@example.com';

const FIXTURE_USERS: McpUserRecord[] = [
  {
    uid: 'uid_admin',
    displayName: 'Sư Phụ',
    role: 'admin',
    canApprove: true,
    isActive: true,
  },
  {
    uid: 'uid_mod',
    displayName: 'Điều Phối A',
    role: 'moderator',
    canApprove: true,
    isActive: true,
  },
  {
    uid: 'uid_member',
    displayName: 'Khánh',
    role: 'member',
    canApprove: false,
    isActive: true,
  },
  {
    uid: 'uid_viewer',
    displayName: 'Mỵ',
    role: 'viewer',
    canApprove: false,
    isActive: true,
  },
  {
    uid: 'uid_locked',
    displayName: 'Tài Khoản Khóa',
    role: 'member',
    canApprove: false,
    isActive: false,
  },
];

const FIXTURE_CATEGORIES: CategoryItem[] = [
  {
    id: 'cat_outline',
    name: 'Đề cương',
    color: '#13294B',
    sortOrder: 1,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'uid_admin',
    updatedBy: 'uid_admin',
  },
  {
    id: 'cat_research',
    name: 'Truy nguồn & nghiên cứu',
    color: '#8A5A00',
    sortOrder: 2,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'uid_admin',
    updatedBy: 'uid_admin',
  },
];

const FIXTURE_TASKS: TaskItem[] = [
  {
    id: 'tbhgn_parent_1',
    displayCode: '1',
    parentId: null,
    sortOrder: 10,
    title: 'Khung đề cương tổng thể',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: ['Khánh'],
    assigneeUids: ['uid_member'],
    status: 'Đang làm',
    nextStep: 'Hoàn thiện mục lục chương 2',
    dueDate: '2026-07-01',
    updatedAt: '2026-06-10T08:00:00Z',
    updatedBy: 'Khánh',
    version: 3,
    referenceLinks: [
      {
        id: 'ref_1',
        label: 'Tài liệu tham khảo đề cương',
        url: 'https://docs.google.com/document/d/ref-outline',
        type: 'reference',
      },
    ],
    resultLinks: [
      {
        id: 'res_1',
        label: 'Bản thảo kết quả đề cương v1',
        url: 'https://docs.google.com/document/d/res-outline-v1',
        type: 'result',
      },
    ],
    notes: 'Ghi chú nội bộ về đề cương.',
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_child_1_1',
    displayCode: '1.1',
    parentId: 'tbhgn_parent_1',
    sortOrder: 11,
    title: 'Rà soát phần mở đầu (Quá hạn & Chờ duyệt)',
    categoryId: null,
    category: null,
    assignees: ['Khánh'],
    assigneeUids: ['uid_member'],
    status: 'Chờ duyệt',
    nextStep: 'Trình Sư Phụ duyệt',
    dueDate: '2026-06-01', // Overdue relative to 2026-06-15 AND Chờ duyệt -> tests deduplication!
    updatedAt: '2026-06-11T08:00:00Z',
    updatedBy: 'Khánh',
    version: 2,
    referenceLinks: [],
    resultLinks: [
      {
        id: 'res_1_1',
        label: 'Bản trình duyệt phần mở đầu',
        url: 'https://drive.google.com/file/d/open-approval',
        type: 'result',
      },
    ],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_child_1_2',
    displayCode: '1.2',
    parentId: 'tbhgn_parent_1',
    sortOrder: 12,
    title: 'Chuẩn hóa thuật ngữ Phật học',
    categoryId: null,
    category: null,
    assignees: ['Sư Phụ'],
    assigneeUids: ['uid_admin'],
    status: 'Hoàn thành',
    nextStep: null,
    dueDate: '2026-05-20',
    updatedAt: '2026-05-19T10:00:00Z',
    updatedBy: 'Sư Phụ',
    version: 4,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_task_paused',
    displayCode: '2',
    parentId: null,
    sortOrder: 20,
    title: 'Đối chiếu bản dịch cổ',
    categoryId: 'cat_research',
    category: 'Truy nguồn & nghiên cứu',
    assignees: ['Mỵ'],
    assigneeUids: ['uid_viewer'],
    status: 'Tạm dừng',
    nextStep: 'Chờ bổ sung nguồn gốc',
    dueDate: null,
    updatedAt: '2026-06-05T09:00:00Z',
    updatedBy: 'Sư Phụ',
    version: 1,
    referenceLinks: [
      {
        id: 'ref_missing_url',
        label: 'Liên kết thiếu URL',
        url: null,
        type: 'reference',
        needsUrlExtraction: true,
      },
    ],
    resultLinks: [],
    notes: null,
    reviewFlags: ['missing_hyperlink_url'],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_task_not_started',
    displayCode: '3',
    parentId: null,
    sortOrder: 30,
    title: 'Biên tập phụ lục chú giải',
    categoryId: 'cat_research',
    category: 'Truy nguồn & nghiên cứu',
    assignees: ['Nhóm'],
    assigneeUids: [],
    status: 'Chưa bắt đầu',
    nextStep: null,
    dueDate: '2026-08-01',
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_task_null_status',
    displayCode: '4',
    parentId: null,
    sortOrder: 40,
    title: 'Công việc chưa gắn trạng thái',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: [],
    assigneeUids: [],
    status: null, // MUST stay separate from 'Chưa bắt đầu'!
    nextStep: null,
    dueDate: null,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: ['missing_status', 'missing_assignee'],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_dup_code_a',
    displayCode: '9',
    parentId: null,
    sortOrder: 90,
    title: 'Mục trùng mã bản A',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: ['Khánh'],
    assigneeUids: ['uid_member'],
    status: 'Chờ duyệt',
    nextStep: null,
    dueDate: '2026-07-15',
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  {
    id: 'tbhgn_dup_code_b',
    displayCode: '9',
    parentId: null,
    sortOrder: 91,
    title: 'Mục trùng mã bản B',
    categoryId: 'cat_research',
    category: 'Truy nguồn & nghiên cứu',
    assignees: ['Điều Phối A'],
    assigneeUids: ['uid_mod'],
    status: 'Đang làm',
    nextStep: null,
    dueDate: null,
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
  },
  // Archived task: MUST be excluded by default
  {
    id: 'tbhgn_archived_99',
    displayCode: '99',
    parentId: null,
    sortOrder: 99,
    title: 'Công việc đã lưu trữ không được hiển thị',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: [],
    assigneeUids: ['uid_admin'],
    status: 'Chờ duyệt',
    nextStep: null,
    dueDate: '2025-01-01',
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [
      {
        id: 'archived_ref',
        label: 'Tài liệu lưu trữ bí mật',
        url: 'https://docs.google.com/document/d/archived',
        type: 'reference',
      },
    ],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: '2026-05-01T00:00:00Z',
    archivedBy: 'uid_admin',
  },
  // B1 test record: MUST be excluded by default
  {
    id: 'b1_test_task_01',
    displayCode: 'TEST-1',
    parentId: null,
    sortOrder: 100,
    title: 'Bản ghi kiểm thử B1 phải bị ẩn',
    categoryId: 'cat_outline',
    category: 'Đề cương',
    assignees: [],
    assigneeUids: ['uid_admin'],
    status: 'Đang làm',
    nextStep: null,
    dueDate: '2025-01-01',
    updatedAt: null,
    updatedBy: null,
    version: 1,
    referenceLinks: [],
    resultLinks: [],
    notes: null,
    reviewFlags: [],
    archivedAt: null,
    archivedBy: null,
    isTestRecord: true,
  },
];

let serverHandle: ReturnType<express.Express['listen']>;
let baseUrl: string;
let mcpUrl: string;
let signingPrivateKey: CryptoKey;
let roguePrivateKey: CryptoKey;
const auditLogs: McpAuditEntry[] = [];

async function issueOAuthJwt(params: {
  uid: string;
  scope?: string;
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  useRogueKey?: boolean;
  includeEmailClaim?: boolean;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (params.expiresInSec ?? 3600);
  const payload: Record<string, unknown> = {
    firebase_uid: params.uid,
    scope: params.scope ?? 'mcp:read',
  };
  if (params.includeEmailClaim) {
    payload.email = SECRET_EMAIL_SENTINEL;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(params.issuer ?? OAUTH_ISSUER)
    .setAudience(params.audience ?? mcpUrl)
    .setSubject(params.uid)
    .setIssuedAt(now - 5)
    .setExpirationTime(exp)
    .sign(params.useRogueKey ? roguePrivateKey : signingPrivateKey);
}

async function createConnectedMcpClient(token: string): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const client = new Client({
    name: 'tbhgn-test-client',
    version: '1.0.0',
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

before(async () => {
  const validPair = await generateKeyPair('RS256');
  signingPrivateKey = validPair.privateKey;
  const publicJwk = await exportJWK(validPair.publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const roguePair = await generateKeyPair('RS256');
  roguePrivateKey = roguePair.privateKey;

  const localJwks = createLocalJWKSet({ keys: [publicJwk] });

  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Start server on ephemeral port first so mcpUrl is exact
  await new Promise<void>((resolve) => {
    serverHandle = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = serverHandle.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  mcpUrl = `${baseUrl}/mcp`;

  const config = loadMcpConfig({
    firebaseProjectId: 'gen-lang-client-0491463422',
    firestoreDatabaseId: 'ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab',
    env: {
      NODE_ENV: 'test',
      MCP_ENABLED: 'true',
      MCP_PUBLIC_URL: mcpUrl,
      MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
      MCP_ALLOWED_ORIGINS: '127.0.0.1,localhost',
      MCP_ALLOW_FIREBASE_ID_TOKEN: 'true',
      MCP_OAUTH_ISSUER: OAUTH_ISSUER,
      MCP_OAUTH_AUDIENCE: mcpUrl,
      MCP_OAUTH_JWKS_URI: `${OAUTH_ISSUER}/.well-known/jwks.json`,
      MCP_OAUTH_REQUIRED_SCOPE: 'mcp:read',
      MCP_OAUTH_UID_CLAIM: 'firebase_uid',
      MCP_RATE_LIMIT_PER_MIN: '300',
    },
  });

  const repo = createInMemoryMcpRepository({
    users: FIXTURE_USERS,
    tasks: FIXTURE_TASKS,
    categories: FIXTURE_CATEGORIES,
  });

  const verifier = createMcpTokenVerifier(config, {
    oauthJwks: localJwks,
  });

  mountMcpServer(app, {
    config,
    verifier,
    repositoryFactory: () => repo,
    referenceDate: REFERENCE_DATE,
    auditLogger: (entry) => auditLogs.push(entry),
  });
});

after(async () => {
  if (serverHandle) {
    await new Promise<void>((resolve, reject) => {
      serverHandle.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test('1. Health and OAuth RFC 9728 / RFC 8414 metadata endpoints respond cleanly with zero secrets', async () => {
  const healthRes = await fetch(`${baseUrl}/api/mcp/health`);
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as Record<string, unknown>;
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'read_only_v1');
  assert.equal(health.toolCount, 6);

  const prmRoot = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(prmRoot.status, 200);
  const prmRootJson = (await prmRoot.json()) as Record<string, unknown>;
  assert.equal(prmRootJson.resource, mcpUrl);
  assert.deepEqual(prmRootJson.scopes_supported, ['mcp:read']);

  const prmPath = await fetch(
    `${baseUrl}/.well-known/oauth-protected-resource/mcp`
  );
  assert.equal(prmPath.status, 200);

  const asMeta = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(asMeta.status, 200);
  const asMetaJson = (await asMeta.json()) as Record<string, unknown>;
  assert.equal(asMetaJson.issuer, OAUTH_ISSUER);
});

test('2. Unauthenticated, forged, expired, wrong-aud, wrong-iss, and insufficient-scope tokens are rejected fail-closed', async () => {
  // Missing token -> 401 + WWW-Authenticate
  const noAuth = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(noAuth.status, 401);
  const wwwAuth = noAuth.headers.get('www-authenticate') ?? '';
  assert.match(wwwAuth, /Bearer/i);
  assert.match(wwwAuth, /oauth-protected-resource/i);

  // Forged signature (signed by rogue key) -> 401
  const forged = await issueOAuthJwt({ uid: 'uid_admin', useRogueKey: true });
  const forgedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${forged}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(forgedRes.status, 401);

  // Expired token -> 401
  const expired = await issueOAuthJwt({ uid: 'uid_admin', expiresInSec: -60 });
  const expiredRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${expired}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(expiredRes.status, 401);

  // Wrong audience -> 401
  const wrongAud = await issueOAuthJwt({
    uid: 'uid_admin',
    audience: 'https://other-service.example/mcp',
  });
  const wrongAudRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wrongAud}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(wrongAudRes.status, 401);

  // Wrong issuer -> 401
  const wrongIss = await issueOAuthJwt({
    uid: 'uid_admin',
    issuer: 'https://evil-idp.example',
  });
  const wrongIssRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wrongIss}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(wrongIssRes.status, 401);

  // Insufficient scope -> 403
  const wrongScope = await issueOAuthJwt({
    uid: 'uid_admin',
    scope: 'openid profile',
  });
  const wrongScopeRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wrongScope}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(wrongScopeRes.status, 403);
});

test('3. Locked account (isActive: false) and unknown UID are rejected with 403', async () => {
  const lockedToken = await issueOAuthJwt({ uid: 'uid_locked' });
  const lockedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lockedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(lockedRes.status, 403);

  const unknownToken = await issueOAuthJwt({ uid: 'uid_does_not_exist' });
  const unknownRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${unknownToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(unknownRes.status, 403);
});

test('4. DNS rebinding protection rejects disallowed Origin and stateless GET/DELETE return 405', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_admin' });

  const badOrigin = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://evil-attacker.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(badOrigin.status, 403);

  const getRes = await fetch(mcpUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(getRes.status, 405);

  const delRes = await fetch(mcpUrl, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(delRes.status, 405);
});

test('5. Real MCP Client initialize & tools/list returns strictly 6 read-only tools with ZERO write tools', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_admin', includeEmailClaim: true });
  const { client, transport } = await createConnectedMcpClient(token);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...MCP_READ_ONLY_TOOL_NAMES].sort());
    assert.equal(listed.tools.length, 6);

    for (const tool of listed.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
    }

    // Verify whoami never leaks email claim and always reflects verified token actor
    const whoamiRes = await client.callTool({
      name: 'whoami',
      arguments: { uid: 'uid_fake_spoof', role: 'viewer' },
    });
    const whoamiData = whoamiRes.structuredContent as Record<string, unknown>;
    assert.equal(whoamiData.uid, 'uid_admin');
    assert.equal(whoamiData.role, 'admin');
    assert.equal(whoamiData.displayName, 'Sư Phụ');
    assert.equal(
      (whoamiData.capabilities as Record<string, unknown>).canWriteViaMcp,
      false
    );
    assert.ok(!JSON.stringify(whoamiRes).includes(SECRET_EMAIL_SENTINEL));
    assert.ok(!('email' in whoamiData));
  } finally {
    await transport.close();
    await client.close();
  }
});

test('6. get_project_summary excludes archived/B1 test tasks, keeps status=null separate, and never double-counts overdue+pending', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_admin' });
  const { client, transport } = await createConnectedMcpClient(token);
  try {
    const res = await client.callTool({
      name: 'get_project_summary',
      arguments: {},
    });
    const data = res.structuredContent as {
      totalTasks: number;
      parentTasksCount: number;
      childTasksCount: number;
      statusCounts: Record<string, number>;
      overdueCount: number;
      watchlistUniqueCount: number;
      overlapOverdueAndPendingCount: number;
      needsReviewCount: number;
      actionableApprovalsForMeCount: number;
      documentsCount: { total: number; reference: number; result: number };
    };

    // 10 fixture tasks minus 1 archived minus 1 B1 test = 8 active tasks
    assert.equal(data.totalTasks, 8);
    assert.equal(data.parentTasksCount, 6);
    assert.equal(data.childTasksCount, 2);

    // Exact 5 statuses + null kept separate
    assert.equal(data.statusCounts.inProgress, 2);
    assert.equal(data.statusCounts.pendingApproval, 2);
    assert.equal(data.statusCounts.paused, 1);
    assert.equal(data.statusCounts.completed, 1);
    assert.equal(data.statusCounts.notStarted, 1);
    assert.equal(data.statusCounts.missingStatus, 1);

    // Sum equals total
    const sum = Object.values(data.statusCounts).reduce((a, b) => a + b, 0);
    assert.equal(sum, data.totalTasks);

    // Overdue = 1 (tbhgn_child_1_1), Pending = 2 (tbhgn_child_1_1 + tbhgn_dup_code_a), Overlap = 1 -> Unique watchlist = 2!
    assert.equal(data.overdueCount, 1);
    assert.equal(data.overlapOverdueAndPendingCount, 1);
    assert.equal(data.watchlistUniqueCount, 2);
    assert.equal(data.actionableApprovalsForMeCount, 2);
    assert.equal(data.needsReviewCount, 2);

    // Documents exclude archived task's link -> 2 reference + 2 result = 4
    assert.equal(data.documentsCount.total, 4);
    assert.equal(data.documentsCount.reference, 2);
    assert.equal(data.documentsCount.result, 2);
  } finally {
    await transport.close();
    await client.close();
  }
});

test('7. list_tasks filtering, status=missing_status, pagination cursor, and official assignee resolution', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_member' });
  const { client, transport } = await createConnectedMcpClient(token);
  try {
    // Filter missing_status only
    const nullRes = await client.callTool({
      name: 'list_tasks',
      arguments: { status: 'missing_status' },
    });
    const nullData = nullRes.structuredContent as {
      totalMatched: number;
      tasks: Array<{ id: string; status: string | null }>;
    };
    assert.equal(nullData.totalMatched, 1);
    assert.equal(nullData.tasks[0].id, 'tbhgn_task_null_status');
    assert.equal(nullData.tasks[0].status, null);

    // Pagination test (limit 3 across 8 active tasks -> 3 + 3 + 2)
    const p1 = (
      await client.callTool({ name: 'list_tasks', arguments: { limit: 3 } })
    ).structuredContent as {
      totalMatched: number;
      returnedCount: number;
      hasMore: boolean;
      nextCursor: string | null;
      tasks: Array<{ id: string; assigneeText: string }>;
    };
    assert.equal(p1.totalMatched, 8);
    assert.equal(p1.returnedCount, 3);
    assert.equal(p1.hasMore, true);
    assert.ok(p1.nextCursor);
    assert.equal(p1.tasks[0].assigneeText, 'Khánh');

    const p2 = (
      await client.callTool({
        name: 'list_tasks',
        arguments: { limit: 3, cursor: p1.nextCursor! },
      })
    ).structuredContent as {
      returnedCount: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    assert.equal(p2.returnedCount, 3);
    assert.equal(p2.hasMore, true);

    const p3 = (
      await client.callTool({
        name: 'list_tasks',
        arguments: { limit: 3, cursor: p2.nextCursor! },
      })
    ).structuredContent as {
      returnedCount: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
    assert.equal(p3.returnedCount, 2);
    assert.equal(p3.hasMore, false);
    assert.equal(p3.nextCursor, null);
  } finally {
    await transport.close();
    await client.close();
  }
});

test('8. get_task returns parent/child/separated links, handles ambiguous displayCode safely, and hides archived/test tasks', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_mod' });
  const { client, transport } = await createConnectedMcpClient(token);
  try {
    // Parent task with children & separated links
    const parentRes = (
      await client.callTool({
        name: 'get_task',
        arguments: { displayCode: '1' },
      })
    ).structuredContent as {
      lookupStatus: string;
      task: {
        id: string;
        referenceLinks: Array<{ group: string }>;
        resultLinks: Array<{ group: string }>;
      };
      childTasks: Array<{ id: string }>;
      childProgress: { completed: number; total: number; percent: number };
    };
    assert.equal(parentRes.lookupStatus, 'found');
    assert.equal(parentRes.task.id, 'tbhgn_parent_1');
    assert.equal(parentRes.childTasks.length, 2);
    assert.equal(parentRes.childProgress.completed, 1);
    assert.equal(parentRes.childProgress.total, 2);
    assert.equal(parentRes.task.referenceLinks.length, 1);
    assert.equal(parentRes.task.referenceLinks[0].group, 'reference');
    assert.equal(parentRes.task.resultLinks.length, 1);
    assert.equal(parentRes.task.resultLinks[0].group, 'result');

    // Ambiguous displayCode "9" -> MUST NOT guess
    const ambigRes = (
      await client.callTool({
        name: 'get_task',
        arguments: { displayCode: '9' },
      })
    ).structuredContent as {
      lookupStatus: string;
      task: unknown;
      candidates: Array<{ id: string }>;
    };
    assert.equal(ambigRes.lookupStatus, 'ambiguous');
    assert.equal(ambigRes.task, null);
    assert.equal(ambigRes.candidates.length, 2);

    // Archived task must return not_found
    const archivedRes = (
      await client.callTool({
        name: 'get_task',
        arguments: { taskId: 'tbhgn_archived_99' },
      })
    ).structuredContent as { lookupStatus: string };
    assert.equal(archivedRes.lookupStatus, 'not_found');

    // B1 test task must return not_found
    const testTaskRes = (
      await client.callTool({
        name: 'get_task',
        arguments: { taskId: 'b1_test_task_01' },
      })
    ).structuredContent as { lookupStatus: string };
    assert.equal(testTaskRes.lookupStatus, 'not_found');
  } finally {
    await transport.close();
    await client.close();
  }
});

test('9. search_documents strictly separates reference vs result and excludes archived task links', async () => {
  const token = await issueOAuthJwt({ uid: 'uid_viewer' });
  const { client, transport } = await createConnectedMcpClient(token);
  try {
    const refOnly = (
      await client.callTool({
        name: 'search_documents',
        arguments: { group: 'reference', validUrlOnly: true },
      })
    ).structuredContent as {
      totalMatched: number;
      documents: Array<{ group: string; label: string; url: string | null }>;
    };
    assert.equal(refOnly.totalMatched, 1);
    assert.equal(refOnly.documents[0].group, 'reference');
    assert.match(refOnly.documents[0].label, /tham khảo/i);

    const resOnly = (
      await client.callTool({
        name: 'search_documents',
        arguments: { group: 'result' },
      })
    ).structuredContent as {
      totalMatched: number;
      documents: Array<{ group: string }>;
    };
    assert.equal(resOnly.totalMatched, 2);
    assert.ok(resOnly.documents.every((d) => d.group === 'result'));

    // Archived secret document must NOT appear
    const archivedSearch = (
      await client.callTool({
        name: 'search_documents',
        arguments: { query: 'lưu trữ bí mật' },
      })
    ).structuredContent as { totalMatched: number };
    assert.equal(archivedSearch.totalMatched, 0);
  } finally {
    await transport.close();
    await client.close();
  }
});

test('10. list_pending_approvals enforces RBAC across Admin/Moderator vs Member/Viewer', async () => {
  // Admin sees 2 actionable approvals labeled "Cần bạn duyệt"
  const adminToken = await issueOAuthJwt({ uid: 'uid_admin' });
  const adminConn = await createConnectedMcpClient(adminToken);
  try {
    const res = (
      await adminConn.client.callTool({
        name: 'list_pending_approvals',
        arguments: { scope: 'actionable_by_me' },
      })
    ).structuredContent as {
      actorCanApproveAny: boolean;
      actionableByMeCount: number;
      items: Array<{ approvalLabel: string; canCurrentUserApprove: boolean }>;
    };
    assert.equal(res.actorCanApproveAny, true);
    assert.equal(res.actionableByMeCount, 2);
    assert.equal(res.items.length, 2);
    assert.ok(res.items.every((i) => i.approvalLabel === 'Cần bạn duyệt'));
  } finally {
    await adminConn.transport.close();
    await adminConn.client.close();
  }

  // Member without canApprove sees 0 actionable approvals and NEVER gets "Cần bạn duyệt"
  const memberToken = await issueOAuthJwt({ uid: 'uid_member' });
  const memberConn = await createConnectedMcpClient(memberToken);
  try {
    const actionable = (
      await memberConn.client.callTool({
        name: 'list_pending_approvals',
        arguments: { scope: 'actionable_by_me' },
      })
    ).structuredContent as {
      actorCanApproveAny: boolean;
      totalPendingVisible: number;
      actionableByMeCount: number;
      items: unknown[];
    };
    assert.equal(actionable.actorCanApproveAny, false);
    assert.equal(actionable.totalPendingVisible, 2);
    assert.equal(actionable.actionableByMeCount, 0);
    assert.equal(actionable.items.length, 0);

    const allVisible = (
      await memberConn.client.callTool({
        name: 'list_pending_approvals',
        arguments: { scope: 'all_visible' },
      })
    ).structuredContent as {
      items: Array<{ approvalLabel: string; canCurrentUserApprove: boolean }>;
    };
    assert.equal(allVisible.items.length, 2);
    assert.ok(allVisible.items.every((i) => i.approvalLabel === 'Đang chờ duyệt'));
    assert.ok(allVisible.items.every((i) => i.canCurrentUserApprove === false));
  } finally {
    await memberConn.transport.close();
    await memberConn.client.close();
  }

  // Viewer also sees 0 actionable approvals
  const viewerToken = await issueOAuthJwt({ uid: 'uid_viewer' });
  const viewerConn = await createConnectedMcpClient(viewerToken);
  try {
    const res = (
      await viewerConn.client.callTool({
        name: 'list_pending_approvals',
        arguments: { scope: 'actionable_by_me' },
      })
    ).structuredContent as { actionableByMeCount: number; items: unknown[] };
    assert.equal(res.actionableByMeCount, 0);
    assert.equal(res.items.length, 0);
  } finally {
    await viewerConn.transport.close();
    await viewerConn.client.close();
  }
});

test('11. FirestoreReadRepository exposes strictly read-only methods and audit logs contain zero PII/tokens', () => {
  const restRepo = createFirestoreReadRepository({
    projectId: 'gen-lang-client-0491463422',
    databaseId: 'test-db',
    bearerToken: 'dummy-token',
  });
  const methods = Object.keys(restRepo).sort();
  assert.deepEqual(methods, [
    'getUserProfile',
    'listCategories',
    'listMemberDirectory',
    'listTasks',
  ]);

  assert.ok(auditLogs.length > 0);
  const serializedLogs = JSON.stringify(auditLogs);
  assert.ok(!serializedLogs.includes(SECRET_EMAIL_SENTINEL));
  assert.ok(!serializedLogs.includes('Bearer'));
});
