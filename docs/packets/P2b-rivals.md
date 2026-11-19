# Packet P2b — Rival bot

**Implementer** Gemini 4 Argon High.

**Review độc lập** Gemini 4 Neon High và Gemini 4 Hydrogen High. Control kiểm cuối.

Đọc `AGENTS.md`, spec §4, §3.3–3.4, §6.1, AC B1–B7 và quyết định D28, D30, D33, D39, D42, D45, O7. Viết module trong `src/engine/rivals/` và test tương ứng trong `tests/engine/rivals/`. Dùng API engine hiện có. Control xử lý export ở `src/engine/index.ts`.

## Hồ sơ và chọn ghế · B3, B4

- Đủ 9 ID ổn định với tên và kiểu chơi có sẵn trong spec. Tách thông tin hiển thị tiếng Việt và tham số hành vi. Cung cấp metadata để UI có thể luôn hiện kiểu chơi ở ghế, bao gồm trạng thái công khai của Nóng. Avatar, âm thanh, animation và layout thuộc UI.
- Chọn rival và xáo thứ tự ghế qua `Rng.fork(label)`, chỉ từ nhóm được bật, không lặp ID. Ở bàn 10 người với tất cả rival được bật, có đúng 9 rival khác nhau. Xử lý pool không đủ hoặc không hợp lệ rõ ràng, giữ kỹ thuật cấu hình bàn ngoài module.

## Thông tin và hành động · B1, B2

- Hàm quyết định chỉ nhận bài riêng của chính rival, board đã lật, hành động công khai (gồm hô sớm), stack, pot, vị trí/turn, cap và các hành động có thể dùng. Nếu có adapter từ `HandState`, dựng DTO bằng cách chọn từng trường tại ranh giới. Tuyệt đối không truyền cả `HandState`, `SeatState`, deck, bài người khác hoặc kết quả showdown chưa công khai vào hàm quyết định. Test thay hidden cards/deck mà cùng public snapshot và seed vẫn ra cùng quyết định. Kiểm cấu trúc input ở runtime, gồm timeline công khai đã chiếu lại.
- Trả hành động có thể áp dụng qua engine. Chọn đúng chip thật trong stack bằng helper hiện có, gồm trường hợp call all-in, cap và mệnh giá thiếu. Chỉ trả ý định hô trước lượt khi hợp lệ; engine thời điểm thực hiện vẫn là nguồn quyết định hiệu lực. Tránh tái cài luật cược và giao diện đổi chip. Phân biệt thẻ tính cách với kết quả thắng/thua thực tế.
- Các profile theo mô tả §4.1. Giữ tham số rõ ràng để có thể tinh chỉnh hành vi. Cung cấp giả định range dựa vào profile và action công khai. Với range định lượng, xuất combo cấu trúc `{ cards: readonly [Card, Card]; weight: number }`, hữu hạn, không âm và lọc blocker công khai. Có thể trả thêm mô tả tiếng Việt. P2b không import P2a. Calculator sẽ tiêu thụ range theo cấu trúc này.
- Kiểm B2 bằng 1.000 ván có seed cố định cho mỗi kiểu, cùng cơ hội tương đương và đo dựa trên số cơ hội thực sự có thể raise hoặc fold sau khi đối mặt raise. Kiểm ít nhất Điên > Sói > Cáo > Cá về tần suất raise và Thỏ có tỉ lệ fold khi đối mặt raise cao nhất. Dùng fixture/đường gọi engine hiện có, không cho bot nhìn hidden cards để tạo chênh lệch giả. Ghi tóm tắt số lượt và các tỉ lệ trong báo cáo.

## Nóng · B5–B7

- Bình thường chơi gần TAG với ít bluff hơn, khi tilt chơi rộng, bet/raise lớn và hô sớm nhiều hơn. Tách việc tổng hợp kết quả đã công khai ở ranh giới ván khỏi DTO ra quyết định trong ván. Chỉ tính pot Nóng đủ điều kiện ở showdown. Trigger ở pot đã thua từ 150 điểm trở lên, hoặc thua sau khi dẫn trên turn theo bài thực sự được lộ. So bài turn với evaluator 6 lá, không đọc hole cards chưa lộ. Phân biệt một pot mất hẳn với một phần pot chia hòa. Dùng API showdown/hand hiện có làm đầu vào cho adapter giữa ván.
- Tilt bắt đầu từ ván **kế** và kéo dài 3–5 ván theo seed. Đếm đúng số ván đã chơi và trở về bình thường. Không tiêu hao đếm khi chỉ đọc trạng thái. Xem `QUESTIONS.md` cho tình huống có trigger mới khi đang tilt. Kiểm mốc 150 và các ví dụ pot 160, pot 100 có/không có bad beat, trạng thái công khai và 1.000 ván so sánh aggression khi tilt với khi bình thường ở cơ hội tương đương.

## Bàn giao

- Test dùng seed cố định và kiểm INV-1 theo từng mệnh giá, INV-2 sau mọi bước có state. Test profile/range dùng trạng thái bàn hợp lệ và xác nhận phép tính không làm thay đổi trạng thái chip. Lệnh kiểm `npm.cmd run check`.
- Làm trên nhánh `p2b-rivals`. Commit trong phạm vi hoặc báo control nếu sandbox chắn Git. Không sửa spec, AC, cấu hình, module P2a, hoặc push/merge. Nộp báo cáo tiếng Việt, map AC → test, kết quả B2/B6, commit và các giả định.
