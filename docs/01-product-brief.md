# Accate Trainer — Product Brief (BẢN NHÁP, chờ duyệt)

> Ký hiệu trạng thái dùng trong toàn bộ bộ tài liệu:
> ✅ = chủ sản phẩm đã duyệt · 🟡 = đề xuất / giả định tạm của Claude, chờ duyệt · ❓ = câu hỏi còn mở

## 1. Người dùng
Một người chơi poker nghiệp dư (chủ sản phẩm), chơi định kỳ với nhóm bạn theo luật bàn riêng gọi là **"ăn cà te / Accate"**. Từng học khóa Johns Hopkins Poker Course và từng biết tính, nhưng **đã quên cách tính outs, %, pot odds và lý do đằng sau các con số**. Luyện **một mình** (✅ D26), trên máy tính ở nhà hoặc điện thoại, luôn có mạng.

## 2. Vấn đề
- Tự trải bài để luyện không tái hiện được việc đọc hành động đối thủ, ước lượng xác suất và quyết định dưới áp lực thời gian.
- Kiến thức khóa Hopkins viết cho No-Limit Hold'em có blind; bàn của nhóm có **ante, không preflop, cap 50 mỗi street, chip vật lý 4 mệnh giá** → các con số và lời khuyên cần điều chỉnh.
- Không thể luyện "tính nhanh" khi chưa "tính được": cần **học lại trước, luyện sau**.

## 3. Mục tiêu học
1. Đếm outs nhanh và đúng, kể cả outs "bẩn".
2. Phân biệt **xác suất cải thiện bài** (gặp thêm lá) với **equity** (khả năng thắng trước range đối thủ).
3. Quy outs ra % (Rule of 2 & 4) và tính **pot odds** (equity cần để call).
4. Đọc **board texture** (dry / wet / nhiều draw) và đọc hành động theo **kiểu rival**.
5. Chọn hành động và bet size hợp lệ theo luật, hợp lý theo thông tin đang có.
6. Đánh giá quyết định theo **thông tin tại thời điểm quyết định** — quyết định tốt vẫn có thể thua river.

## 4. Vòng lặp trải nghiệm
```
Chọn cấp & mode (tự do, không khóa)
  → Bàn mô phỏng với các rival có tính cách, chip thật, luật Accate
  → Tới lượt bạn: (tuỳ cấp) app hỏi từng bước / bạn tự giải / bạn quyết trong thời gian giới hạn
  → Feedback (ngay / sau ván, tuỳ cấp)
  → Chỉ số tiến bộ cập nhật → app gợi ý cấp tiếp theo
```
Ba mode (✅ D29 — bản giao là bản trọn vẹn):
- **Drill** — luyện theo 4 cấp (Học lại → Tính từng bước → Tự giải → Áp lực thật).
- **Bàn Sandbox** — chơi trọn ván liên tục, rebuy, cash out, cấu hình đầy đủ.
- **Tournament** — Bàn Sandbox + đồng hồ mỗi lượt (✅ D34–D36).

## 5. Tiêu chí thành công
Sản phẩm đạt mục tiêu khi, sau một thời gian luyện, chủ sản phẩm đạt trên các spot có đáp án rõ (🟡 ngưỡng đề xuất):
| Chỉ số | Mục tiêu |
|---|---|
| Đếm outs đúng | ≥ 90% |
| Sai số quy outs → % | ≤ 3 điểm % |
| Sai số pot odds (equity cần) | ≤ 3 điểm % |
| Quyết định đúng ở spot rõ | ≥ 90% |
| Tốc độ (trung vị, câu đúng) | nhỏ hơn thời gian đồng hồ đã chọn |
| EV mất / quyết định | giảm dần theo tuần |

Và chủ sản phẩm thấy bàn mô phỏng "giống bàn nhóm mình": chip, cap, rival quen mặt, hô bet sớm, bài cào khi hòa.

## 6. Nền tảng đề xuất (🟡, chờ duyệt) và lý do
**Web app responsive, chạy hoàn toàn phía client, dữ liệu lưu trên thiết bị.** Có thể bổ sung PWA để "cài" như app.

| Nhu cầu đã xác nhận | Hệ quả |
|---|---|
| Máy tính + điện thoại | Một web app co giãn, không cần hai app |
| Luôn có mạng | Không bắt buộc offline (PWA chỉ là tiện ích) |
| Luyện một mình (D26) | **Không cần server multiplayer**, không cần tài khoản |
| UI/UX, motion, sound là ưu tiên (D32) | Web hiện đại đủ khả năng animation & audio chất lượng cao |

**Quyết định nào đổi nếu nhu cầu đổi:**
- Muốn rủ bạn vào bàn qua link → cần server realtime, tài khoản, đồng bộ trạng thái; công sức tăng nhiều lần.
- Muốn tiến độ đồng bộ giữa điện thoại và máy tính → cần backend lưu trữ đơn giản.
- Muốn dùng hoàn toàn offline → thêm PWA cache (chi phí nhỏ).

Chọn stack/framework: để dành cho giai đoạn triển khai.
