# Packet P2a — Calculator poker

**Implementer** Gemini 4 Neon High.

**Review độc lập** Gemini 4 Argon High và Gemini 4 Hydrogen High. Control kiểm cuối.

Đọc `AGENTS.md`, spec §5, §6.1, §10, AC H1 #7/#13/#16, D1/D5/D8 và M1–M3, cùng D38. M4 thuộc UI. Viết các module trong `src/engine/calculator/` và test tương ứng trong `tests/engine/calculator/`. Dùng lại `Card`, `evaluateHand`, `compareHands`, `Rng` và API chip hiện có. Mỗi packet có worktree riêng. Control xử lý export ở `src/engine/index.ts`.

## Đầu vào và quy ước

- Range mỗi đối thủ là danh sách combo cụ thể `{ cards: readonly [Card, Card]; weight: number }`. Trọng số hữu hạn, không âm, tương đối. Nhận dạng combo theo hai lá vật lý, không phụ thuộc thứ tự. Bỏ combo bị blocker của hero, board hoặc lá chết công khai. Xử lý combo lặp có chủ đích và báo rõ input bất khả thi. P2b chỉ cần tạo dữ liệu tương thích về cấu trúc và có thể phát triển độc lập.
- Dùng tỉ lệ số thực trong [0, 1] cho xác suất và equity. Điểm phần trăm dùng riêng cho sai số hoặc ngưỡng “rõ ràng”. Đọc stack, pot và mức call từ snapshot quyết định hoặc tham số caller chuyển vào. Công thức không cần bài tương lai thật, kết quả ván hay quyền truy cập trạng thái UI.
- Trả về giả định có cấu trúc cho kết quả phụ thuộc range/EV. Ghi range, số đối thủ, pot, stack, cap, vị trí khi caller cung cấp, phương pháp tính và số mẫu khi có mô phỏng. Giữ riêng xác suất cải thiện và xác suất thắng.

## Xác suất và outs

- Tính chính xác xác suất hit ít nhất một trong n outs khi rút 1 hoặc 2 lá không hoàn lại. Hỗ trợ 47 lá chưa biết ở flop, 46 ở turn và quỹ lá hợp lệ nếu caller đã biết thêm lá chết. Kiểm cả 0 outs, không còn lá để hit trước river và input sai. Rule of 2/4 và bản chỉnh cho >8 outs là giá trị gần đúng riêng, chặn kết quả ngoài 0–100% và ghi rõ công thức.
- Duyệt các lá ứng viên trên flop/turn để trả về lá cải thiện bằng evaluator và phân biệt cải thiện hạng bài hoặc kicker với ví dụ set của H1. Hỗ trợ phép đếm nhóm cải thiện được caller chỉ định như hai lá J để lên set. Khi có range giả định, đánh giá theo combo hợp lệ ở street sau khi ra lá. Trả đủ thông tin tách lá giúp từ thua/hòa thành dẫn khỏi lá chỉ làm bài mạnh hơn và lá có kết quả hỗn hợp trong range. Xem `QUESTIONS.md` cho phân loại outs biên.
- Test H1 #7 cho 2 lá J, 2/47 ở turn và 1 − (45×44)/(47×46) tới river. Test cùng một lá có thể cải thiện bài nhưng vẫn thua một combo của đối thủ. Kết quả trước range phải ghi rõ giả định.

## Pot odds, equity và EV

- Pot odds dùng `call / (potBeforeCall + call)`. `potBeforeCall` đã gồm tiền cược đang đối mặt. Kèm pot-to-call theo x-to-1. Định nghĩa rõ kết quả khi không có khoản call, tránh NaN/Infinity trong giá trị truyền UI. Khóa H1 theo `70/30`, `170/50`, `270/50` và D8 theo `350/50` sau bet.
- Monte Carlo hỗ trợ preflop, flop, turn, river và nhiều đối thủ. Lấy một combo có trọng số từ mỗi range, không dùng trùng lá giữa các đối thủ hoặc với board/hero. Phân phối phải tương ứng tích trọng số của tổ hợp khả thi sau khi điều kiện hóa theo blocker và xung đột vật lý. Tránh chọn tuần tự rồi tự đổi trọng số do thứ tự ghế. Lấy lá board còn thiếu từ deck còn lại. Dùng thời hạn công việc hữu hạn cho input không khả thi và thông báo rõ nếu không đạt số mẫu. Test determinism, blocker, tình huống toàn hòa, river chắc thắng/thua, multiway với trọng số và cách chia equity hòa theo phần. Với ca nhỏ, đối chiếu một oracle liệt kê độc lập.
- Tính EV tại thời điểm quyết định. Fold bằng 0. EV call chính xác với equity đã cho và pot hero có quyền tranh, trừ phần call bỏ thêm. Khi có nhiều pot, dùng equity và số tiền đủ điều kiện theo từng pot đã được caller xác định, tránh tính pot hero không thể thắng. Bet/raise dùng giả định phản ứng của đối thủ do caller cung cấp, ghi rõ mức ước lượng. Đừng tự đổi luật cap hoặc coi cược vượt cap là hợp lệ.
- Cung cấp tính sai số outs, sai số pot odds và ngưỡng spot rõ ràng **lớn hơn** 5 điểm phần trăm. Khóa biên đúng 5 và M1–M3. Ghi rõ M4 thuộc màn tiến bộ, ngoài module này.

## Bàn giao

- Test dùng seed cố định cho RNG và giữ bất biến theo `AGENTS.md`. Với fixture chỉ tính toán, chứng minh calculator giữ nguyên trạng thái chip thật của fixture và INV-2; đối với giá trị đầu vào thuần, dùng fixture engine hợp lệ hoặc một trạng thái chip đầy đủ trước và sau các phép tính. Tránh gọi cùng kết quả implementation làm oracle cho chính nó.
- Chạy `npm.cmd run check`. Làm trên nhánh `p2a-calculator`. Commit file trong phạm vi, hoặc báo control nếu sandbox chắn Git. Không sửa spec, AC, cấu hình, module packet khác, hoặc push/merge. Nộp báo cáo tiếng Việt, map AC → test, commit và các giả định.
