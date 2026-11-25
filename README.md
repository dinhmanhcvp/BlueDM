# Blue DM

Đọc cuốc từ các group Zalo xe ghép của tài xế → lọc cuốc thuận đường → báo 1 chạm hoặc tự nhận → sắp lộ trình đón/trả.

## Chạy thử trên máy (1 lệnh)

```bash
npm install && npm start
```

Mở http://localhost:3000, nhập mã `DEMO`, mở "Chế độ mô phỏng" → Bắt đầu chạy → bấm các tin mẫu.

`npm test` chạy bộ kiểm thử engine.

## Cách hoạt động

| File | Việc |
|---|---|
| `engine.js` | Danh bạ ~45 địa danh Vĩnh Phúc – Hà Nội, bóc tách tin nhắn (regex), lọc ngược đường (góc > 75°), tính thời gian vòng, sắp thứ tự đón/trả (duyệt toàn bộ + nhánh cận, phạt khách ngồi > 90p nhưng không làm khách khác trễ > 12p) |
| `zalo.js` | Đăng nhập Zalo bằng QR (zca-js), nghe tin group, nhận cuốc bằng trả lời trích dẫn hoặc thả tim + nhắn riêng, câu nhận ngẫu nhiên + trễ 0.6–1.2s |
| `server.js` | Nhiều tài xế / mã kích hoạt, đẩy trạng thái realtime (SSE), mô phỏng xe chạy |
| `public/index.html` | Màn hình tài xế (PWA): giữ màn sáng, đọc to bằng giọng nói, GPS |
| `public/admin.html` | Tạo / gia hạn mã cho khách |
| `public/icon*.svg/png`, `logo.svg` | Logo Blue DM: icon app (Android, iPhone), logo ngang |

## Android + iPhone: cài như app, không cần store

Đây là web app (PWA), một bản dùng cho cả 2 hệ điều hành. Zalo chạy trên server nên điện thoại nào cũng được.

- **Android (Chrome):** mở link → menu ⋮ → "Thêm vào màn hình chính".
- **iPhone (Safari, iOS 16.4+):** mở link → nút Chia sẻ → "Thêm vào MH chính". Mở app từ icon, chạm "VÀO" một lần để bật giọng nói.
- Để màn hình luôn bật (đặt trên taplo, cắm sạc). iOS dừng web app khi tắt màn hình/chuyển app. Zalo vẫn được đọc trên server, nhưng tài xế sẽ không nghe báo cho đến khi mở lại app.

## Đưa lên mạng để bán (khoảng 30 phút)

1. **Thuê VPS ở Việt Nam:** Ubuntu 24.04, 1–2 GB RAM (khoảng 100–200k/tháng), chịu được vài chục tài xế. Server đặt ở Việt Nam thì Zalo ít nghi ngờ đăng nhập lạ.
2. **Tên miền:** tạo bản ghi A trỏ về IP VPS. HTTPS là bắt buộc: thiếu nó thì GPS, giữ màn hình sáng và cài app đều không chạy.
3. **Đóng gói trên máy Windows** (PowerShell, trong thư mục dự án). Không gửi kèm `node_modules`, `data`, `.env`:
   ```powershell
   tar -czf bluedm.tgz --exclude=node_modules --exclude=data --exclude=.env --exclude=.claude --exclude=bluedm.tgz .
   scp bluedm.tgz root@IP_VPS:/root/
   ```
4. **Cài trên VPS:**
   ```bash
   ssh root@IP_VPS
   mkdir -p /opt/bluedm && tar -xzf /root/bluedm.tgz -C /opt/bluedm && cd /opt/bluedm
   bash deploy/setup.sh tenmien.vn
   ```
   Script tự làm các việc sau:
   - Cài Node 22, Caddy (tự cấp HTTPS) và pm2 (tự chạy lại khi VPS khởi động lại).
   - Tạo `.env` chứa mật khẩu admin và khoá mã hoá phiên Zalo, cuối cùng in mật khẩu admin ra màn hình.
   - Mở tường lửa (chỉ SSH, HTTP, HTTPS).
   - Sao lưu `data/` lúc 3h sáng hằng ngày vào `/root/bluedm-backup-*.tgz`.
5. **Cập nhật bản mới:** lặp lại bước 3 và 4. `data/` và `.env` được giữ nguyên.

**Không đổi `SESSION_KEY` trong `.env`:** đổi là mọi tài xế phải quét QR lại. Xem log: `pm2 logs bluedm`.

## Bản đồ Google & giao thông thực (tuỳ chọn, nên bật khi bán)

Không đặt khoá thì app dùng bản đồ mở và thời gian **ước lượng**. Đặt khoá thì:
- Thời gian vòng của mỗi cuốc = (đường qua mọi điểm dừng khi có khách mới) − (đường hiện tại), **theo giao thông lúc đó** của Google.
- Giờ đến từng điểm dừng và đường đi vẽ trên bản đồ đều lấy từ Google.
- Sắp thứ tự trả khách dùng hệ số tắc đường học được từ các lần hỏi Google.

Cách lấy khoá (Google Cloud Console, cần thẻ thanh toán):
1. Tạo project → bật **Routes API** và **Maps JavaScript API**.
2. Tạo 2 khoá:
   - `GOOGLE_MAPS_KEY` (server): chỉ cho Routes API, giới hạn theo IP của VPS.
   - `GOOGLE_MAPS_BROWSER_KEY` (bản đồ trên app): chỉ cho Maps JavaScript API, giới hạn theo tên miền (`https://tenmien.vn/*`).
