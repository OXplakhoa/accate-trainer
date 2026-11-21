# Packet P5 — Tournament

Gemini 4 Hydrogen High triển khai trên nhánh `p5-tournament` tại `.worktrees/p5`, base `9a6482e0da569ed1e736215fe8c806973f48861e`. Gemini 4 Neon High và GPT 6.1 Terra High review độc lập cùng SHA. Control chạy lại các gate và giữ quyền merge.

## Nguồn và phạm vi

Đọc `AGENTS.md`, `docs/02-spec.md` §3.4, §7–9, §11, `docs/03-acceptance-criteria.md` O1–O6 và X7, `docs/04-decisions-and-open-questions.md` D34–D36, D39–D40 và O11, `docs/05-delegation-plan.md`, `QUESTIONS.md` và `docs/packets/P4-sandbox.md`. Ghi mâu thuẫn thật vào `QUESTIONS.md` và tiếp tục phần đã rõ. Giữ nguyên luật và tài liệu chuẩn.

Phạm vi `src/ui/tournament/**`, `src/ui/App.tsx`, CSS của App nếu cần, `src/ui/sandbox/**` với chỉnh sửa tối thiểu cho tích hợp, các test UI liên quan và packet này. Tái dùng bàn Sandbox, nỉ xanh trầm và màu ấm D40. Thêm Tournament vào điều hướng hiện tại. Drill vẫn mở mặc định, giữ luồng lưu trạng thái và luyện spot của Drill/Sandbox. Khi rời Tournament, dọn timer và audio của bàn ẩn. Kiểm tra khi quay lại không có timeout ngầm hoặc đồng hồ bị kẹt. Tournament dùng nguyên luồng rebuy/cash out và không loại người theo D34.

## Đồng hồ và phản hồi

- Ghép `SandboxApp` bằng `mode="tournament"`, `timerSlot`, `onHeroTurnChange`, `onDealAnimationEnd`, `onControllerReady` và `disableMidHandFeedback`. Đọc settings đã áp dụng cho ván từ controller. Thời lượng đúng 10/15/20/25 giây, mặc định 20. Đổi trong ván áp dụng từ ván sau. Thời gian chọn chip nằm trong đồng hồ.
- Chỉ đếm khi hero có quyết định tự do và animation chia/lật hiện hành báo `outcome === 'completed'`. Ghép đúng danh tính lần chia và lượt, xử lý hai thứ tự callback, hero đến lượt sát lúc lật bài, lần chia bị `superseded`, hai lần chia nối tiếp, reset session và reduced motion. Completion của lần cũ không cấp quyền cho lần mới. Lượt đã kết thúc hoặc hand đã đổi phải vô hiệu timer cũ dù callback đến trễ.
- Khi hết giờ, gọi `autoTimeoutHeroAction()` đúng một lần cho lượt hiện hành. Controller check nếu hợp lệ, nếu không thì fold. Trả toàn bộ chip staged và giữ contribution đã vào pot. Test action thủ công sát hạn và lượt tiếp theo.
- Lời hô còn hiệu lực chạy theo engine và không mở đồng hồ. Lời hô bị huỷ cho hero đủ thời gian sau khi animation hiện hành đã xong. Giữ timeline/feedback cuối ván.
- Dùng kênh âm timer sẵn có cho ba giây cuối, tôn trọng mute, timer volume và yêu cầu mở audio bằng thao tác người dùng. Hiện số giây dễ đọc tại khu vực action, có thể đọc bằng bàn phím/trình đọc màn hình, không phụ thuộc màu. Feedback đánh giá và pot odds chỉ hiện sau ván, vẫn cho phép thông báo thao tác cần thiết để chơi.

## Bàn giao

Thêm test tất định cho O1–O6 và X7, gồm timeout đúng một lần, chip hoàn trả, cả hai nhánh lời hô, hai thứ tự animation/lượt, superseded, reduced motion, thay ván và settings. Test dùng engine kiểm INV-1 theo từng mệnh giá và INV-2 sau từng bước. Giữ engine TypeScript thuần và RNG có seed. Chạy `npm ci`, `npm run check` và `npm run build`. Ghi AC → test hoặc bước tái hiện, kết quả, quyết định về vòng đời khi đổi mode, SHA nếu commit được và các mục chưa chạy. Chỉ làm trong worktree P5. Không push hoặc merge. Báo cáo tiếng Việt.
