# Packet P1b-fix1 — Sửa sổ phiên và kiểm tra bảo toàn chip

**Implementer** Gemini 4 Hydrogen, effort high.

**Worktree** `F:/CODE/Poke/.worktrees/p1b`, nhánh `p1b-chips`, mốc đã review `f4863de`.

Đọc `AGENTS.md`, `docs/packets/P1b-chips.md`, `docs/02-spec.md` §3.5–3.5.1, AC C1, C5–C7, các quyết định D14–D17, D24b–D24c và O9. Giữ API, luật, spec và AC. Phạm vi sửa gồm `src/engine/ledger.ts`, `tests/engine/ledger.test.ts` và `tests/engine/bank.test.ts`.

## Sửa bắt buộc

- **B1 · C7.** `summarizeLedger` phải ghi nhận ID `"__proto__"` như một khóa riêng có thể liệt kê và serialize. Dùng cấu trúc lưu khóa an toàn, giữ API `Readonly<Record<string, PlayerLedger>>`. Test một buy-in 500 của ID đó và kiểm entry, `buyIns = 1`, `invested = 500` và JSON. Kê đủ bộ chip trong fixture.
- **B2 · C5.** Kiểm `checkInv1` sau khi dựng trạng thái từ `initialDistribution(10)` và sau từng giao dịch chuyển stack `p7 → p0`, `p8 → p1`, `p9 → p2`. Giữ các kiểm tra sau từng rebuy, cash out và buy-in.
- **B3 · INV-1.** Trong test lỗi của `planBuyIn`, kê đủ bộ chip theo từng mệnh giá bằng phần chip còn lại của fixture. Giữ kho 400 và người đủ điều kiện lớn nhất 450. Kiểm `checkInv1` sau mỗi lần gọi với `openerIndex` là `0`, `-1` và `2`.

## Bổ sung test

- **C1.** Dùng kho 10 chip 5 và 5 chip 100. Tổ hợp ưu tiên 10 chip 5 để lại 450 không ghép được bằng chip 100. Kiểm kết quả cuối lấy đúng 5 chip 100.
- **C5.** Thêm ca kho còn `{5:20, 10:10, 50:2, 100:0}` và stack lớn nhất cash out 5 chip 100. Người rebuy nhận `{5:20, 10:10, 50:2, 100:2}`. Kê đủ bộ chip và kiểm INV-1 sau cash out và sau buy-in. Có thể dùng stack lớn nhất gồm 25 chip 100, buyer rỗng và hai stack còn lại mỗi stack gồm 40 chip 5, 45 chip 10 và 24 chip 50.

Control đã kiểm vét cạn các stack trong giới hạn bộ chip và xác nhận mọi stack từ 500 trở lên đều ghép được đúng 500. Các quyết định về rebuy khi chưa thể cash out và ghế mở lời đã rời bàn dành cho P1c.

## Bàn giao

Dùng seed cố định nếu cần RNG. Kiểm INV-1 theo từng mệnh giá sau mỗi bước và chạy `npm.cmd run check`. Nếu Vitest vướng quyền ghi cấu hình tạm, dùng `npm.cmd run check -- -- --pool threads --configLoader runner --no-cache` và ghi rõ.

Commit các file trong phạm vi trên nhánh `p1b-chips`. Nếu sandbox chặn ghi `.git`, để control commit và ghi rõ trong báo cáo. Không push hoặc merge. Báo commit hoặc tình trạng worktree, B1–B3 và C1/C5 → test, kết quả kiểm tra trong phản hồi cuối bằng tiếng Việt. Nếu gặp chỗ spec mâu thuẫn, ghi vào báo cáo để control cập nhật `QUESTIONS.md`.
