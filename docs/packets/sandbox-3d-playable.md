# Sandbox 3D chơi liên tục

Bản thử riêng từ `a73cfc8`. Dùng engine Accate và controller Sandbox hiện có cho ante, chip, Call/Check/Bet/Raise/Fold, trả pot, rebuy, đổi chip và ván tiếp. Tôn trọng AGENTS.md. Dùng tên poker trong code và tiếng Việt ở UI. Giữ game gốc và bài mẫu Drill 3D làm hai điểm vào riêng.

## Bản chơi thử

- Điểm vào `/sandbox-3d.html`. Bàn bốn ghế với Hero, Cá, Cáo, Nóng. Chạy phiên Sandbox độc lập, cấu hình bốn ghế và ba rival này. Thiết lập cấu trúc bàn được ẩn ở điểm vào thử để dàn nhân vật khớp, các nút chơi thực tế và kết quả dùng UI Sandbox hiện có. Cài đặt lưu cục bộ của phiên Sandbox thường nằm ngoài phạm vi.
- Cảnh nhận `SceneTableSnapshot` từ trạng thái hiện hành. Dữ liệu thật gồm bài chung 0–5 lá, bài của Hero khi còn ngồi, pot, Call, street, rival có ghế, và người tới lượt. Cảnh giữa hai ván có thể trống, bài của rival luôn úp ở lớp 3D. Luồng lật bài và kết quả showdown do Sandbox gốc xử lý. Các chip 3D minh họa số tiền, mệnh giá thật vẫn hiển thị ở UI Sandbox.
- Nhân vật nhìn và nghiêng nhẹ khi tới lượt, dùng diễn biến công khai. Hỗ trợ reduced motion, không thay đổi action engine. Dùng hiệu ứng âm sẵn có của Sandbox để tránh phát hai lớp âm. Ngoại hình và hoạt ảnh phức tạp hơn sẽ dựa trên bản chơi thử này.

## Hợp đồng

Scene lane sở hữu `src/ui/drill3d/scene/**`, giữ `DrillScene` và hợp đồng props. Live snapshot có `live`; Drill cũ tiếp tục dùng `DEMO_SPOT`. Không hiện River giả ở vị trí đã có lá thứ năm, tránh stack theo fixture cũ khi chạy live.

Gameplay lane sở hữu `src/ui/sandbox/{SandboxApp.tsx,types.ts}`, `src/ui/liveSandbox3d/**` và test liên quan. Cung cấp named `LiveSandbox3d` từ `src/ui/liveSandbox3d/LiveSandbox3d.tsx`. Thành phần nhận tùy chọn `initialSeed?: string` để kiểm thử; dùng `SandboxApp` qua prop slot chứa view bàn và đọc snapshot ngay trong render theo tùy chọn hiện có. Thay phần hiển thị bài/pot cũ bằng cảnh thêm, giữ thông báo lượt, kết quả, nút ván mới, hero controls, các điều khiển giữa ván và timeline. Ưu tiên delta tối thiểu đối với Sandbox/P5. Cảnh nhập từ `../drill3d/scene/DrillScene`.

Control giữ entry HTML, Vite preview, hợp đồng và kiểm thử Brave. Gate chính là trải qua đủ các street trong một ván thật và chia ván tiếp, đọc được bài/pot và Call ở 320 và 390 px, `npm run check`, build.
