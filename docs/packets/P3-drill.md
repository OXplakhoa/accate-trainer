# Packet P3 — Drill

**Implementer** Gemini 4 Argon High. **Review độc lập** Gemini 4 Neon High và Gemini 4 Hydrogen High.

Đọc `AGENTS.md`, brief §3–5, spec §5–6, §10–11, AC D1–D8 và M1–M4, D37–D43, bản đồ bài giảng và `QUESTIONS.md`. Làm trong `.worktrees/p3` trên nhánh `p3-drill`. Phạm vi `src/engine/drill/**`, `src/ui/drill/**`, `tests/engine/drill/**`. Export `DrillApp` từ `src/ui/drill/index.ts`. Control nối vào App. Xem phần giao diện chung trong packet P4.

## Spot, lời giải và thời điểm feedback

- Dùng engine M1 và rival M2 chơi tới lượt hero rồi chụp snapshot công khai. Sinh spot theo seed có giới hạn thử và fallback sang fixture chơi qua engine. Luôn trình bày đúng bài riêng của hero và board đã lật. Chọn range từ các rival còn tranh pot, dùng hành động công khai để suy luận, chia đúng equity theo pot đủ điều kiện. Chốt lời giải tại thời điểm chọn action và đối chiếu kết quả ván riêng. Dùng lại hàm tính, so bài, trạng thái cược và chip thật. Khi là fixture, tiếp tục ván từ chính state đã chụp.
- Cấp 0 có bài ngắn 2–3 phút và ví dụ theo luật Accate cho các khái niệm spec §6, viết mới dựa vào bản đồ bài giảng, dùng ký hiệu Lecture/slide trong repo. Cấp 1 hỏi theo thứ tự D1, hint miễn phí và feedback từng đáp án. Cấp 2 nhập một lượt, có hint được ghi nhận, chỉ một dòng sau action và phân tích sau ván. Cấp 3 giới hạn thời gian, không hint, feedback sau ván, dùng đồng hồ tầng UI và truyền thời gian vào logic thuần. Mọi cấp chọn tự do. Cho thấy gợi ý lên cấp khi đủ 20 lần gần nhất và đúng ít nhất 80%.
- Với bài đếm outs để thắng, đáp án đếm clean outs trước range đã nêu, hiện riêng mixed/dirty/chop và giả định. Với H1 #7 hỏi rõ lá lên set, 2 J trong 47 lá, turn 4,26%, tới river 8,42% và Rule of 4 là 8%. Mốc D8 dựng pot 300 trước bet turn 50, đối thủ thấy 350/50 và cần 12,5%, trong khi flush draw 9/46 ≈ 19,57%. D6 kiểm quyết định tốt mà thua river. Giữ giả định range, số đối thủ, stack, pot, cap và vị trí trong lời giải. Phân biệt legal sizing và ý nghĩa chiến thuật.
- Với action hero, dùng state/legal actions engine và chọn đúng chip vật lý. Chỉ ghi nhận lần thử và cập nhật chỉ số khi submit hợp lệ. Giữ kết quả của từng câu, thời gian, hint và mốc đúng/sai để tính đủ 8 chỉ số §10. Dùng lưu cục bộ phía UI có phiên bản, xử lý dữ liệu lỗi hoặc trình duyệt chặn storage. Màn Tiến bộ đọc được theo thời gian, khái niệm, cấp, rival, có trạng thái trống. Ghi trước số liệu có đo được, ví dụ chỉ tính tốc độ trên câu đúng và clear spot theo ngưỡng chặt > 5 điểm %.
- Drill tự chạy độc lập. Nếu nối spot từ Sandbox, hỗ trợ prop tùy chọn `initialSpot?: { hand: HandState; heroId: string }` cho `DrillApp`, bắt đầu từ spot hợp lệ và dùng chính snapshot đó. Thành phần đơn giản của Drill không import module Sandbox.

## Bàn giao

- Lưu ca D1–D8/M1–M4 đã kiểm, thiết kế responsive và các điểm cần control xác nhận. Có test hồi quy chấm điểm, thời điểm hiện feedback, storage/aggregation thuần khi thích hợp, luôn dùng seed cố định, kiểm INV-1 từng mệnh giá và INV-2 sau mỗi bước engine. Dùng helper H1 sẵn có nếu phù hợp.
- Chạy `npm.cmd run check -- -- --pool threads --configLoader runner --no-cache` và `npm.cmd run build`. Nếu dùng preview tạm để kiểm giao diện, đặt ngoài diff bàn giao. Không ghi spec/AC, engine đã có, App, package/config hay file packet khác. Không push hay merge. Báo các ca mơ hồ để control ghi `QUESTIONS.md`. Bỏ thao tác Git nếu sandbox chặn index. Báo cáo tiếng Việt sau khi xong.
