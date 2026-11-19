# Packet P1a-fix1 — Sửa bài cào và bổ sung test evaluator

**Implementer** GPT 6.1 Terra, effort medium.

**Worktree** `F:/CODE/Poke/.worktrees/p1a`, nhánh `p1a-cards`, mốc đã review `ce2a4e5`.

Đọc `AGENTS.md`, `docs/packets/P1a-cards.md`, `docs/02-spec.md` §3.6–3.7 và AC S1–S4, S7. Packet này chốt cách triển khai các ca biên đã review. Giữ API, luật, spec và AC. Phạm vi sửa gồm `src/engine/baiCao.ts`, `tests/engine/baiCao.test.ts` và `tests/engine/handEval.test.ts`.

## Sửa bắt buộc

- **A1 · S7.** Khi cạn nguồn giữa một tay, giữ nguyên 1–2 lá người hiện tại đang cầm. Chỉ xào lại các lá đã rút của những tay hoàn tất, cộng số lá còn trong nguồn nếu có. Mỗi tay phải có đúng ba lá phân biệt theo rank và suit. Làm mới nguồn bằng `Rng` đã truyền vào và giữ kết quả các tay đã ghi. Test seed cố định với nguồn 31 lá ở bàn tám người và ca bốn lá `As 2s 3s 4s`. Kiểm từng tay trong mọi vòng.
- **A2.** Khi không đủ ba lá phân biệt để tạo một tay, throw lỗi rõ ràng. Test nguồn 0, 1 và 2 lá.
- **A3 · S2/S7.** Cho phép giải quyết trong tối đa 1.000 vòng. Nếu vòng 1.000 vẫn hòa, throw lỗi rõ ràng và ghi comment rằng giới hạn bảo vệ trường hợp nguồn suy biến. Test hai người với nguồn `Jc Qd Kh Jh Qs Kc`.
- **A4 · S7.** Với mười người và 27 lá, test xác minh lần xào nhận đúng multiset của 27 lá đã rút, lá sau xào khớp RNG seed cố định và khác thứ tự khi giữ nguyên nguồn. Test phải fail khi thay thao tác xào bằng phép sao chép giữ thứ tự. Kiểm `winnerId` khớp một người thắng duy nhất ở vòng cuối.

## Bổ sung test evaluator

Kiểm `compareHands` giữa hai category khác nhau theo cả hai hướng, gồm giá trị `-1`. Thêm một tay sáu lá. Kiểm hai tay `As Js 9s 7s 3s` và `Ah Jh 9h 7h 3h` có cùng hạng và so sánh bằng 0.

## Bàn giao

Dùng seed cố định và kiểm INV-1 theo `AGENTS.md`. Chạy `npm.cmd run check`. Nếu Vitest vướng quyền ghi cấu hình tạm, dùng `npm.cmd run check -- -- --pool threads --configLoader runner --no-cache` và ghi rõ. Báo danh sách file sửa, A1–A4 → test, các test evaluator và kết quả kiểm tra trong phản hồi cuối bằng tiếng Việt.

Để control tạo commit vì sandbox GPT giới hạn quyền ghi `.git`. Không stage, push hoặc merge. Nếu gặp chỗ spec mâu thuẫn, ghi vào báo cáo để control cập nhật `QUESTIONS.md`.
