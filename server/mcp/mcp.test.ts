import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from 'jose';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { CategoryItem, TaskItem } from '../../src/types/project.js';
import {
  createMcpTokenVerifier,
  discoverAuthorizationServerMetadata,
} from './auth.js';
import {
  loadMcpConfig,
  TBHGN_OFFICIAL_PROD_MCP_URL,
} from './config.js';
import {
  createFirestoreReadBridge,
  FIRESTORE_REST_OAUTH_SCOPE,
} from './firestoreBridge.js';
import {
  createFirestoreReadRepository,
  createInMemoryMcpRepository,
} from './firestoreReadRepo.js';
import { createOAuthIdentityLinker } from './identityLink.js';
import { mountMcpServer } from './router.js';
import { MCP_READ_ONLY_TOOL_NAMES } from './tools.js';
import type { McpAuditEntry, McpUserRecord } from './types.js';

const REFERENCE_DATE = new Date('2026-06-15T12:00:00Z');
const OAUTH_ISSUER = 'https://auth.tbhgn-test.example';
const SECRET_EMAIL_SENTINEL = 'secret-personal-email@example.com';
const EXPECTED_PROJECT_ID = 'gen-lang-client-0491463422';
const EXPECTED_DB_ID =
  'ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab';

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

const FIXTURE_IDENTITY_LINKS = JSON.stringify({
  version: 1,
  links: [
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_admin',
      firebaseUid: 'uid_admin',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_mod',
      firebaseUid: 'uid_mod',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_member',
      firebaseUid: 'uid_member',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_viewer',
      firebaseUid: 'uid_viewer',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_locked',
      firebaseUid: 'uid_locked',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_missing_profile',
      firebaseUid: 'uid_does_not_exist',
      verifiedByAdmin: true,
    },
    {
      issuer: OAUTH_ISSUER,
      sub: 'idp_sub_unverified',
      firebaseUid: 'uid_admin',
      verifiedByAdmin: false, // MUST be ignored!
    },
  ],
});

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
    dueDate: '2026-06-01',
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
    status: null,
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
let localJwks: ReturnType<typeof createLocalJWKSet>;
const auditLogs: McpAuditEntry[] = [];

