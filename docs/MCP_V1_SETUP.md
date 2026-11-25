# TBHGN — MCP Server V1.0 (Read-Only AI Integration)

Tài liệu kỹ thuật và vận hành cho **TBHGN MCP Server V1.0** — giao diện chỉ đọc theo chuẩn **Model Context Protocol (Streamable HTTP)** giúp ChatGPT và các AI Agent tương thích MCP tra cứu, phân tích dữ liệu dự án **Tu Biểu Hướng Giác Ngộ (TBHGN)** an toàn theo đúng phân quyền thành viên.

> **Nguyên tắc bất biến của V1.0:** Tuyệt đối chỉ đọc (`read-only`). Không có bất kỳ tool ghi, tạo, sửa, xóa, lưu trữ hay duyệt công việc nào trên MCP Server.

---

## 1. Kiến trúc tổng quan

TBHGN MCP Server V1.0 được tích hợp trực tiếp vào ứng dụng Express hiện có (`server.ts`) và tách mô-đun gọn gàng dưới thư mục `server/mcp/`:

- `server/mcp/types.ts`: Hợp đồng kiểu chỉ đọc (`McpReadRepository`), kiểu danh tính thành viên đã xác thực (`McpAuthenticatedActor` — không chứa email/PII), cursor phân trang có kiểm tra hợp lệ.
- `server/mcp/config.ts`: Đọc biến môi trường, ép buộc HTTPS cho OAuth IdP ngoài, thiết lập danh sách Host/Origin hợp lệ chống DNS rebinding.
- `server/mcp/auth.ts`: Xác minh mật mã cho Bearer token (OAuth 2.1 JWT qua JWKS + Firebase ID Token qua chứng chỉ công khai RS256 của Google) và đối chiếu sống với `/users/{uid}` để đảm bảo tài khoản đang hoạt động (`isActive === true`).
- `server/mcp/firestoreReadRepo.ts`: Tầng truy cập **Firestore REST API v1 thuần HTTP `GET`** tới đúng named database `ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab`, không chứa bất kỳ phương thức ghi nào.
- `server/mcp/tools.ts`: Đăng ký đúng **6 công cụ chỉ đọc** dùng lại trực tiếp logic nghiệp vụ từ `src/utils/taskHelpers.ts` (`computeOverviewStats`, `buildOverviewWatchlist`, `buildProjectDocumentEntries`, `canUserApproveTask`, `resolveTaskAssignees`, `getTaskDataReviewSummary`).
- `server/mcp/router.ts`: Gắn tuyến Streamable HTTP stateless (`/mcp`), metadata OAuth discovery (`/.well-known/oauth-*`), và endpoint kiểm tra sức khỏe (`/api/mcp/health`).

### Luồng xác thực & dữ liệu
```text
MCP Client (ChatGPT / MCP Inspector)
   │  POST https://giacngo.nhamycali.com/mcp
   │  Authorization: Bearer <token>
   ▼
Nginx (HTTPS, proxy_buffering off) ──▶ Express (127.0.0.1:3000)
   │ 1. Host & Origin validation (chống DNS rebinding)
   │ 2. Rate limit & giới hạn kích thước body (100KB)
   │ 3. Xác minh chữ ký token, iss, aud/resource, exp, scope (mcp:read)
   │ 4. Đối chiếu UID với /users/{uid} (bắt buộc tồn tại & isActive === true)
   │ 5. Tạo McpServer stateless gắn với actor hiện tại
   ▼
Firestore REST API v1 (CHỈ GET) ──▶ Named Database TBHGN
   (Member/Viewer đọc /memberDirectory; Admin/Moderator đọc /users đã loại bỏ email/PII)
```

---

## 2. Danh sách 6 công cụ chỉ đọc (V1.0)

Tất cả 6 tool đều khai báo `annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }` và trả về đồng thời tóm tắt tiếng Việt (`content`) và dữ liệu có cấu trúc (`structuredContent`):

