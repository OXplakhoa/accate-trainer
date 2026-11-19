# Packet P4 — Bàn Sandbox và Cài đặt

**Implementer** Gemini 4 Neon High. **Review độc lập** Gemini 4 Argon High và Gemini 4 Hydrogen High.

Đọc `AGENTS.md`, brief §4, spec §3–4, §7, §9–11, AC nhóm T, C2–C7 và X, D14–D25, D30–D33, D39–D45 và `QUESTIONS.md`. Làm trong `.worktrees/p4` trên nhánh `p4-sandbox`. Phạm vi `src/ui/sandbox/**`, `tests/ui/sandbox/**`. Export `SandboxApp` từ `src/ui/sandbox/index.ts`. Control nối vào App. Phần điều phối/react hooks có thể tách logic TypeScript thuần trong thư mục Sandbox để test. Không nhập feature Drill đang làm song song.

## Bàn chơi và thiết lập

- Chạy nhiều ván qua `startHand`, `applyAction`, `declareOutOfTurn`, `exchangeHandChips`, `settlePendingPayout` và `tableBoundary`. Dùng buy-in 500, kho 6.500 điểm và chip thật theo từng mệnh giá. Kế thừa state chip, ledger, ghế, dealer, opener, tilt qua ván. Sinh seed ở biên UI, RNG dùng nhánh riêng mỗi ván, mỗi mục đích. Dùng DTO công khai chuẩn cho bot, tránh vòng lặp vô hạn hoặc callback xử lý cùng lượt 2 lần.
- Cho chọn 4–10 người (mọi số nguyên), rival bật/tắt, cài preflop cap và bật/tắt preflop, split/bài cào, hô sớm, timer 10/15/20/25 cho thiết lập dùng sau, giảm motion, mức âm từng kênh và ngôn ngữ thuật ngữ. Hiện buy-in 500 và cơ cấu phát chip theo số ghế hiện được hỗ trợ. Áp dụng thay đổi bàn ở ranh giới ván. Có lưu tùy chọn cục bộ và fallback khi dữ liệu hỏng.
- Hero bấm từng chip và có thể bỏ chip vừa chọn. Chỉ cho xác nhận action khi chip vật lý khớp luật. Có hô sớm theo X và đổi với người chơi/pot, giữ lỗi hợp lệ từ engine và hướng dẫn cách xử lý. Áp dụng T1–T4, bao gồm khi hero yêu cầu rời giữa ván, để hành động fold hiệu lực ở cơ hội luật cho phép rồi xử lý rời ở ranh giới, giữ tiền đã góp trong pot. Dùng cơ chế cash out/rebuy sẵn có và mời rival khác khi dưới 4 nếu kho/ghế cho phép. Khi engine đang chờ payout hoặc thiếu chip antes, cho phép chọn đổi phù hợp để tiếp tục. Dùng sổ phiên tính buy-in, rebuy, cash out và lãi/lỗ.
- Kiểu chơi luôn hiện ở từng ghế, có biến đổi công khai của Nóng khi tilt. Chỉ hiện bài được lộ đúng thời điểm. Xem lại cuối ván từ timeline chính xác và snapshot tại từng quyết định hero gồm pot odds, EV và nhãn chất lượng với giả định. P4 có thể expose `onPracticeSpot?: (hand: HandState, heroId: string) => void` cho control nối với Drill. Xử lý Tournament bằng luồng bàn này ở P5, để điểm kết thúc animation chia/lật có thể quan sát và bố trí vùng action/timer mà không phải viết lại bàn.

## Giao diện chung cho P3 và P4

- Theo D40, dùng nỉ xanh trầm, viền ấm, bài trắng ngà, typography sans dễ đọc tiếng Việt và số tabular. Tham chiếu nền `#101815`, panel `#1b2923`, nỉ `#194a38`, chữ `#f5eee2`, chữ phụ `#bbc8bc`, điểm nhấn `#edc28d`. Dùng biến CSS được scope trong root feature để tránh xung đột khi ghép. Cho thấy gameplay và feedback là nội dung chính, tiết chế chữ và chi tiết trang trí.
- Hiện chip theo màu, hoa văn mép và mệnh giá, các lá bài rõ suit/rank và nhãn cho trình đọc màn hình. Dùng hình ảnh/raster nguyên bản nếu tạo được, giữ mọi asset trong thư mục feature. Cài âm chip/bài có phân biệt, chống lặp khi phát lại action, hỗ trợ tắt âm, chỉ khởi tạo âm sau thao tác người dùng. Motion dùng cho chia/lật bài, chip vào pot, hô sớm và payout/bài cào, hỗ trợ prefers-reduced-motion.
- Chơi được ở 390×844 và desktop 1440×900, kiểm thêm đường hẹp 320 px. Không dùng hover hoặc drag làm đường duy nhất. Focus rõ, thao tác bàn phím, nút thiết yếu dễ bấm, text contrast AA. Giữ action và số pot dễ tìm trên điện thoại, tập trung trạng thái lượt hiện tại thay vì làm chật bàn với điều khiển phụ.

## Bàn giao

- Kiểm T1–T4, C2–C7 và invariant sau từng transition engine, kiểm B3/B5 trên UI, chạy thử ván có showdown, đổi chip và ván kế tiếp. Test logic bằng seed cố định, kiểm chip từng mệnh giá và pot chưa thanh toán. Kiểm keyboard, mobile và desktop bằng browser cục bộ khi có. Chạy `npm.cmd run check -- -- --pool threads --configLoader runner --no-cache` và `npm.cmd run build`. Nếu dùng preview tạm, đặt ngoài diff bàn giao.
- Không sửa spec/AC, engine, App, package/config hoặc feature Drill. Báo tình huống engine hiện chưa đáp ứng để control xử lý. Không push/merge. Bỏ thao tác Git nếu sandbox chặn index. Báo cáo tiếng Việt sau khi xong.
