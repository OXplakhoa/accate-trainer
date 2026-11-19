# Questions & Assumptions (P0)

1. **`checkInv1` sign convention for `diff`:**
   `docs/packets/P0-scaffold.md` §2 specifies `{ ok: false; diff: Record<Denomination, number> }` and §3 states "thiếu 1 chip 10 và thừa 2 chip 5" (missing 1×10 and 2 extra×5).
   - **Assumption made:** `diff[d] = actualTotal[d] - CHIP_SET[d]` (positive = surplus/thừa, negative = deficit/thiếu), yielding `{ 5: 2, 10: -1, 50: 0, 100: 0 }`.
   - Please confirm if the opposite sign (`CHIP_SET[d] - actualTotal[d]`) was intended.

2. **`fork(label)` `.seed` format and empty label:**
   - **Assumption made:** `fork(label)` derives the child via `createRng(`${parentSeed.length}:${parentSeed}:${label}`)` so child `.seed` is deterministic, collision-free, and reproducible via `createRng(child.seed)`. Empty string `""` is accepted as a seed/label.

## P1c

1. **All-in chủ động.** Spec §3.3 cho hero chủ động bỏ hết khi stack nằm trong cap. D13b ghi all-in chỉ khi stack nhỏ hơn khoản cần bỏ. Phần đã rõ là call thiếu chip trong cap và đánh dấu all-in khi một action hợp lệ làm stack về 0. Hai nguồn chưa thống nhất về action chủ động riêng ngoài những ca này.
2. **Bước bắt buộc thiếu chip đúng mệnh giá.** D20/D21 cho đổi chip với người khác hoặc pot nhưng chưa nêu engine có tự đổi từ stack hoặc kho để thu ante hay trả pot chính xác hay không. Ví dụ S5 có thể gặp pot `100 + 10 + 5` sau khi đổi chip, trong khi hai khoản trả cần là 55 và 60. Triển khai các cơ cấu thanh toán được và hỗ trợ đổi chip cùng giá trị theo luật hiện hành. Giữ nguyên trạng thái khi chưa có phép đổi cần thiết, để có thể tiếp tục sau khi đổi.