| Tool | Mục đích | Lưu ý nghiệp vụ |
|---|---|---|
| `get_project_summary` | Tổng quan dự án: tổng việc, việc cha/con, đủ 5 trạng thái, việc thiếu trạng thái (`null`), quá hạn, chờ duyệt, watchlist không đếm trùng, số việc cần bạn duyệt, thống kê tài liệu. | Loại bỏ việc đã lưu trữ (`archivedAt`) và bản ghi thử nghiệm (`isB1TestTask`). Không gộp `status === null` vào `Chưa bắt đầu`. |
| `list_tasks` | Lọc & phân trang danh sách công việc theo `status` (gồm `missing_status`), `category`, `assigneeUid`, `query`, `level`, `parentId`, `overdueOnly`, `needsReviewOnly`, `limit` (1–50), `cursor`. | Trả về tên người phụ trách chính thức qua UID, không lộ email. |
| `get_task` | Xem chi tiết một công việc theo `taskId` hoặc `displayCode`, gồm việc cha, danh sách việc con + tiến độ, tài liệu tham khảo & kết quả tách biệt, cảnh báo dữ liệu. | Nếu `displayCode` khớp nhiều công việc đang hoạt động → trả `lookupStatus: "ambiguous"` kèm danh sách ứng viên, tuyệt đối không tự đoán. |
| `search_documents` | Tìm siêu dữ liệu liên kết tài liệu gắn với công việc theo `query`, `group` (`all`/`reference`/`result`), `taskId`, `taskCode`, `category`, `source`, `validUrlOnly`. | Tách rõ `reference` (Tham khảo) và `result` (Kết quả). Không tự tải nội dung Google Drive/file ngoài. |
| `list_pending_approvals` | Liệt kê việc `Chờ duyệt` theo `scope`: `all_visible` hoặc `actionable_by_me`. | Dùng `canUserApproveTask()` phía server để phân biệt `Cần bạn duyệt` và `Đang chờ duyệt`. Member/Viewer không có quyền duyệt luôn nhận `actionableByMeCount: 0`. |
| `whoami` | Trả về UID, tên hiển thị chính thức, vai trò, trạng thái hoạt động và năng lực MCP (`canWriteViaMcp: false`). | Không nhận tham số định danh từ AI; không bao giờ trả email, invites hay settings. |

---

## 3. Phân quyền & bảo mật

1. **Fail-closed mặc định:** Mọi request tới `/mcp` không có Bearer token, chữ ký giả, hết hạn, sai `iss`, sai `aud`/resource hoặc thiếu scope `mcp:read` đều bị từ chối (`401` kèm `WWW-Authenticate` chuẩn RFC 9728 hoặc `403`).
2. **Không tin danh tính từ tham số AI:** Mọi quyền hạn đều suy ra từ token đã xác minh chữ ký và hồ sơ `/users/{uid}` đang `isActive === true`. Tài khoản bị khóa (`isActive: false`) hoặc chưa có hồ sơ bị từ chối `403`.
3. **Bảo vệ dữ liệu cá nhân (PII):** MCP không trả `email`, `/invites`, `/settings/auth`, `sheetAlias`, token, secret hay stack trace.
4. **Bảo vệ tầng truyền tải:** Chặn Host/Origin không hợp lệ (`403`), giới hạn body `100KB` (`413`), giới hạn tần suất (`429`), timeout mỗi tool (`10s`), log kiểm toán tối giản `[TBHGN-MCP]` chỉ ghi `{ timestamp, uid, role, tool, ok, durationMs, errorCode }`.

---

## 4. Endpoints thực tế

- **MCP Streamable HTTP:** `POST https://giacngo.nhamycali.com/mcp` (stateless; `GET`/`DELETE` trả `405 Method Not Allowed`).
- **OAuth Protected Resource Metadata (RFC 9728):**
  - `GET https://giacngo.nhamycali.com/.well-known/oauth-protected-resource/mcp`
  - `GET https://giacngo.nhamycali.com/.well-known/oauth-protected-resource`
- **OAuth Authorization Server Metadata (RFC 8414):**
  - `GET https://giacngo.nhamycali.com/.well-known/oauth-authorization-server` (chỉ bật khi cấu hình `MCP_OAUTH_ISSUER`).
- **MCP Health Check:** `GET https://giacngo.nhamycali.com/api/mcp/health` (chỉ trả trạng thái an toàn, không lộ secret).

---

## 5. Biến môi trường (`.env` trên VPS)

