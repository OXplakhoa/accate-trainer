# Prototype Luyện tập 3D

**Mục tiêu.** Người chơi hiểu và lặp lại cách quyết định bằng nhẩm phần trăm. Cảnh 3D giúp đọc bài, pot và khoản Call ngay tại bàn. Prototype độc lập trên nhánh `prototype/drill-3d`, base `6361a29`, route `/prototype-3d.html`. Luật, engine, spec chính, UI Drill/Sandbox/Tournament hiện hành nằm ngoài phạm vi prototype. Assets tự tạo, tham chiếu cảm giác có nhân vật ngồi chơi của Poker Night.

## Cảnh và bố cục

- Phòng sáng, tường kem #F3E8D4, bàn nỉ xanh hồ #34786D, viền cacao #533C31, Cá xanh #4F9DD3, Cáo cam #E18A46, Nóng đỏ gạch #C95849. Chất liệu lì, ánh sáng dịu và hình khối rõ. Phông sans hỗ trợ tiếng Việt, số có chiều rộng đều.
- Bốn ghế gồm Hero phía trước, Cá, Cáo và Nóng. Rival có cơ thể, tay, trang phục và đầu đặc trưng. Cá có vây và mắt tròn, Cáo có tai và mõm rõ, Nóng là đầu ấm nước có biểu cảm. Chỗ nhìn quan trọng nhất là mặt bàn cùng nhân vật.
- Desktop dùng cảnh lớn bên trái và bài học bên phải; mobile xếp cảnh trước điều khiển với bài và số đọc tốt ở 320 px. Bài Hero, bốn lá chung, pot và Call luôn có bản DOM truy cập được. Cảnh Three.js và lời giải đồng bộ highlight; fallback đọc được khi WebGL lỗi.
- Góc ngang khi vào bàn, góc chéo cố định khi quyết định, góc phản ứng khi xem lời giải. Chuyển cảnh lúc bắt đầu quyết định bằng cắt trực tiếp để đồng hồ và camera không cạnh tranh. Giảm chuyển động tắt các chuyển tiếp phụ. Không render lặp khi cảnh đứng yên.

## Bài học

- Dùng hai snapshot tình huống Turn độc lập với kết quả chia bài. Các lá của rival chưa lật. Mô hình học giả định Hero đang thua, mỗi lá cơ còn lại đều thắng, không xét blocker và không trả thêm để xem River. Có 9 outs và 46 lá chưa thấy. Pot hiển thị đã gồm mức cược của đối thủ. Ca chính pot 150 / Call 50; ca sát ngưỡng pot 160 / Call 40.
- Cấp 1 có câu riêng cho outs, % nhẩm, % cần, action; giải thích ngay đúng bước, cho thử lại và nêu vì sao mẫu số là pot sau Call. Cấp 3 cho tự chọn Call hoặc Fold khi đồng hồ chạy (mốc thử 20 giây); cuối spot mới có lời giải. Khi hết giờ ghi rõ hết giờ và mở lời giải, tránh quy kết rằng người dùng đã chọn Fold.
- Lời giải ngắn đọc trọn, mỗi dòng là nút có thể bấm để nhấn vào outs, pot, call, hoặc tổng pot trên bàn. Hiện giải thích chính xác theo yêu cầu trong phần đọc sâu, gồm vì sao Rule of 4 chỉ áp dụng khi chắc xem cả hai lá với giá đang xét và phân biệt % hit với equity. Ví dụ 50 trên 200 = 25% và giải thích hòa vốn một lần thắng +150, ba lần thua -50. Ca sát ngưỡng dẫn từ 9 × 2 ≈ 18% đến 9/46 ≈ 19,6% dưới 20% trong mô hình và tránh làm tròn vượt ngưỡng. Nguồn Hopkins Lecture 2 và 7.
- Không hiển thị đáp án hoặc minh họa outs khi Cấp 3 đang đếm. Chuyển cấp hoặc đổi spot phải dọn lượt hẹn giờ cũ. Tương tác bằng bàn phím, không cuộn ngang ở 320 px.

## Giao diện giữa hai lane

`src/ui/drill3d/contract.ts` thuộc Control. Scene lane export `DrillScene` từ `scene/DrillScene.tsx`. Lesson lane export `DrillLesson` từ `lesson/DrillLesson.tsx`. Tên props trong contract, shell hiển thị hai thành phần và quản lý state. Cấp 1 và 3 hiển thị từ cùng Lesson lane. Cả hai đi theo tiếng Việt và giữ thuật ngữ poker quen thuộc.

Scene owner Gemini 4 Neon High. Lesson owner GPT 6.1 Terra High. Mỗi lane dùng worktree riêng; Control tích hợp trên nhánh prototype. Hai model khác nhau review độc lập SHA tích hợp, ưu tiên Hydrogen High và Argon High. Preview là cổng duyệt trực quan.

## Motion và Sound FX

- Nhịp vào bàn và xem phản ứng có chuyển động ngắn, camera chuyển dứt khoát vào vị trí nhẩm. Chỉ dùng motion ở lúc đổi cảnh, tương tác với bàn và chỉ số đang giải thích. Ưu tiên transform/opacity và kết thúc render khi cảnh đứng yên. Chế độ giảm chuyển động hiển thị kết quả tại chỗ.
- Sound FX riêng cho bài vào bàn, chip Call, Fold, trả lời đúng/sai và ba giây cuối. Âm ngắn, khác nhau rõ, cân gain để không chói, sắp lớp hợp lý. Cấp 3 chỉ phát âm thao tác trước khi chốt action hoặc hết thời gian. Phản hồi đúng/sai chỉ theo chính sách từng cấp. Không phát âm khi tab ẩn. Nút tắt âm dừng ngay lớp âm hiện tại.
- Chỉ mở Web Audio từ thao tác người dùng. Hỗ trợ không có Web Audio, đóng và giải phóng khi unmount. Review lại liên kết timeout với âm thanh và các lần reset tình huống.