3. Thêm 2 dòng đó vào `.env` trên VPS, rồi chạy `pm2 restart bluedm`.
4. Đặt **cảnh báo ngân sách** (Budgets & alerts) trong Billing.

Chi phí (giá Google 11/2026, USD):
- Routes theo giao thông: $10 cho mỗi 1.000 lần gọi, miễn phí 5.000 lần/tháng.
- Bản đồ: $7 cho mỗi 1.000 lần mở app, miễn phí 10.000 lần/tháng.

Mỗi cuốc khả thi tốn 1–2 lần gọi. Thêm 1 lần mỗi khi thứ tự điểm dừng đổi, và 1 lần mỗi 10 phút khi đang chở khách (`GOOGLE_ROUTE_REFRESH_MIN`). Một tài xế chạy 2 chuyến/ngày tốn khoảng 20–30 lần gọi, tức khoảng $6–9/tháng (150–230k). Trần mặc định là 60 lần/tài xế/ngày (`GOOGLE_ROUTES_PER_DRIVER_DAY`); hết lượt thì app tự quay về ước lượng.

## Chuẩn bị cho tài xế chạy thử

- **Hướng dẫn cho tài xế:** gửi link `/huong-dan.html` (cài app, nhập mã, kết nối Zalo, dùng hằng ngày, báo lỗi). In được ra giấy.
- **Mặc định an toàn:** tài xế mới có Tự bắt cuốc **tắt**; khi bật thì đếm ngược 5 giây để kịp huỷ.
- **Không mất lộ trình khi khởi động lại:** cài đặt và các cuốc đang chở của từng tài xế được lưu ở `data/state.json`. Chạy thử không ghi đè lộ trình thật.
- **Bổ sung địa danh sau mỗi ngày:** trang admin → "Địa danh chưa nhận ra" liệt kê các tin trông như cuốc mà app chưa đọc ra điểm đón/trả (lưu ở `data/unparsed.jsonl`). Thêm tên + toạ độ (chép từ Google Maps) + tên gọi khác là app hiểu ngay, không cần sửa code (lưu ở `data/places.json`).

## Quy trình bán (trang `/admin.html`)

1. **Dùng thử:** gửi mã `DEMO` (chạy thử, không cần Zalo).
2. **Bán:** tài xế chuyển khoản → Admin nhập tên + SĐT → chọn gói 1/3/6/12 tháng (tự tính tiền theo "Giá 1 tháng") → Lưu → gửi mã vừa tạo cho tài xế.
3. **Gia hạn:** bấm "Thu tiền" ở thẻ tài xế → chọn gói → Lưu. Ngày được cộng dồn, mỗi lần thu được ghi vào lịch sử. "Copy tin nhắc" tạo sẵn tin nhắn nhắc gia hạn để gửi Zalo.
4. **Kết nối Zalo:** tài xế mở app → ⚙ → nhập số chính → "Kết nối Zalo" → tích đồng ý dùng nick phụ. Chỉ có 1 điện thoại thì có 2 cách:
   - "Gửi mã QR sang máy khác": mở link `/qr/...` trên máy tính / máy người thân rồi quét.
   - Admin bấm "Kết nối Zalo hộ": QR hiện ngay trong trang Admin, tài xế quét từ xa qua video call hoặc tại chỗ.
   Quét 1 lần là phiên được lưu, khởi động lại server tự kết nối lại. QR tự làm mới tối đa 5 lần (khoảng 5 phút) rồi dừng.
5. **Không trả tiền / vi phạm:** "Khoá" ngắt app và Zalo ngay. "Đăng xuất Zalo" xoá phiên đã lưu.
6. Thống kê đầu trang: số tài xế đang dùng, sắp hết hạn (≤ 3 ngày), thu tháng này, tổng đã thu.

## Cài đặt Zalo cho tài xế (⚙)

- **Câu chốt:** để trống thì dùng câu ngẫu nhiên chống khoá. Đặt "Ok" nếu nhóm quen kiểu đó. Tin có `code 88` thì tự gửi "Ok 88".
- **Từ khoá chặn / luôn báo:** vd. chặn "hàng, ship"; luôn báo "lái hộ".
- **Từng nhóm:** Canh (có đọc nhóm này không) · Tự (cho tự bắt cuốc) · Đợi 1p (nhóm cấm trả lời trong phút đầu: tự chốt vào đầu phút kế tiếp).
- **Tin chưa rõ tuyến:** tin có giá/số ghế/code nhưng địa danh ngoài danh bạ vẫn hiện để chốt tay, không bao giờ tự nhận.
- Cuốc chờ bấm quá 5 phút tự ẩn.
- Gỡ liên kết Zalo ngay trong app.

## Trên taplo

- 🌙 Màn tối: gần như đen để đỡ nóng máy, chỉ hiện số ghế trống. Có cuốc mới thì tự sáng lại.
- App giữ màn hình sáng, và phát vòng lặp âm thanh im lặng để giọng đọc ra loa ngay trên iPhone.
- Lỡ tắt màn hình: iPhone đóng băng app (không nghe báo cuốc). Mở lại thì app đọc nhắc để màn hình luôn sáng.

## Rủi ro cần nói rõ với khách

- zca-js là API **không chính thức**. Zalo có thể khoá hoặc đăng xuất tài khoản dùng tự động. Nên khuyên tài xế dùng nick phụ, ghi rõ trong điều khoản bán.
- Danh bạ địa danh và thời gian đường hiện là ước lượng (đường chim bay x1.3, tốc độ cố định). Tin viết lạ, hoặc nơi ngoài danh bạ, sẽ bị bỏ qua.