Xem mẫu trong `.env.example` (không chứa bất kỳ bí mật nào):

| Biến | Ý nghĩa | Giá trị mẫu production |
|---|---|---|
| `MCP_ENABLED` | Bật/tắt endpoint `/mcp` | `true` |
| `MCP_PUBLIC_URL` | URL công khai chuẩn của MCP Resource | `https://giacngo.nhamycali.com/mcp` |
| `MCP_ALLOWED_HOSTS` | Danh sách Host được phép (ngăn DNS rebinding) | `giacngo.nhamycali.com` |
| `MCP_ALLOWED_ORIGINS` | Danh sách Origin trình duyệt được phép | `giacngo.nhamycali.com` |
| `MCP_ALLOW_FIREBASE_ID_TOKEN` | Cho phép xác thực bằng Firebase ID Token | `true` |
| `MCP_OAUTH_REQUIRED_SCOPE` | Scope tối thiểu bắt buộc | `mcp:read` |
| `MCP_OAUTH_ISSUER` | URL nhà cung cấp OAuth 2.1 (nếu dùng OAuth IdP ngoài) | *(để trống nếu chưa bật IdP ngoài)* |
| `MCP_OAUTH_AUDIENCE` | Audience (`aud`) kỳ vọng trong OAuth JWT | `https://giacngo.nhamycali.com/mcp` |
| `MCP_OAUTH_JWKS_URI` | URL JWKS công khai của OAuth IdP | `https://<idp>/.well-known/jwks.json` |
| `MCP_OAUTH_AUTHORIZATION_ENDPOINT` | URL Authorization Endpoint của OAuth IdP | `https://<idp>/authorize` |
| `MCP_OAUTH_TOKEN_ENDPOINT` | URL Token Endpoint của OAuth IdP | `https://<idp>/oauth/token` |
| `MCP_OAUTH_REGISTRATION_ENDPOINT` | URL Dynamic Client Registration (nếu IdP hỗ trợ) | *(tùy chọn)* |
| `MCP_OAUTH_UID_CLAIM` | Tên claim chứa Firebase UID đã ánh xạ | `firebase_uid` |
| `MCP_RATE_LIMIT_PER_MIN` | Giới hạn số request/phút mỗi IP | `60` |
| `MCP_TOOL_TIMEOUT_MS` | Timeout tối đa mỗi lần gọi tool (ms) | `10000` |

---

## 6. Triển khai & vận hành trên VPS (`giacngo.nhamycali.com`)

1. **Cập nhật `.env` trên VPS:** bổ sung các biến `MCP_*` ở bảng trên (nhất thiết giữ `HOST=127.0.0.1`, `NODE_ENV=production`, `PORT=3000`).
2. **Build bản phát hành:**
   ```bash
   npm ci
   npm run build
   ```
3. **Cập nhật Nginx** theo mẫu `deploy/nginx-tbhgn.conf` (có khối `location = /mcp` với `proxy_buffering off;` và khối `location ^~ /.well-known/oauth-`):
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **Khởi động lại dịch vụ `tbhgn`:**
   ```bash
   sudo systemctl restart tbhgn
   sudo systemctl status tbhgn --no-pager
   ```
5. **Kiểm tra sau triển khai:**
   ```bash
   curl -fsS https://giacngo.nhamycali.com/api/health
   curl -fsS https://giacngo.nhamycali.com/api/mcp/health
   curl -fsS https://giacngo.nhamycali.com/.well-known/oauth-protected-resource/mcp
   # Phải trả về HTTP 401 + header WWW-Authenticate:
   curl -i -X POST https://giacngo.nhamycali.com/mcp -H "Content-Type: application/json" -d '{}'
   ```
6. **Xem log kiểm toán MCP:**
   ```bash
   journalctl -u tbhgn -f | grep '\[TBHGN-MCP\]'
   ```
7. **Tắt nhanh / Rollback:** Đặt `MCP_ENABLED=false` trong `.env` và `sudo systemctl restart tbhgn` (tắt hoàn toàn `/mcp` trong vài giây mà không ảnh hưởng ứng dụng web).

---

## 7. Kiểm thử ngay bằng MCP Inspector (Firebase ID Token)

