# Blue DM — quy tắc giao diện & code

App gắn trên taplo cho tài xế xe ghép tuyến cố định (Vĩnh Yên – Phúc Yên – Hà Nội). Trọng tâm là **bắt cuốc**, dẫn đường là phụ. Hiểu một cuốc trong 0,5 giây nhìn lướt, nhận bằng 1 chạm.

## 1. Màu & chữ
- **Mặc định sáng** (dễ đọc ban ngày): nền `#F3F5F9`, thẻ trắng có bóng rất nhẹ, chữ `#10131A` / phụ `#667085`. Có **Tối** (than chì ánh xanh `#171A20` / `#1F232B`, không đen kịt) và **Tự động** theo điện thoại; chọn trong cài đặt. Mọi màu là token ở `:root` + `[data-theme="dark"]` của `public/index.html`.
- **1 màu nhấn xanh cobalt** (thương hiệu Blue DM): nền nút `--acc` `#1F5BFF` (tối: `#3D6BFF`), chữ trắng trên nền đó; chữ nhấn dùng `--acc-tx` (sáng `#1F5BFF`, tối `#8FADFF`). Không dùng xanh Tailwind mặc định `#3B82F6`. Cam `--warn` = khách ngồi lâu, lệch gần ngưỡng, tin chưa rõ tuyến · đỏ `--bad` = huỷ, ngược đường, rớt Zalo. Còn lại trắng/xám; đón/trả phân biệt bằng chấm rỗng/đặc. Chữ trên nền nhạt luôn dùng biến `-tx`.
- Cấm (dấu hiệu "AI slop"): bộ màu Tailwind mặc định (navy + emerald/sky/amber), nền đen kịt, gradient, emoji làm icon, viên thuốc màu khắp nơi, nút 3D đế dày, kính mờ.
- Phân cấp bằng cỡ và độ đậm chữ. Font Be Vietnam Pro; số `tabular-nums`, số lớn tracking âm. Icon: bộ SVG nét 2px (`ic()`).

## 2. Bố cục 1 màn hình, KHÔNG tab (bắt cuốc trước, dẫn đường là phụ)
- Tài xế đang lái: càng ít thứ để nhìn càng tốt. Không thêm tab, không thêm nút lên thanh trên.
- Trên: logo + trạng thái Zalo + nút cài đặt (nút thử chỉ hiện khi chạy thử). Màn tối nằm trong cài đặt; bản đồ mở từ bảng lộ trình.
- Thanh ghế 1 hàng (chạm ghế trống để khoá cho khách dọc đường).
- Giữa: **cuốc hợp đường** dạng thẻ to (điểm đón/trả 2 dòng, phút vòng rất lớn, ghế · giá · code, Nhận ngay ≥ 64px; tự bắt thì nút Huỷ đỏ có thanh đếm ngược). Không có cuốc: radar nhỏ + 1 dòng số liệu.
- Ngay dưới: **"Cuốc khác (n)"** gập sẵn — tin bộ lọc loại / chưa rõ tuyến, mỗi tin 1 dòng; chạm dòng mới hiện tin gốc + Bỏ qua · Sửa câu · Nhận cuốc (nhận tay như Zauto, server chỉ kiểm số ghế).
- Dưới: thanh điểm dừng kế tiếp (chỉ khi có khách; chạm mở lộ trình) · công tắc Tự bắt cuốc + ô "≤20p lệch tối đa" (chạm đổi vòng 10/15/20/30).
- **Chạm phải phản hồi tức thì** (< 16ms): đổi màn hình tại chỗ bằng `act(action, body, op)` rồi server xác nhận; `op` là phép gán tuyệt đối. Không bao giờ để nút chờ mạng mới đổi.
- Nút phẳng, chạm nhún nhẹ, `touch-action: manipulation`; vùng chạm ≥ 48px.

## Logo
- Hình: chữ **D** dựng thành bóng chat (đuôi nhọn góc dưới trái) chứa đường chữ S nối 2 chấm (đón → trả): "từ tin nhắn ra cuốc xe". Chữ: "Blue **DM**" (Be Vietnam Pro 800, tracking âm, "DM" màu cobalt).
- File: `public/icon.svg` (ô bo góc), `public/icon-maskable.svg` + `icon-512.png` (tràn viền, vùng an toàn 80%), `icon-180.png` (iPhone), `public/logo.svg` (ngang). Hình phẳng, không gradient, phải đọc được ở 16px.

## 3. Ngôn ngữ
- Cấm câu AI sáo rỗng ("Hệ thống AI đang tối ưu…", "Chào mừng tài xế", "Khách hàng tiềm năng").
- Dùng tiếng tài xế, ngắn: `Kín xe`, `Trống 2 ghế`, `Tự bắt cuốc`, `Lệch +14p`, `Ngược chiều (đã chặn)`, `Phúc Yên → Mỹ Đình`.
- Mọi sự kiện tự nhận cuốc / đổi thứ tự trả khách đều đọc to (speechSynthesis vi-VN, tốc độ 1.15), đi thẳng vào số liệu. Không bịa thông tin không có dữ liệu: chỉ ghi "Giao thông thực" khi số liệu đến từ Google.

## 4. Code
- Không TODO, không hàm giả. Mọi thay đổi phải chạy được ngay (`npm start`, `npm test`).
- Thuật toán ở `engine.js`: chặn ngược đường bằng góc > 75°, ngưỡng lệch, sắp thứ tự trả khách có phạt `0.5·(τ−90)²` và không làm khách khác trễ > 12p. Giữ test trong `engine.test.js` khớp.
- Giao thông (`google.js`): chỉ gọi Google Routes `computeRoutes` (tính tiền theo lần gọi) qua mọi điểm dừng; lọc bằng ước lượng trước; luôn có trần lượt gọi/tài xế/ngày; không có khoá thì app vẫn chạy bằng ước lượng.
- Zalo (`zalo.js`): trễ ngẫu nhiên 600–1200ms + typing event, xoay vòng mẫu câu nhận cuốc, chèn code nhóm ("Ok 88") và số chính; phiên đăng nhập mã hoá AES-256-GCM.
- Nhận trạng thái: SSE kèm long-poll `/state?wait=1` chạy song song (proxy như Cloudflare giữ SSE). Mọi `/api/*` trả về trạng thái mới để màn hình đổi ngay.
- Không viết handler kiểu `onkeydown = e => cond && f()`: trả về `false` sẽ huỷ phím gõ. Kiểm thử ô nhập bằng phím thật (từng phím), không dán chữ.
- Từ điển địa danh có toạ độ thật; có nút giả lập tin Zalo trên giao diện để thử toàn luồng.


