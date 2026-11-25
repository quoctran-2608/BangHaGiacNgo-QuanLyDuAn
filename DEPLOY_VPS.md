# Hướng dẫn triển khai TBHGN lên VPS Linux (`duan.banghadengiacngo.io.vn`)

Ứng dụng giữ nguyên kiến trúc **React + Vite (build tĩnh `dist/`) + Express (`dist-server/server.js`) + Firebase Authentication + named Firestore database + TBHGN MCP Server V1.1 (chỉ đọc)** hiện tại, không thay đổi hoặc nhập lại dữ liệu 20 công việc.

- **Firebase Project ID:** `gen-lang-client-0491463422`
- **Firestore Database ID:** `ai-studio-tbhgnqunldnsch-a72a3d00-34e2-44ed-b19a-4166785fc8ab`
- **Domain triển khai chính thức:** `duan.banghadengiacngo.io.vn`

---

## 1. Yêu cầu trên VPS Ubuntu (22.04 / 24.04)

Cài đặt **Node.js 20 LTS hoặc 22 LTS**, **Nginx** và **Certbot**:

```bash
sudo apt update
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Cài Node.js 22 LTS (nếu chưa có Node >= 20)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

---

## 2. Trỏ DNS domain

Tại trang quản lý DNS của `banghadengiacngo.io.vn`, tạo bản ghi:
- **Type:** `A`
- **Host/Name:** `duan`
- **Value:** `<IP_PUBLIC_CUA_VPS>`

Kiểm tra trước khi cấp SSL:
```bash
dig +short duan.banghadengiacngo.io.vn
```

---

## 3. Tải mã nguồn, cấu hình `.env` và build production

```bash
sudo mkdir -p /var/www/tbhgn
sudo chown -R $USER:$USER /var/www/tbhgn
cd /var/www/tbhgn

# Clone từ repository của bạn (hoặc tải mã nguồn lên thư mục này)
git clone <URL_REPO_CUA_BAN> .

# Cài dependencies và build cả client (dist/) + server (dist-server/server.js)
npm ci
npm run build
```

Tạo file `/var/www/tbhgn/.env` từ `.env.example` (không đưa `.env` lên Git):

```bash
cp .env.example .env
nano .env
```

Nội dung tối thiểu trong `.env` cho web + MCP:
```env
NODE_ENV="production"
HOST="127.0.0.1"
PORT="3000"
APP_URL="https://duan.banghadengiacngo.io.vn"
BOOTSTRAP_ADMIN_EMAIL="ngaothuyet2023@gmail.com"
MCP_PUBLIC_URL="https://duan.banghadengiacngo.io.vn/mcp"
MCP_ALLOWED_HOSTS="duan.banghadengiacngo.io.vn"
MCP_ALLOWED_ORIGINS="duan.banghadengiacngo.io.vn"
```

> Lưu ý: chi tiết cấu hình OAuth 2.1 và Firestore Read Bridge cho ChatGPT xem tại `docs/MCP_V1_SETUP.md`. Không cần chép thư mục `server_data/` lên VPS nếu dữ liệu 20 công việc đã có sẵn trên Firestore.

Kiểm tra chạy thử trực tiếp trên VPS:
```bash
npm run start
```
Mở một terminal khác kiểm tra nhanh:
```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/mcp/health
```
Phải trả về `200 OK` với `projectId` và `databaseId` chính xác, rồi nhấn `Ctrl+C` để chuyển sang chạy bằng `systemd`.

---

## 4. Cài đặt dịch vụ `systemd`

Chỉnh quyền thư mục cho user chạy dịch vụ (`www-data`) và chép file mẫu `deploy/tbhgn.service`:

```bash
sudo chown -R www-data:www-data /var/www/tbhgn
sudo cp /var/www/tbhgn/deploy/tbhgn.service /etc/systemd/system/tbhgn.service
# Kiểm tra lại đường dẫn node (`which node`) nếu không nằm ở /usr/bin/node
sudo systemctl daemon-reload
sudo systemctl enable --now tbhgn
sudo systemctl status tbhgn --no-pager
```

Xem log khi cần:
```bash
sudo journalctl -u tbhgn -f
```

---

## 5. Cấu hình Nginx Reverse Proxy + HTTPS

> **Lưu ý an toàn:** Nếu VPS đã có sẵn cấu hình Nginx cho `duan.banghadengiacngo.io.vn` (đặc biệt khi đã có SSL Certbot), **không ghi đè trực tiếp** — hãy sao lưu file đang chạy và đối chiếu (`diff`) với `deploy/nginx-tbhgn.conf` trước khi hợp nhất!

```bash
# Sao lưu nếu đã có cấu hình cũ
sudo ls -la /etc/nginx/sites-enabled/
sudo cp /etc/nginx/sites-available/tbhgn /etc/nginx/sites-available/tbhgn.bak.$(date +%Y%m%d%H%M) 2>/dev/null || true