async function issueOAuthJwt(params: {
  sub: string;
  scope?: string;
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  useRogueKey?: boolean;
  includeEmailClaim?: boolean;
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (params.expiresInSec ?? 3600);
  const payload: Record<string, unknown> = {
    scope: params.scope ?? 'mcp:read',
    ...(params.extraClaims ?? {}),
  };
  if (params.includeEmailClaim) {
    payload.email = SECRET_EMAIL_SENTINEL;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(params.issuer ?? OAUTH_ISSUER)
    .setAudience(params.audience ?? mcpUrl)
    .setSubject(params.sub)
    .setIssuedAt(now - 5)
    .setExpirationTime(exp)
    .sign(params.useRogueKey ? roguePrivateKey : signingPrivateKey);
}

async function createConnectedMcpClient(
  targetMcpUrl: string,
  token: string
): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const client = new Client({
    name: 'tbhgn-test-client',
    version: '1.1.0',
  });
  const transport = new StreamableHTTPClientTransport(new URL(targetMcpUrl), {
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

  localJwks = createLocalJWKSet({ keys: [publicJwk] });

  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    serverHandle = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = serverHandle.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  mcpUrl = `${baseUrl}/mcp`;

  const config = loadMcpConfig({
    firebaseProjectId: EXPECTED_PROJECT_ID,
    firestoreDatabaseId: EXPECTED_DB_ID,
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
      MCP_OAUTH_IDENTITY_LINK_MODE: 'mapping_file',
      MCP_OAUTH_UID_MAP_JSON: FIXTURE_IDENTITY_LINKS,
      MCP_OAUTH_PROXY_AS_METADATA: 'false',
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

test('1. Official new domain (duan.banghadengiacngo.io.vn) has zero legacy domain references in production configs & docs', () => {
  const prodConfig = loadMcpConfig({
    firebaseProjectId: EXPECTED_PROJECT_ID,
    firestoreDatabaseId: EXPECTED_DB_ID,
    env: {
      NODE_ENV: 'production',
    },
  });
  assert.equal(prodConfig.publicUrl.toString(), TBHGN_OFFICIAL_PROD_MCP_URL);
  assert.equal(
    prodConfig.publicUrl.toString(),
    'https://duan.banghadengiacngo.io.vn/mcp'
  );
  assert.ok(prodConfig.allowedHosts.includes('duan.banghadengiacngo.io.vn'));
  assert.equal(prodConfig.firestoreBridge.mode, 'disabled');

  const filesToCheck = [
    'server/mcp/config.ts',
    'server/mcp/router.ts',
    '.env.example',
    'deploy/nginx-tbhgn.conf',
    'DEPLOY_VPS.md',
    'docs/MCP_V1_SETUP.md',
  ];
  for (const relPath of filesToCheck) {
    const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
    assert.ok(
      !content.includes('giacngo.nhamycali.com'),
      `Legacy domain still present in ${relPath}`
    );
  }
});

test('2. Health & RFC 9728 Protected Resource Metadata are accurate, and TBHGN does NOT fabricate fake AS metadata', async () => {
  const healthRes = await fetch(`${baseUrl}/api/mcp/health`);
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as {
    ok: boolean;
    mode: string;
    toolCount: number;
    resource: string;
    auth: {
      oauthConfigured: boolean;
      identityLinkMode: string;
      identityLinksConfigured: boolean;
    };
  };
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'read_only_v1.1');
  assert.equal(health.toolCount, 6);
  assert.equal(health.resource, mcpUrl);
  assert.equal(health.auth.oauthConfigured, true);
  assert.equal(health.auth.identityLinkMode, 'mapping_file');
  assert.equal(health.auth.identityLinksConfigured, true);

  const prmRoot = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(prmRoot.status, 200);
  const prmRootJson = (await prmRoot.json()) as Record<string, unknown>;
  assert.equal(prmRootJson.resource, mcpUrl);
  assert.deepEqual(prmRootJson.authorization_servers, [OAUTH_ISSUER]);
  assert.deepEqual(prmRootJson.scopes_supported, ['mcp:read']);

  const prmPath = await fetch(
    `${baseUrl}/.well-known/oauth-protected-resource/mcp`
  );
  assert.equal(prmPath.status, 200);
  const prmPathJson = (await prmPath.json()) as Record<string, unknown>;
  assert.equal(prmPathJson.resource, mcpUrl);

  // Default proxyAsMetadata=false MUST NOT serve fabricated AS metadata on TBHGN origin
  const asMeta = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  assert.equal(asMeta.status, 404);
});

test('3. Unauthenticated, forged, expired, wrong-aud, wrong-iss, and insufficient-scope tokens are rejected fail-closed', async () => {
  const noAuth = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(noAuth.status, 401);
  const wwwAuth = noAuth.headers.get('www-authenticate') ?? '';
  assert.match(wwwAuth, /Bearer/i);
  assert.match(wwwAuth, /oauth-protected-resource/i);

  const forged = await issueOAuthJwt({
    sub: 'idp_sub_admin',
    useRogueKey: true,
  });
  const forgedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${forged}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(forgedRes.status, 401);

  const expired = await issueOAuthJwt({
    sub: 'idp_sub_admin',
    expiresInSec: -60,
  });
  const expiredRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${expired}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(expiredRes.status, 401);

  const wrongAud = await issueOAuthJwt({
    sub: 'idp_sub_admin',
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

  const wrongIss = await issueOAuthJwt({
    sub: 'idp_sub_admin',
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

  const wrongScope = await issueOAuthJwt({
    sub: 'idp_sub_admin',
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

test('4. Unlinked OAuth user, unverified link, spoofed firebase_uid/email claims, locked account, and missing /users profile are rejected with 403', async () => {
  // Unlinked subject EVEN WITH matching email & forged firebase_uid claim MUST be rejected in mapping_file mode!
  const unlinkedToken = await issueOAuthJwt({
    sub: 'idp_sub_stranger',
    includeEmailClaim: true,
    extraClaims: {
      firebase_uid: 'uid_admin',
      'https://duan.banghadengiacngo.io.vn/firebase_uid': 'uid_admin',
    },
  });
  const unlinkedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${unlinkedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(unlinkedRes.status, 403);
  const unlinkedBody = (await unlinkedRes.json()) as { error: string };
  assert.equal(unlinkedBody.error, 'oauth_identity_not_linked');

  // Unverified link (`verifiedByAdmin: false`) MUST be rejected!
  const unverifiedLinkToken = await issueOAuthJwt({
    sub: 'idp_sub_unverified',
  });
  const unverifiedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${unverifiedLinkToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(unverifiedRes.status, 403);

  // Locked user (`isActive: false`) -> 403
  const lockedToken = await issueOAuthJwt({ sub: 'idp_sub_locked' });
  const lockedRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lockedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(lockedRes.status, 403);

  // Missing `/users/{uid}` -> 403
  const missingProfileToken = await issueOAuthJwt({
    sub: 'idp_sub_missing_profile',
  });
  const missingProfileRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${missingProfileToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(missingProfileRes.status, 403);

  // Dual verification (`both_strict`) blocks mismatch between server map and IdP claim
  const strictLinker = createOAuthIdentityLinker({
    issuer: OAUTH_ISSUER,
    audience: mcpUrl,
    requiredScope: 'mcp:read',
    identityLinkMode: 'both_strict',
    uidClaim: 'firebase_uid',
    uidMapJson: FIXTURE_IDENTITY_LINKS,
    proxyAsMetadata: false,
  });
  assert.throws(
    () =>
      strictLinker.resolveFirebaseUid({
        issuer: OAUTH_ISSUER,
        subject: 'idp_sub_member',
        claims: { firebase_uid: 'uid_admin' }, // Attempted privilege escalation!
      }),
    /không khớp/
  );
  assert.equal(
    strictLinker.resolveFirebaseUid({
      issuer: OAUTH_ISSUER,
      subject: 'idp_sub_member',
      claims: { firebase_uid: 'uid_member' },
    }),
    'uid_member'
  );
});

test('5. DNS rebinding protection rejects disallowed Origin and stateless GET/DELETE return 405', async () => {
  const token = await issueOAuthJwt({ sub: 'idp_sub_admin' });

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

test('6. Real MCP Client initialize & tools/list returns strictly 6 read-only tools and whoami ignores spoofed arguments', async () => {
  const token = await issueOAuthJwt({
    sub: 'idp_sub_admin',
    includeEmailClaim: true,
  });
  const { client, transport } = await createConnectedMcpClient(mcpUrl, token);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...MCP_READ_ONLY_TOOL_NAMES].sort());
    assert.equal(listed.tools.length, 6);

    for (const tool of listed.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
    }

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

test('7. get_project_summary excludes archived/B1 test tasks, keeps status=null separate, and deduplicates overdue+pending', async () => {
  const token = await issueOAuthJwt({ sub: 'idp_sub_admin' });
  const { client, transport } = await createConnectedMcpClient(mcpUrl, token);
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

    assert.equal(data.totalTasks, 8);
    assert.equal(data.parentTasksCount, 6);
    assert.equal(data.childTasksCount, 2);
    assert.equal(data.statusCounts.inProgress, 2);
    assert.equal(data.statusCounts.pendingApproval, 2);
    assert.equal(data.statusCounts.paused, 1);
    assert.equal(data.statusCounts.completed, 1);
    assert.equal(data.statusCounts.notStarted, 1);
    assert.equal(data.statusCounts.missingStatus, 1);

    const sum = Object.values(data.statusCounts).reduce((a, b) => a + b, 0);
    assert.equal(sum, data.totalTasks);

    assert.equal(data.overdueCount, 1);
    assert.equal(data.overlapOverdueAndPendingCount, 1);
    assert.equal(data.watchlistUniqueCount, 2);
    assert.equal(data.actionableApprovalsForMeCount, 2);
    assert.equal(data.needsReviewCount, 2);
    assert.equal(data.documentsCount.total, 4);
    assert.equal(data.documentsCount.reference, 2);
    assert.equal(data.documentsCount.result, 2);
  } finally {
    await transport.close();
    await client.close();
  }
});

test('8. list_tasks filtering, status=missing_status, pagination cursor, and official assignee resolution', async () => {
  const token = await issueOAuthJwt({ sub: 'idp_sub_member' });
  const { client, transport } = await createConnectedMcpClient(mcpUrl, token);
  try {
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

test('9. get_task returns parent/child/separated links, handles ambiguous displayCode safely, and hides archived/test tasks', async () => {
  const token = await issueOAuthJwt({ sub: 'idp_sub_mod' });
  const { client, transport } = await createConnectedMcpClient(mcpUrl, token);
  try {
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

    const archivedRes = (
      await client.callTool({
        name: 'get_task',
        arguments: { taskId: 'tbhgn_archived_99' },
      })
    ).structuredContent as { lookupStatus: string };
    assert.equal(archivedRes.lookupStatus, 'not_found');

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

test('10. search_documents strictly separates reference vs result and excludes archived task links', async () => {
  const token = await issueOAuthJwt({ sub: 'idp_sub_viewer' });
  const { client, transport } = await createConnectedMcpClient(mcpUrl, token);
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

test('11. list_pending_approvals enforces RBAC across Admin/Moderator vs Member/Viewer', async () => {
  const adminToken = await issueOAuthJwt({ sub: 'idp_sub_admin' });
  const adminConn = await createConnectedMcpClient(mcpUrl, adminToken);
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

  const memberToken = await issueOAuthJwt({ sub: 'idp_sub_member' });
  const memberConn = await createConnectedMcpClient(mcpUrl, memberToken);
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

  const viewerToken = await issueOAuthJwt({ sub: 'idp_sub_viewer' });
  const viewerConn = await createConnectedMcpClient(mcpUrl, viewerToken);
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

test('12. End-to-End V1.1 Firestore Read Bridge: OAuth JWT -> Identity Link -> RS256 SA Token Exchange -> Named DB GET-only -> Server RBAC & Zero PII', async () => {
  // Generate ephemeral RSA keypair simulating a least-privilege roles/datastore.viewer Service Account
  const saKeys = await generateKeyPair('RS256', { extractable: true });
  const saPrivatePem = await exportPKCS8(saKeys.privateKey);
  const saEmail = 'tbhgn-mcp-firestore-ro@gen-lang-client-0491463422.iam.gserviceaccount.com';
  const issuedBridgeToken = 'gcp-short-lived-ro-token-xyz';

  let tokenExchangeCalls = 0;
  let forceTokenFailure = false;
  const recordedFirestoreCalls: Array<{
    method: string;
    path: string;
    authHeader: string;
  }> = [];

  // Mock Google OAuth2 Token Server + Mock Firestore REST API v1 + Mock IdP Discovery
  const mockCloudApp = express();
  mockCloudApp.use(express.urlencoded({ extended: false }));

  let mockCloudBase = '';

  // 1. Mock genuine IdP discovery endpoint
  mockCloudApp.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: mockCloudBase,
      authorization_endpoint: `${mockCloudBase}/authorize`,
      token_endpoint: `${mockCloudBase}/oauth/token`,
      jwks_uri: `${mockCloudBase}/.well-known/jwks.json`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });
  });

  // 2. Mock Google OAuth2 Token Exchange endpoint (verifies RS256 JWT assertion cryptographically!)
  mockCloudApp.post('/google-oauth2-token', async (req, res) => {
    tokenExchangeCalls += 1;
    if (forceTokenFailure) {
      res.status(500).json({ error: 'temporarily_unavailable' });
      return;
    }
    const grantType = req.body.grant_type;
    const assertion = req.body.assertion;
    assert.equal(grantType, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.equal(typeof assertion, 'string');

    const { payload } = await jwtVerify(assertion, saKeys.publicKey, {
      issuer: saEmail,
      audience: `${mockCloudBase}/google-oauth2-token`,
      algorithms: ['RS256'],
    });
    assert.equal(payload.scope, FIRESTORE_REST_OAUTH_SCOPE);

    res.json({
      access_token: issuedBridgeToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  // 3. Mock Firestore REST API v1 (strictly checks exact named DB path, GET-only, and bridge Bearer token!)
  const expectedPrefix = `/v1/projects/${EXPECTED_PROJECT_ID}/databases/${EXPECTED_DB_ID}/documents`;
  mockCloudApp.use('/v1', (req, res) => {
    recordedFirestoreCalls.push({
      method: req.method,
      path: `/v1${req.path}`,
      authHeader: req.headers.authorization ?? '',
    });
    assert.equal(req.method, 'GET', 'Firestore Read Bridge MUST only send GET!');
    assert.equal(
      req.headers.authorization,
      `Bearer ${issuedBridgeToken}`,
      'Firestore MUST receive bridge token, never external OAuth JWT!'
    );
    assert.ok(
      `/v1${req.path}`.startsWith(expectedPrefix),
      `Unexpected Firestore DB path: /v1${req.path}`
    );

    const subPath = `/v1${req.path}`.slice(expectedPrefix.length);

    if (subPath === '/users/uid_member') {
      res.json({
        name: `${expectedPrefix}/users/uid_member`,
        fields: {
          displayName: { stringValue: 'Khánh' },
          email: { stringValue: SECRET_EMAIL_SENTINEL },
          sheetAlias: { stringValue: 'Khanh_Secret_Alias' },
          role: { stringValue: 'member' },
          canApprove: { booleanValue: false },
          isActive: { booleanValue: true },
        },
      });
      return;
    }
    if (subPath === '/memberDirectory') {
      res.json({
        documents: [
          {
            name: `${expectedPrefix}/memberDirectory/uid_member`,
            fields: {
              displayName: { stringValue: 'Khánh' },
              isActive: { booleanValue: true },
            },
          },
          {
            name: `${expectedPrefix}/memberDirectory/uid_admin`,
            fields: {
              displayName: { stringValue: 'Sư Phụ' },
              isActive: { booleanValue: true },
            },
          },
        ],
      });
      return;
    }
    if (subPath === '/categories') {
      res.json({
        documents: [
          {
            name: `${expectedPrefix}/categories/cat_outline`,
            fields: {
              name: { stringValue: 'Đề cương' },
              color: { stringValue: '#13294B' },
              sortOrder: { integerValue: '1' },
              isActive: { booleanValue: true },
            },
          },
        ],
      });
      return;
    }
    if (subPath === '/tasks') {
      res.json({
        documents: [
          {
            name: `${expectedPrefix}/tasks/tbhgn_live_1`,
            fields: {
              displayCode: { stringValue: '1' },
              parentId: { nullValue: null },
              sortOrder: { integerValue: '1' },
              title: { stringValue: 'Nhiệm vụ qua cầu nối Firestore' },
              categoryId: { stringValue: 'cat_outline' },
              category: { stringValue: 'Đề cương' },
              assigneeUids: {
                arrayValue: { values: [{ stringValue: 'uid_member' }] },
              },
              assignees: {
                arrayValue: { values: [{ stringValue: 'Khánh' }] },
              },
              status: { stringValue: 'Chờ duyệt' },
              version: { integerValue: '1' },
            },
          },
        ],
      });
      return;
    }

    res.status(404).json({ error: 'NOT_FOUND' });
  });

  const mockCloudServer = await new Promise<ReturnType<express.Express['listen']>>(
    (resolve) => {
      const s = mockCloudApp.listen(0, '127.0.0.1', () => resolve(s));
    }
  );
  const cloudAddr = mockCloudServer.address() as AddressInfo;
  mockCloudBase = `http://127.0.0.1:${cloudAddr.port}`;

  // Mount a dedicated V1.1 MCP app wired with the REAL Firestore Read Bridge (NO mock repo!)
  const bridgeApp = express();
  const bridgeServer = await new Promise<ReturnType<express.Express['listen']>>(
    (resolve) => {
      const s = bridgeApp.listen(0, '127.0.0.1', () => resolve(s));
    }
  );
  const bridgeAddr = bridgeServer.address() as AddressInfo;
  const bridgeMcpUrl = `http://127.0.0.1:${bridgeAddr.port}/mcp`;

  try {
    // Verify genuine IdP AS metadata discovery
    const discovered = await discoverAuthorizationServerMetadata(mockCloudBase, {
      allowLocalhostHttp: true,
    });
    assert.equal(discovered.issuer, mockCloudBase);
    assert.equal(discovered.client_id_metadata_document_supported, true);

    const bridgeConfig = loadMcpConfig({
      firebaseProjectId: EXPECTED_PROJECT_ID,
      firestoreDatabaseId: EXPECTED_DB_ID,
      env: {
        NODE_ENV: 'test',
        MCP_ENABLED: 'true',
        MCP_PUBLIC_URL: bridgeMcpUrl,
        MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
        MCP_ALLOWED_ORIGINS: '127.0.0.1,localhost',
        MCP_OAUTH_ISSUER: mockCloudBase,
        MCP_OAUTH_AUDIENCE: bridgeMcpUrl,
        MCP_OAUTH_REQUIRED_SCOPE: 'mcp:read',
        MCP_OAUTH_IDENTITY_LINK_MODE: 'mapping_file',
        MCP_OAUTH_UID_MAP_JSON: JSON.stringify({
          version: 1,
          links: [
            {
              issuer: mockCloudBase,
              sub: 'chatgpt_user_khanh',
              firebaseUid: 'uid_member',
              verifiedByAdmin: true,
            },
          ],
        }),
        MCP_OAUTH_PROXY_AS_METADATA: 'true',
        MCP_FIRESTORE_BRIDGE_MODE: 'service_account_file',
        MCP_RATE_LIMIT_PER_MIN: '300',
      },
    });

    const realBridge = createFirestoreReadBridge(bridgeConfig.firestoreBridge, {
      allowLoopbackTokenEndpoint: true,
      testServiceAccount: {
        clientEmail: saEmail,
        privateKeyPem: saPrivatePem,
        tokenUri: `${mockCloudBase}/google-oauth2-token`,
      },
    });
    assert.equal(realBridge.ready, true);

    mountMcpServer(bridgeApp, {
      config: bridgeConfig,
      verifier: createMcpTokenVerifier(bridgeConfig, {
        oauthJwks: localJwks,
        allowLocalhostDiscovery: true,
      }),
      firestoreBridge: realBridge,
      allowLocalhostDiscovery: true,
      firestoreApiBaseUrlOverride: `${mockCloudBase}/v1`,
      referenceDate: REFERENCE_DATE,
      auditLogger: (entry) => auditLogs.push(entry),
    });

    // Optional verbatim AS metadata proxy returns genuine IdP metadata
    const proxiedAsMeta = await fetch(
      `http://127.0.0.1:${bridgeAddr.port}/.well-known/oauth-authorization-server`
    );
    assert.equal(proxiedAsMeta.status, 200);
    const proxiedJson = (await proxiedAsMeta.json()) as Record<string, unknown>;
    assert.equal(proxiedJson.issuer, mockCloudBase);
    assert.equal(proxiedJson.authorization_endpoint, `${mockCloudBase}/authorize`);

    // Connect real MCP Client with OAuth JWT -> full bridge -> mock Firestore REST API v1!
    const memberOAuthJwt = await issueOAuthJwt({
      sub: 'chatgpt_user_khanh',
      issuer: mockCloudBase,
      audience: bridgeMcpUrl,
      includeEmailClaim: true,
    });

    const { client, transport } = await createConnectedMcpClient(
      bridgeMcpUrl,
      memberOAuthJwt
    );
    try {
      const whoami = await client.callTool({ name: 'whoami', arguments: {} });
      const whoamiData = whoami.structuredContent as Record<string, unknown>;
      assert.equal(whoamiData.uid, 'uid_member');
      assert.equal(whoamiData.displayName, 'Khánh');
      assert.equal(whoamiData.role, 'member');
      assert.ok(!JSON.stringify(whoami).includes(SECRET_EMAIL_SENTINEL));
      assert.ok(!JSON.stringify(whoami).includes(issuedBridgeToken));

      const summary = await client.callTool({
        name: 'get_project_summary',
        arguments: {},
      });
      const summaryData = summary.structuredContent as {
        totalTasks: number;
        statusCounts: { pendingApproval: number };
        actionableApprovalsForMeCount: number;
      };
      assert.equal(summaryData.totalTasks, 1);
      assert.equal(summaryData.statusCounts.pendingApproval, 1);
      // Server-side RBAC: Member cannot approve!
      assert.equal(summaryData.actionableApprovalsForMeCount, 0);

      // Verify token was cached (only 1 token exchange for multiple requests!)
      assert.equal(tokenExchangeCalls, 1);

      // Verify Member NEVER listed `/users` collection — only `/users/uid_member` + `/memberDirectory`!
      const calledPaths = recordedFirestoreCalls.map((c) =>
        c.path.slice(expectedPrefix.length)
      );
      assert.ok(calledPaths.includes('/users/uid_member'));
      assert.ok(calledPaths.includes('/memberDirectory'));
      assert.ok(!calledPaths.includes('/users'));
      assert.ok(recordedFirestoreCalls.every((c) => c.method === 'GET'));
    } finally {
      await transport.close();
      await client.close();
    }

    // Fail-closed test: disabled bridge returns 503 and never reads Firestore unauthenticated
    const disabledBridge = createFirestoreReadBridge({ mode: 'disabled' });
    assert.equal(disabledBridge.ready, false);
    await assert.rejects(
      () => disabledBridge.getAccessToken(),
      /chưa được bật/
    );

    // Fail-closed test: token exchange HTTP 500 throws 503 McpFirestoreBridgeError
    forceTokenFailure = true;
    const failingBridge = createFirestoreReadBridge(
      bridgeConfig.firestoreBridge,
      {
        allowLoopbackTokenEndpoint: true,
        testServiceAccount: {
          clientEmail: saEmail,
          privateKeyPem: saPrivatePem,
          tokenUri: `${mockCloudBase}/google-oauth2-token`,
        },
      }
    );
    await assert.rejects(
      () => failingBridge.getAccessToken(),
      /Không thể trao đổi access token/
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      bridgeServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      mockCloudServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test('13. FirestoreReadRepository exposes strictly read-only methods and audit logs contain zero PII/tokens', () => {
  const restRepo = createFirestoreReadRepository({
    projectId: EXPECTED_PROJECT_ID,
    databaseId: EXPECTED_DB_ID,
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
  assert.ok(!serializedLogs.includes('gcp-short-lived-ro-token'));
});
