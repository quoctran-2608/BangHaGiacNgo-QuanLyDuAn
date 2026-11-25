import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { verifyFirebaseIdToken as verifyFirebaseIdTokenShared } from './server/mcp/auth.js';
import { loadMcpConfig } from './server/mcp/config.js';
import { mountMcpServer } from './server/mcp/router.js';

dotenv.config();

interface FirebaseConfigFile {
  projectId: string;
  firestoreDatabaseId?: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig: FirebaseConfigFile = JSON.parse(
  fs.readFileSync(configPath, 'utf8')
);

const BOOTSTRAP_ADMIN_EMAIL = (
  process.env.BOOTSTRAP_ADMIN_EMAIL || 'ngaothuyet2023@gmail.com'
)
  .trim()
  .toLowerCase();

async function verifyFirebaseIdToken(idToken: string) {
  return verifyFirebaseIdTokenShared(idToken, firebaseConfig.projectId);
}

async function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Mount Read-Only MCP V1.0 Server (`/mcp`, `/.well-known/oauth-*`, `/api/mcp/health`)
  // Mounted before global JSON parser so `/mcp` applies Host/Origin/rate-limit checks first.
  const mcpConfig = loadMcpConfig({
    firebaseProjectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  });
  mountMcpServer(app, { config: mcpConfig });

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId ?? '(default)',
    });
  });

  app.post('/api/auth/verify-session', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!token) {
        res.status(401).json({ error: 'Thiếu Firebase ID Token.' });
        return;
      }
      const verified = await verifyFirebaseIdToken(token);
      res.json({
        verified: true,
        uid: verified.uid,
        email: verified.email,
        emailVerified: verified.emailVerified,
        isBootstrapOwner: verified.email === BOOTSTRAP_ADMIN_EMAIL,
      });
    } catch (error) {
      res.status(401).json({
        verified: false,
        error: error instanceof Error ? error.message : 'Xác minh token thất bại.',
      });
    }
  });

  app.post('/api/auth/verify-bootstrap', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!token) {
        res.status(401).json({ error: 'Thiếu Firebase ID Token.' });
        return;
      }
      const verified = await verifyFirebaseIdToken(token);
      if (verified.email !== BOOTSTRAP_ADMIN_EMAIL) {
        res.status(403).json({
          allowed: false,
          error:
            'Tài khoản này không phải chủ dự án được chỉ định để khởi tạo Quản trị viên đầu tiên.',
        });
        return;
      }
      res.json({
        allowed: true,
        uid: verified.uid,
        email: verified.email,
        role: 'admin',
        canApprove: true,
      });
    } catch (error) {
      res.status(401).json({
        allowed: false,
        error: error instanceof Error ? error.message : 'Xác minh token thất bại.',
      });
    }
  });

  app.get('/api/admin/official-import-source', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!token) {
        res.status(401).json({ error: 'Yêu cầu đăng nhập Quản trị viên.' });
        return;
      }
      const verified = await verifyFirebaseIdToken(token);
      const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
      const userDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseConfig.projectId
      )}/databases/${encodeURIComponent(dbId)}/documents/users/${encodeURIComponent(
        verified.uid
      )}`;
      const userResp = await fetch(userDocUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!userResp.ok) {
        res.status(403).json({
          error: 'Chỉ Quản trị viên đang hoạt động mới được truy cập dữ liệu nguồn.',
        });
        return;
      }
      const userDoc = (await userResp.json()) as {
        fields?: {
          role?: { stringValue?: string };
          isActive?: { booleanValue?: boolean };
        };
      };
      const isAdmin =
        userDoc.fields?.role?.stringValue === 'admin' &&
        userDoc.fields?.isActive?.booleanValue === true;
      if (!isAdmin) {
        res.status(403).json({
          error: 'Chỉ Quản trị viên đang hoạt động mới được truy cập dữ liệu nguồn.',
        });
        return;
      }

      const sourcePath = path.resolve(
        process.cwd(),
        'server_data',
        'TBHGN_du_lieu_20_cong_viec_da_khoi_phuc_URL_38662941.json'
      );
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({
          error:
            'Tệp JSON nguồn đã được gỡ bỏ khỏi máy chủ sau khi nhập hoàn tất lên Firestore.',
        });
        return;
      }
      const rawJson = fs.readFileSync(sourcePath, 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(rawJson);
    } catch (error) {
      res.status(401).json({
        error:
          error instanceof Error
            ? error.message
            : 'Không thể xác minh quyền Quản trị viên.',
      });
    }
  });

  // Ensure unmatched /api/* endpoints return JSON 404 instead of falling through to SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint không tồn tại.' });
  });

  // Block direct HTTP access to server-only data, env, deploy templates, and rules/config files
  app.use((req, res, next) => {
    const reqPath = req.path.toLowerCase();
    if (reqPath === '/.env' || reqPath.startsWith('/.env.')) {
      res.status(403).json({ error: 'Truy cập bị từ chối.' });
      return;
    }
    next();
  });

  const isProd = process.env.NODE_ENV === 'production';

  app.use(
    [
      '/server',
      '/server_data',
      '/dist-server',
      '/deploy',
      '/docs',
      '/firestore.rules',
      '/firestore.rules.backup',
      '/firestore.rules.test.ts',
      '/firebase-blueprint.json',
      '/security_spec.md',
      '/server.ts',
      '/package.json',
      '/tsconfig.json',
      '/tsconfig.server.json',
    ],
    (_req, res) => {
      res.status(403).json({ error: 'Truy cập bị từ chối.' });
    }
  );

  if (isProd) {
    app.use('/firebase-applet-config.json', (_req, res) => {
      res.status(403).json({ error: 'Truy cập bị từ chối.' });
    });

    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      throw new Error(
        'Không tìm thấy dist/index.html. Hãy chạy "npm run build" trước khi khởi động production.'
      );
    }

    app.use(
      express.static(distDir, {
        index: 'index.html',
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // Express 4 & 5 compatible SPA fallback for client-side route refreshes
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtmlPath);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  // AI Studio Preview runs dev server on 0.0.0.0; VPS production binds to HOST (e.g. 127.0.0.1 behind Nginx)
  const host = isProd ? process.env.HOST || '0.0.0.0' : '0.0.0.0';
  app.listen(port, host, () => {
    console.log(
      `TBHGN server running on http://${host}:${port} (env=${process.env.NODE_ENV || 'development'})`
    );
  });
}

createServer().catch((err) => {
  console.error('Failed to start TBHGN server:', err);
  process.exit(1);
});