Chế độ **Firebase ID Token** hoạt động ngay với tài khoản Google đã đăng nhập trên ứng dụng TBHGN (và vẫn được kiểm tra đồng thời bởi cả `firestore.rules` lẫn server-side RBAC):

1. Đăng nhập vào ứng dụng web TBHGN bằng tài khoản thành viên hợp lệ.
2. Lấy Firebase ID Token hiện tại của phiên đăng nhập (tạm thời, hết hạn sau 1 giờ — tuyệt đối không chia sẻ hoặc lưu vào mã nguồn).
3. Chạy MCP Inspector hoặc client Streamable HTTP trỏ tới URL `/mcp` với header:
   - `Authorization: Bearer <FIREBASE_ID_TOKEN>`
4. Gọi lần lượt `whoami`, `get_project_summary`, `list_tasks`, `get_task`, `search_documents`, `list_pending_approvals`.

---

## 8. Kết nối ChatGPT Custom MCP (OAuth 2.1 — cần thiết lập ngoài)

ChatGPT Custom MCP yêu cầu **HTTPS công khai** và luồng **OAuth 2.1 Authorization Code + PKCE** có Discovery Metadata (RFC 9728 / RFC 8414):

1. **Chọn OAuth 2.1 Authorization Server** (ví dụ Auth0 / Keycloak / Cloudflare Access / OAuth IdP riêng hỗ trợ PKCE + scope `mcp:read` + gắn claim `firebase_uid` cho từng thành viên TBHGN đã được duyệt).
2. **Cấu hình các biến `MCP_OAUTH_*`** trên VPS theo bảng ở Mục 5.
3. **Cầu nối đọc Firestore chỉ đọc cho OAuth JWT:**
   - Khi client dùng **Firebase ID Token**, server chuyển tiếp chính token của người dùng sang Firestore REST API v1 (chạy ngay, không cần Service Account).
   - Khi client dùng **OAuth 2.1 JWT từ IdP ngoài**, Firestore không chấp nhận trực tiếp JWT của IdP ngoài. Vì lý do bảo mật (fail-closed), server hiện từ chối với mã `503 firestore_read_bridge_unconfigured` cho tới khi bạn thiết lập kênh đọc Firestore chỉ đọc (ví dụ GCP IAM role chỉ đọc `roles/datastore.viewer` trên VPS hoặc cơ chế token exchange).
4. **Khai báo Connector trên ChatGPT:**
   - Server URL: `https://giacngo.nhamycali.com/mcp`
   - Authentication: `OAuth` (ChatGPT sẽ tự đọc `/.well-known/oauth-protected-resource/mcp`)
   - Kiểm tra câu hỏi mẫu: *"Tôi đang đăng nhập vai trò gì?"*, *"Tổng quan tiến độ dự án TBHGN"*, *"Việc nào đang chờ duyệt?"*, *"Tìm tài liệu kết quả của việc 3.1"*.

---

## 9. Hạn chế hiện tại của V1.0

- **Chỉ đọc:** Không hỗ trợ tạo/cập nhật công việc, đổi trạng thái, thêm bình luận hay duyệt công việc qua MCP.
- **Không tải nội dung tệp Google Drive:** `search_documents` chỉ trả siêu dữ liệu và liên kết đã gắn trên công việc.
- **Kết nối ChatGPT OAuth 2.1 thực tế:** Cần hoàn tất cấu hình OAuth IdP ngoài + cầu nối đọc Firestore chỉ đọc + HTTPS VPS rồi kiểm thử trực tiếp trên giao diện ChatGPT.

---

## 10. Lộ trình sẵn sàng cho MCP V2.0 (Safe Write)

Kiến trúc V1 đã chuẩn bị sẵn nền tảng cho V2.0:
- Tách bạch hoàn toàn `McpReadRepository` khỏi tầng ghi tương lai (`McpWriteRepository`).
- Xác định sẵn `McpAuthenticatedActor` từ token + `/users/{uid}` để tái sử dụng kiểm tra `canUserEditTask`, `canUserApproveTask` và optimistic concurrency (`version`).
- Ghi nhận audit log theo từng tool để mở rộng sang quy trình *đề xuất thay đổi → xác nhận của người dùng → ghi kèm `activityLogs`*.
