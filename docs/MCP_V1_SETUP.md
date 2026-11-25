# TBHGN — MCP Server V1.1: Production Connectivity & ChatGPT OAuth

Tài liệu kỹ thuật và hướng dẫn triển khai **TBHGN MCP Server V1.1 (Chỉ đọc)** tại domain chính thức:

- **Ứng dụng web TBHGN:** `https://duan.banghadengiacngo.io.vn/`
- **MCP Endpoint (Streamable HTTP):** `https://duan.banghadengiacngo.io.vn/mcp`
- **MCP Health Check:** `https://duan.banghadengiacngo.io.vn/api/mcp/health`
- **OAuth Protected Resource Metadata (RFC 9728):** `https://duan.banghadengiacngo.io.vn/.well-known/oauth-protected-resource/mcp`

> **Nguyên tắc bất biến của V1.x:** Tuyệt đối chỉ đọc (`read-only`). Không có công cụ ghi/sửa/xóa/duyệt qua MCP, không thêm chatbot UI, không thay đổi schema công việc hay `firestore.rules`.

---

## 1. Sơ đồ xác thực & luồng dữ liệu V1.1

```text
ChatGPT (OAuth 2.1 + PKCE S256 + RFC 8707 resource)
   │
   ├─ 1. GET https://duan.banghadengiacngo.io.vn/.well-known/oauth-protected-resource/mcp
   │     ◀─ trả về: resource + authorization_servers: ["https://<IdP-của-bạn>"] + scopes_supported: ["mcp:read"]
   │
   ├─ 2. Đọc Discovery trực tiếp từ IdP thật (<IdP>/.well-known/oauth-authorization-server hoặc openid-configuration)
   │     Người dùng đăng nhập tại IdP → cấp Access Token JWT (aud = https://duan.banghadengiacngo.io.vn/mcp, scope = mcp:read)
   │
   └─ 3. POST https://duan.banghadengiacngo.io.vn/mcp  (Authorization: Bearer <OAuth_JWT>)
           ▼
      Nginx (HTTPS, proxy_buffering off, chuyển tiếp Authorization) ──▶ Express (127.0.0.1:3000)
           │  (a) Host/Origin validation + Rate limit + Body limit 100KB
           │  (b) Xác minh chữ ký JWT qua JWKS của IdP, kiểm tra iss, aud, exp, scope=mcp:read
           │  (c) Liên kết danh tính an toàn (issuer + sub) ──▶ Firebase UID (KHÔNG ghép theo email)
           │  (d) Firestore Read Bridge lấy short-lived Google OAuth2 token (IAM chỉ đọc roles/datastore.viewer)
           │  (e) Đọc sống /users/{uid} ──▶ kiểm tra tồn tại, isActive === true, role, canApprove
           │  (f) Thực thi 6 công cụ chỉ đọc (Server-side RBAC + loại bỏ PII/email/archived/B1 test)
           ▼
      Firestore REST API v1 (CHỈ HTTP GET) ──▶ Named Database:
      ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab
```

> **Lưu ý song song cho MCP Inspector:** Khi `MCP_ALLOW_FIREBASE_ID_TOKEN=true`, MCP Inspector vẫn có thể gửi trực tiếp **Firebase ID Token** của thành viên TBHGN (server xác minh chữ ký RS256 của Google và chuyển tiếp token đó sang Firestore REST API v1, được kiểm tra đồng thời bởi `firestore.rules` + server RBAC). Token của IdP ngoài tuyệt đối **không** được coi là Firebase ID Token.

---

## 2. Đánh giá & chọn OAuth 2.1 Identity Provider (IdP) cho TBHGN

Không tự viết OAuth Authorization Server mới. Dưới đây là so sánh các IdP uy tín phù hợp với nhóm nhỏ (5–20 thành viên) kết nối ChatGPT Custom MCP:

| IdP | Hỗ trợ PKCE + Discovery | Client Registration cho ChatGPT | Resource / Audience (`https://duan.banghadengiacngo.io.vn/mcp`) | Chi phí & vận hành | Đánh giá cho TBHGN |
|---|---|---|---|---|---|
| **WorkOS AuthKit** *(Khuyến nghị #1 nếu muốn CIMD chuẩn mới)* | Đầy đủ OAuth 2.1 + PKCE S256 + RFC 9207 (`iss`) | Hỗ trợ **CIMD** (ưu tiên hàng đầu của ChatGPT) + DCR | Hỗ trợ tốt RFC 8707 `resource` → `aud` | Gói miễn phí lớn (lên tới 1 triệu MAU), giao diện gọn | **Rất phù hợp** cho ChatGPT MCP chuẩn mới nhất |
| **Auth0** *(Khuyến nghị #2, phổ biến & dễ quản trị)* | Đầy đủ OAuth 2.1 + PKCE S256 + OIDC | Hỗ trợ DCR (bật OIDC Dynamic Application Registration) hoặc pre-registered client | Rất dễ: tạo 1 **API** có Identifier = `https://duan.banghadengiacngo.io.vn/mcp`, scope `mcp:read` | Gói miễn phí đủ dùng cho nhóm TBHGN, quản lý người dùng trực quan | **Rất dễ cấu hình**, cộng đồng lớn |
| **Stytch** | Đầy đủ OAuth 2.1 + PKCE S256 | Hỗ trợ DCR & MCP Connected Apps | Hỗ trợ chuẩn MCP audience/scope | Có gói miễn phí cho dev/nhóm nhỏ | Tốt cho ứng dụng agentic |
| **Keycloak (tự host)** | Đầy đủ OAuth 2.1 + PKCE S256 | DCR / pre-registered | Linh hoạt qua Client Scope & Audience Mapper | Miễn phí nhưng tốn RAM (~512MB–1GB) & công bảo trì trên VPS | Chỉ nên dùng nếu muốn tự chủ 100% hạ tầng |

**Nguyên tắc quan trọng về Metadata:**
- TBHGN MCP Server chỉ phục vụ **RFC 9728 Protected Resource Metadata** tại `/.well-known/oauth-protected-resource/mcp` (và `/.well-known/oauth-protected-resource`), trỏ `authorization_servers` về đúng `MCP_OAUTH_ISSUER` của IdP thật.
- Mặc định `MCP_OAUTH_PROXY_AS_METADATA=false`: TBHGN **không** tạo tài liệu `/.well-known/oauth-authorization-server` giả trên domain `duan.banghadengiacngo.io.vn`. ChatGPT sẽ đọc thẳng metadata thật từ IdP (bao gồm `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported`, `registration_endpoint`, `jwks_uri`).

---

## 3. Hướng dẫn tạo ứng dụng & cấu hình trên OAuth IdP (Mẫu Auth0 & WorkOS)

### Phương án A — Auth0 (nhanh, trực quan cho nhóm nhỏ)
1. Tạo tài khoản miễn phí tại Auth0 và tạo 1 Tenant (ví dụ `tbhgn-prod.us.auth0.com` → `MCP_OAUTH_ISSUER=https://tbhgn-prod.us.auth0.com`).
2. **Tạo API (Resource Server):**
   - Vào **Applications → APIs → Create API**.
   - **Name:** `TBHGN MCP Read-Only`
   - **Identifier (Audience):** nhập chính xác:
     ```text
     https://duan.banghadengiacngo.io.vn/mcp
     ```
   - **Signing Algorithm:** `RS256`
   - Vào tab **Permissions** của API → thêm quyền `mcp:read` (Description: `Đọc dữ liệu dự án TBHGN qua MCP`).
3. **Bật đăng ký client cho ChatGPT:**
   - Nếu dùng **DCR**: vào **Settings → Advanced → OIDC Dynamic Application Registration** → bật ON (Auth0 sẽ tự quảng bá `registration_endpoint` trong discovery document).
   - Nếu dùng **Pre-registered Client**: tạo một Application kiểu **Regular Web / Native App** (hỗ trợ PKCE S256), sao chép **Redirect URI chính xác do màn hình ChatGPT Connector cung cấp** (ví dụ `https://chatgpt.com/connector_platform_oauth_redirect` nếu IdP hỗ trợ RFC 9207 `iss`, hoặc URL chứa `callback_id` thực tế ChatGPT hiển thị — **không tự đoán**).
4. **Giới hạn người dùng:** Tắt đăng ký mở (Disable Sign Ups) trên Connection để chỉ thành viên TBHGN do Admin mời mới đăng nhập được vào IdP.

### Phương án B — WorkOS AuthKit (hỗ trợ CIMD gốc cho ChatGPT)
1. Tạo tài khoản WorkOS → bật **AuthKit** và cấu hình **MCP Authorization** (hỗ trợ CIMD).
2. Khai báo Resource/Audience `https://duan.banghadengiacngo.io.vn/mcp` và scope `mcp:read`.
3. Lấy giá trị **Issuer URL** chính xác từ WorkOS đặt vào `MCP_OAUTH_ISSUER`.
4. Kiểm tra bằng `curl`:
   ```bash
   curl -fsS "<MCP_OAUTH_ISSUER>/.well-known/oauth-authorization-server" | jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri, code_challenge_methods_supported, registration_endpoint, client_id_metadata_document_supported}'
   ```

---

## 4. Liên kết an toàn danh tính OAuth với Firebase UID

TBHGN **tuyệt đối không** ghép tài khoản dựa trên email giống nhau và **không** tin `firebase_uid` do AI/client truyền tùy ý.

Máy chủ hỗ trợ 3 chế độ qua `MCP_OAUTH_IDENTITY_LINK_MODE`:

1. **`mapping_file` *(Khuyến nghị mặc định — an toàn nhất, dùng được với mọi IdP)*:**
   - Tạo file ánh xạ ngoài thư mục webroot trên VPS, ví dụ `/etc/tbhgn/mcp-oauth-links.json`:
     ```bash
     sudo mkdir -p /etc/tbhgn
     sudo nano /etc/tbhgn/mcp-oauth-links.json
     ```
   - Mẫu nội dung (chỉ các mục có `"verifiedByAdmin": true` mới được chấp nhận):
     ```json
     {
       "version": 1,
       "links": [
         {
           "issuer": "https://<ISSUER_IDP_CUA_BAN>",
           "sub": "<GIA_TRI_SUB_TU_IDP_CUA_THANH_VIEN>",
           "firebaseUid": "<FIREBASE_UID_TRONG_COLLECTION_USERS>",
           "verifiedByAdmin": true,
           "linkedAt": "2026-11-25T00:00:00Z"
         }
       ]
     }
     ```
   - Khóa quyền file để chỉ user dịch vụ đọc được:
     ```bash
     sudo chown www-data:www-data /etc/tbhgn/mcp-oauth-links.json
     sudo chmod 600 /etc/tbhgn/mcp-oauth-links.json
     ```
   - Cách lấy chính xác cặp `(sub, firebaseUid)`:
     - `firebaseUid`: lấy trực tiếp từ Firestore collection `/users` (Document ID) trong dự án `gen-lang-client-0491463422`.
     - `sub`: lấy từ trang quản lý Users của IdP sau khi thành viên đăng nhập xác nhận tài khoản của chính họ (ví dụ `auth0|...` hoặc `user_01...`).
2. **`idp_claim`:** Chỉ tin claim đã được IdP ký (ví dụ `https://duan.banghadengiacngo.io.vn/firebase_uid` gán bởi Admin qua Auth0 `app_metadata` + Post-Login Action).
3. **`both_strict` *(Mức bảo mật cao nhất)*:** Bắt buộc **cả** file mapping trên server **lẫn** claim do IdP ký đều phải tồn tại và trùng khớp cùng 1 `firebaseUid`.

Trên **mọi request**, sau khi tìm ra `firebaseUid`, backend vẫn kiểm tra lại trực tiếp trong `/users/{uid}`: hồ sơ phải tồn tại, `isActive === true`, đúng `role` (`admin`/`moderator`/`member`/`viewer`), đúng `canApprove` và scope `mcp:read`.

---

## 5. Cấu hình IAM & Firestore Read Bridge (Chỉ đọc)

Khi ChatGPT gọi bằng OAuth JWT từ IdP ngoài, Firestore không nhận trực tiếp JWT của IdP ngoài. **Firestore Read Bridge (`server/mcp/firestoreBridge.ts`)** giải quyết điểm này an toàn theo nguyên tắc tối thiểu quyền:

- **Quyền IAM chỉ đọc:** Service Account trên Google Cloud chỉ được cấp duy nhất role **`roles/datastore.viewer`** (Cloud Datastore Viewer — **tuyệt đối không cấp `datastore.user`, `Editor` hay `Owner`**).
- **Mã nguồn chỉ gọi HTTP `GET`:** `server/mcp/firestoreReadRepo.ts` chỉ gửi `GET` tới đúng named database `ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab`.
- **Server tự thực thi RBAC:** Vì IAM server credentials không đi qua client `firestore.rules`, backend TBHGN tự kiểm tra `/users/{uid}`, tách `/memberDirectory` cho Member/Viewer, loại bỏ `email`/`sheetAlias`, và áp dụng `canUserApproveTask()` cho từng công việc.

### Kiểm tra điều kiện tiên quyết trên Google Cloud (`gen-lang-client-0491463422`)
> **Lưu ý quan trọng về Starter Tier:** Nếu project `gen-lang-client-0491463422` hiện vẫn đang là dự án Google-hosted (AI Studio Starter Tier), Google Cloud chưa cho phép tạo Service Account / gán IAM role trực tiếp trên dự án đó. Bạn cần nâng cấp ("Upgrade / Grow out") dự án lên dự án Google Cloud chuẩn thuộc quyền quản lý của bạn (gắn Billing Account; tài liệu: https://docs.cloud.google.com/docs/starter-tier) tại https://console.cloud.google.com/welcome rồi mới thực hiện các bước IAM bên dưới.

### Hai chế độ cầu nối được hỗ trợ
1. **Chế độ `metadata` *(Khuyến nghị nếu VPS chạy trên Google Cloud VM / Compute Engine / Cloud Run — KHÔNG cần file khóa dài hạn)*:**
   - Gắn Service Account có duy nhất role `roles/datastore.viewer` vào VM/service trên GCP.
   - Trong `.env`: đặt `MCP_FIRESTORE_BRIDGE_MODE=metadata`.
2. **Chế độ `service_account_file` *(Dùng cho VPS ngoài GCP như DigitalOcean / Hetzner / Vultr / VPS Việt Nam)*:**
   - Mở Google Cloud Console → Project `gen-lang-client-0491463422` → **IAM & Admin → Service Accounts → Create Service Account**.
   - Tên gợi ý: `tbhgn-mcp-firestore-ro`.
   - Bước **Grant access**: chọn duy nhất role **`Cloud Datastore Viewer` (`roles/datastore.viewer`)**.
   - Tạo JSON key → tải về máy → chép lên VPS vào đường dẫn **ngoài webroot**: `/etc/tbhgn/firestore-readonly-sa.json`.
   - Khóa quyền truy cập tuyệt đối (không bao giờ commit lên Git hay đặt trong `/var/www/tbhgn`!):
     ```bash
     sudo chown www-data:www-data /etc/tbhgn/firestore-readonly-sa.json
     sudo chmod 600 /etc/tbhgn/firestore-readonly-sa.json
     ```
   - Trong `.env`:
     ```env
     MCP_FIRESTORE_BRIDGE_MODE=service_account_file
     MCP_FIRESTORE_CREDENTIALS_FILE=/etc/tbhgn/firestore-readonly-sa.json
     ```

Nếu bridge chưa cấu hình hoặc lỗi lấy token, server **fail-closed** (`503 firestore_read_bridge_unconfigured` / `503 firestore_read_bridge_unavailable`) và không bao giờ đọc Firestore khi chưa xác thực.

---

## 6. Biến môi trường Production (`/var/www/tbhgn/.env`)

Xem mẫu đầy đủ (không chứa secret) tại `.env.example`:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
APP_URL=https://duan.banghadengiacngo.io.vn
BOOTSTRAP_ADMIN_EMAIL=ngaothuyet2023@gmail.com

MCP_ENABLED=true
MCP_PUBLIC_URL=https://duan.banghadengiacngo.io.vn/mcp
MCP_ALLOWED_HOSTS=duan.banghadengiacngo.io.vn
MCP_ALLOWED_ORIGINS=duan.banghadengiacngo.io.vn
MCP_ALLOW_FIREBASE_ID_TOKEN=true
MCP_OAUTH_REQUIRED_SCOPE=mcp:read

MCP_OAUTH_ISSUER=https://<ISSUER_IDP_THUC_TE>
MCP_OAUTH_AUDIENCE=https://duan.banghadengiacngo.io.vn/mcp
MCP_OAUTH_JWKS_URI=

MCP_OAUTH_IDENTITY_LINK_MODE=mapping_file
MCP_OAUTH_UID_MAP_FILE=/etc/tbhgn/mcp-oauth-links.json
MCP_OAUTH_UID_CLAIM=https://duan.banghadengiacngo.io.vn/firebase_uid
MCP_OAUTH_PROXY_AS_METADATA=false

MCP_FIRESTORE_BRIDGE_MODE=service_account_file
MCP_FIRESTORE_CREDENTIALS_FILE=/etc/tbhgn/firestore-readonly-sa.json

MCP_RATE_LIMIT_PER_MIN=60
MCP_TOOL_TIMEOUT_MS=10000
```

> Nếu không cần dùng MCP Inspector với Firebase ID Token trên production sau khi ChatGPT OAuth chạy ổn định, có thể đặt `MCP_ALLOW_FIREBASE_ID_TOKEN=false`.

---

## 7. Cập nhật Nginx an toàn trên VPS (`duan.banghadengiacngo.io.vn`)

> **Không giả định file mẫu trong repo giống hệt cấu hình đang chạy trên VPS.** Luôn kiểm tra và sao lưu trước!

```bash
# 1. Xem các file site Nginx đang bật
sudo ls -la /etc/nginx/sites-enabled/
sudo nginx -T | grep -n "duan.banghadengiacngo.io.vn"

# 2. Sao lưu file cấu hình hiện tại (thay <ten_file> bằng file thực tế)
sudo cp /etc/nginx/sites-available/<ten_file> /etc/nginx/sites-available/<ten_file>.bak.$(date +%Y%m%d%H%M)

# 3. Đối chiếu với mẫu trong repo
diff -u /etc/nginx/sites-available/<ten_file> /var/www/tbhgn/deploy/nginx-tbhgn.conf || true
```

Bảo đảm trong khối `server { listen 443 ssl; server_name duan.banghadengiacngo.io.vn; ... }` có đủ:
- Khối chặn `403` cho `/server/`, `/server_data`, `/dist-server`, `/deploy`, `/docs/`, `/.env`, file `*.json` nhạy cảm.
- Khối `location ^~ /.well-known/oauth-` proxy tới `http://127.0.0.1:3000`.
- Khối `location = /mcp` proxy tới `http://127.0.0.1:3000/mcp` với `proxy_set_header Authorization $http_authorization;`, `proxy_pass_header Authorization;`, `proxy_buffering off;`, `proxy_cache off;`, `client_max_body_size 128k;`, `proxy_read_timeout 120s;`.
- Giữ nguyên `location ^~ /.well-known/acme-challenge/` và `location /` (với `Cross-Origin-Opener-Policy "same-origin-allow-popups"` cho Firebase Login).

Kiểm tra và tải lại Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Build và khởi động lại dịch vụ TBHGN:
```bash
cd /var/www/tbhgn
npm ci
npm run build
sudo systemctl restart tbhgn
```

Kiểm tra nhanh từ terminal:
```bash
curl -fsS https://duan.banghadengiacngo.io.vn/api/health
curl -fsS https://duan.banghadengiacngo.io.vn/api/mcp/health
curl -fsS https://duan.banghadengiacngo.io.vn/.well-known/oauth-protected-resource/mcp
# Phải trả 401 + WWW-Authenticate trỏ về /.well-known/oauth-protected-resource/mcp:
curl -i -X POST https://duan.banghadengiacngo.io.vn/mcp -H "Content-Type: application/json" -d '{}'
```

---

## 8. Thêm TBHGN Custom MCP Server vào ChatGPT

1. Mở ChatGPT → **Settings → Apps & Connectors** (hoặc **Developer Mode / Custom Connectors** tùy gói tài khoản ChatGPT của bạn).
2. Chọn **Create / Add Custom MCP Server**:
   - **Name:** `TBHGN Project (Read-Only)`
   - **MCP Server URL:** `https://duan.banghadengiacngo.io.vn/mcp`
   - **Authentication:** `OAuth`
   - Nếu ChatGPT hiển thị sẵn Redirect URI cần khai báo (trong trường hợp IdP dùng Pre-registered client thay vì CIMD/DCR), hãy sao chép chính xác URI đó vào danh sách Allowed Callback URLs của IdP.
3. Lưu kết nối → nhấn **Connect / Sign in** → đăng nhập bằng tài khoản thành viên trên IdP → chấp nhận quyền `mcp:read`.

---

## 9. Thử nghiệm 6 công cụ chỉ đọc (ChatGPT & MCP Inspector)

Các công cụ sẵn có (tất cả đều `readOnlyHint: true`):
`whoami`, `get_project_summary`, `list_tasks`, `get_task`, `search_documents`, `list_pending_approvals`.

Câu hỏi mẫu thử ngay trên ChatGPT sau khi kết nối:
1. **Kiểm tra danh tính & phân quyền (`whoami`):** *"Tôi đang kết nối TBHGN với vai trò gì và có quyền ghi dữ liệu qua MCP không?"*
2. **Tổng quan dự án (`get_project_summary`):** *"Cho tôi thống kê tổng quan dự án TBHGN: đủ 5 trạng thái, việc thiếu trạng thái, việc quá hạn và việc chờ duyệt."*
3. **Danh sách công việc (`list_tasks`):** *"Liệt kê các công việc Đang làm hoặc quá hạn trong TBHGN."*
4. **Chi tiết & tài liệu (`get_task`, `search_documents`):** *"Xem chi tiết công việc mã 1 và phân biệt rõ tài liệu tham khảo với tài liệu kết quả."*
5. **Chờ duyệt (`list_pending_approvals`):** *"Những công việc nào đang Chờ duyệt và có việc nào cần tôi duyệt không?"*

---

## 10. Xử lý lỗi phổ biến

| Triệu chứng / Mã lỗi | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `401 invalid_token` | Thiếu header `Authorization` (Nginx cắt mất), token hết hạn, sai chữ ký JWKS, sai `iss` hoặc sai `aud` | Kiểm tra `proxy_set_header Authorization $http_authorization;` trong Nginx; đối chiếu `MCP_OAUTH_ISSUER` và `MCP_OAUTH_AUDIENCE` (`https://duan.banghadengiacngo.io.vn/mcp`). |
| `403 insufficient_scope` | Access token không có scope `mcp:read` | Kiểm tra API Permissions trên IdP và đảm bảo client yêu cầu scope `mcp:read`. |
| `403 oauth_identity_not_linked` | `(issuer, sub)` của user chưa có trong `/etc/tbhgn/mcp-oauth-links.json` hoặc thiếu `"verifiedByAdmin": true` | Thêm đúng cặp `(issuer, sub, firebaseUid)` vào file mapping, đảm bảo quyền `chmod 600` thuộc `www-data`, rồi `sudo systemctl restart tbhgn`. |
| `403 user_not_found` / `user_inactive` | `firebaseUid` không tồn tại trong `/users/{uid}` hoặc tài khoản đang bị khóa (`isActive: false`) | Kiểm tra mục Thành viên trong ứng dụng web TBHGN. |
| `503 firestore_read_bridge_unconfigured` | `MCP_FIRESTORE_BRIDGE_MODE=disabled` hoặc file JSON SA chưa đọc được | Kiểm tra `MCP_FIRESTORE_BRIDGE_MODE`, đường dẫn `MCP_FIRESTORE_CREDENTIALS_FILE`, quyền `www-data` và role `roles/datastore.viewer`. |
| `503 firestore_read_bridge_token_failed` | Key SA bị thu hồi, đồng hồ VPS lệch giờ (NTP), hoặc chặn outbound tới `oauth2.googleapis.com` | Kiểm tra `timedatectl`, kiểm tra outbound HTTPS từ VPS và kiểm tra trạng thái Service Account trên GCP. |
| `Redirect URI mismatch` trên IdP | Callback URL khai báo trên IdP không khớp URI thực tế của ChatGPT | Sao chép nguyên văn Redirect URI từ màn hình ChatGPT Connector hoặc bật CIMD / RFC 9207 `iss` trên IdP. |
| `Invalid audience` | IdP không gán `resource` (`https://duan.banghadengiacngo.io.vn/mcp`) vào claim `aud` của JWT | Kiểm tra cấu hình API Identifier / Resource Indicator (RFC 8707) trên IdP. |

Xem log kiểm toán (không chứa token/email):
```bash
sudo journalctl -u tbhgn -f | grep '\[TBHGN-MCP\]'
```

---

## 11. Rollback an toàn

- **Tắt khẩn cấp toàn bộ MCP (giữ nguyên ứng dụng web):**
  Đặt `MCP_ENABLED=false` trong `/var/www/tbhgn/.env` và chạy `sudo systemctl restart tbhgn`.
- **Chỉ tắt cầu nối OAuth ngoài (giữ nguyên web + Firebase ID Token):**
  Đặt `MCP_FIRESTORE_BRIDGE_MODE=disabled` trong `.env` và chạy `sudo systemctl restart tbhgn`.
- **Khôi phục Nginx:**
  ```bash
  sudo cp /etc/nginx/sites-available/<ten_file>.bak.<timestamp> /etc/nginx/sites-available/<ten_file>
  sudo nginx -t && sudo systemctl reload nginx
  ```