# Chỉ chép mẫu khi cài mới lần đầu
sudo cp /var/www/tbhgn/deploy/nginx-tbhgn.conf /etc/nginx/sites-available/tbhgn
sudo ln -sf /etc/nginx/sites-available/tbhgn /etc/nginx/sites-enabled/tbhgn
sudo nginx -t
sudo systemctl reload nginx
```

Cấp chứng chỉ SSL HTTPS miễn phí từ Let's Encrypt (nếu chưa có):
```bash
sudo certbot --nginx -d duan.banghadengiacngo.io.vn
```
Chọn tùy chọn chuyển hướng toàn bộ HTTP sang HTTPS khi Certbot hỏi. Kiểm tra gia hạn tự động:
```bash
sudo certbot renew --dry-run
```

Nếu bật tường lửa `ufw`:
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw status
```

---

## 6. Thêm domain vào Firebase Authorized Domains

Bước bắt buộc để Google Sign-In hoạt động trên `https://duan.banghadengiacngo.io.vn`:

1. Mở [Firebase Console](https://console.firebase.google.com/) -> chọn project **`gen-lang-client-0491463422`**.
2. Vào **Build -> Authentication -> Settings -> Authorized domains**.
3. Nhấn **Add domain**, nhập:
   ```
   duan.banghadengiacngo.io.vn
   ```
4. Lưu lại (có hiệu lực sau vài giây đến ~1 phút).

---

## 7. Checklist kiểm tra sau triển khai

1. **API & MCP Healthcheck:**
   ```bash
   curl -s https://duan.banghadengiacngo.io.vn/api/health
   curl -s https://duan.banghadengiacngo.io.vn/api/mcp/health
   curl -s https://duan.banghadengiacngo.io.vn/.well-known/oauth-protected-resource/mcp
   ```
2. **Bảo vệ dữ liệu nội bộ (`403`):**
   ```bash
   curl -I https://duan.banghadengiacngo.io.vn/server_data/test.json
   curl -I https://duan.banghadengiacngo.io.vn/server/mcp/auth.ts
   curl -I https://duan.banghadengiacngo.io.vn/firestore.rules
   curl -I https://duan.banghadengiacngo.io.vn/.env
   ```
   Tất cả phải trả `403 Forbidden`.
3. **SPA Refresh không lỗi 404:**
   Mở trình duyệt vào `https://duan.banghadengiacngo.io.vn/tasks` hoặc nhấn F5 tại bất kỳ màn hình nào -> trang tải lại bình thường (`200 OK`).
4. **Google Login trên Desktop & Mobile:**
   - **Desktop (Chrome/Safari/Edge):** Nhấn đăng nhập Google -> popup chọn tài khoản hiện ra, đăng nhập thành công, tải đúng công việc thật và quyền tài khoản tương ứng.
   - **Mobile (iOS Safari / Android Chrome):** Kiểm tra cả nút đăng nhập Google mặc định và nút dự phòng chuyển hướng nếu trình duyệt chặn popup.

---

## 8. Cập nhật phiên bản mới về sau

```bash
cd /var/www/tbhgn
git pull origin main
npm ci
npm run build
sudo systemctl restart tbhgn
```
