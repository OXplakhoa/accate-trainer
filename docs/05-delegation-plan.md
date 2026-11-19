# Kế hoạch giao việc nhiều model (BẢN NHÁP)

## 1. Vai trò

| Vai trò | Ai | Làm gì | Không làm gì |
|---|---|---|---|
| **Control + main reviewer** | Session này (Claude Opus 5.5) | Giữ spec, chia task packet, giao việc, review cuối, cập nhật decision log, hỏi chủ sản phẩm khi có mâu thuẫn | Không tự sửa luật/spec mà không hỏi |
| **Independent reviewer** | **Gemini 4 Neon** và **GPT 6.2 Sol** | Review độc lập theo AC + invariant, không xem review của nhau | Không sửa code; chỉ báo lỗi kèm bằng chứng |
| **Implementer** | Gemini 4 Argon, Gemini 4 Hydrogen, GPT 6.1 Terra; trong session này còn có `ocx-gpt-6-astra`, `ocx-gpt-6-luna` | Viết code + test cho một task packet | Không đổi spec; gặp chỗ mơ hồ → ghi vào `QUESTIONS.md`, dừng phần đó |
| **Dự phòng (Claude native)** | Opus 5.5 (review), Sonnet 5.5 (code) | Chỉ dùng khi gói Gemini/GPT hết hạn mức, hoặc khi hai reviewer bất đồng và cần người thứ ba | — |
| **Chủ sản phẩm** | Bạn | Trả lời câu hỏi mở, duyệt 🟡, chơi thử, chấp nhận mốc | — |

### 1.1 Lực lượng và thứ tự ưu tiên (✅ theo bạn: dùng hết gói Gemini/GPT trước, Claude để sau)

| Model | Gói | Vai trò chính | Ghi chú |
|---|---|---|---|
| Gemini 4 Neon | Google Pro | Reviewer chính, implementer cho packet khó (P1c) | Theo bạn: benchmark > Opus 5.5, ~ Fable 5.2 |
| GPT 6.2 Sol | GPT Plus | Reviewer chính | — |
| Gemini 4 Argon | Google Pro | Implementer | — |
| Gemini 4 Hydrogen | Google Pro | Implementer packet nhỏ/rõ (P0, P1b, P5) | — |
| GPT 6.1 Terra | GPT Plus | Implementer | — |
| `ocx-gpt-6-1-sol`, `ocx-gpt-6-astra`, `ocx-gpt-6-luna` | qua proxy trong session này | Control gọi trực tiếp được | Đây là những agent duy nhất session này **tự gọi** được; các model còn lại bạn chạy bên ngoài |
| Opus 5.5, Sonnet 5.5 | Claude Pro | Dự phòng | Session control này vẫn là Claude |

Tên và benchmark các model trên là theo bạn cung cấp, mình **chưa xác minh**. Với model chạy bên ngoài session (Gemini, GPT 6.2 Sol, 6.1 Terra): control soạn sẵn task packet ở §4 hoặc yêu cầu review ở §5 để bạn dán vào. Bạn gửi lại kết quả (diff/branch hoặc báo cáo review) để control tổng hợp.

## 2. Quy trình cho mỗi task packet

```
Control viết packet  →  Implementer làm (worktree/branch riêng)
   →  Test tự động pass + invariant pass
   →  2 reviewer độc lập song song (AC, invariant, luật Accate)
   →  Control tổng hợp: lỗi thật / bất đồng / bỏ qua
   →  Implementer sửa  →  Control review cuối  →  merge
   →  (mốc có UI) Bạn chơi thử trên điện thoại + máy tính
```

Quy tắc:
1. **Một packet = một nhóm AC.** Packet không được sửa file của packet khác đang chạy song song.
2. **Implementer và reviewer luôn là model khác nhau** cho cùng một packet.
3. Reviewer phải chỉ ra **AC nào fail, input nào, kết quả mong đợi/thực tế**. Ý kiến không có bằng chứng xếp vào "gợi ý", không chặn merge.
4. Hai reviewer bất đồng → control quyết theo spec; nếu spec không nói → hỏi bạn, ghi vào decision log.
5. Engine luật (M1) phải merge và ổn định **trước** mọi thứ khác; mọi mốc sau gọi engine, không tự viết lại luật.
6. INV-1 (tổng chip theo mệnh giá = 6.500) và INV-2 (pot = tổng đóng góp) chạy sau **mọi** bước trong mọi test.

## 3. Task packet theo mốc

| Mốc | Packet | Nội dung | AC | Implementer đề xuất | Song song được với |
|---|---|---|---|---|---|
| M0 | P0 | Chọn stack, khung project, test runner, RNG có seed | — | Gemini 4 Hydrogen | — |
| M1 | P1a | Bài, xào, đánh giá tay 5/7 lá | S (phần Hold'em) | `ocx-gpt-6-astra` | P1b |
| M1 | P1b | Chip, kho, phát chip (bảng 7 dòng), đổi chip, rebuy/cash out | C | Gemini 4 Hydrogen | P1a |
| M1 | P1c | Vòng cược (kể cả tuỳ chọn preflop), cap, hô trước lượt, side pot, showdown, bài cào | R, X, P, S | **Gemini 4 Neon** | — (cần P1a, P1b) |
| M1 | P1d | Ván H1 chạy trọn từ đầu tới cuối | H1 | Control kiểm | — |
| M2 | P2a | Calculator: outs, Rule 2&4, pot odds, equity Monte Carlo | M | GPT 6.1 Terra | P2b |
| M2 | P2b | 9 rival (gồm Nóng có trạng thái tilt) + tham số kiểu chơi | B | `ocx-gpt-6-luna` | P2a |
| M3 | P3 | Drill 4 cấp + feedback + chỉ số | D, F, M | Gemini 4 Argon | P4 (UI riêng) |
| M4 | P4 | Bàn Sandbox + Cài đặt + UI/motion/sound | T | Gemini 4 Neon | P3 |
| M5 | P5 | Tournament: đồng hồ, hết giờ | O | Gemini 4 Hydrogen | — |

Reviewer mặc định cho mọi packet: **Gemini 4 Neon + GPT 6.2 Sol**. Khi Neon là implementer (P1c, P4), Neon được thay bằng `ocx-gpt-6-1-sol`; nếu vẫn thiếu thì dùng Opus 5.5 (context sạch). Control (session này) luôn review cuối.

## 4. Mẫu task packet

```
# Packet <id>: <tên>
Đọc: docs/02-spec.md §<…>, docs/03-acceptance-criteria.md nhóm <…>, docs/04 (quyết định liên quan)
Phạm vi file: <thư mục được sửa>
Không được: đổi luật, đổi spec, sửa file ngoài phạm vi
Xong khi: mọi AC nhóm <…> có test tự động và pass; INV-1/INV-2 pass; không có TODO ẩn
Mơ hồ: ghi QUESTIONS.md, làm phần còn lại
Nộp: danh sách AC → tên test, lệnh chạy test, ghi chú giả định
```

## 5. Mẫu yêu cầu review

```
Review packet <id> độc lập. Đừng đọc review khác.
Đối chiếu: docs/03 nhóm <…>, invariant INV-1/INV-2, luật docs/02 §3.
Báo cáo mỗi lỗi: AC id · input/seed · mong đợi · thực tế · file:dòng.
Tách riêng: (1) lỗi chặn merge (2) gợi ý.
Không sửa code.
```

## 6. Trước khi giao implement

O1, O2, O4, O12 đã trả lời → **không còn câu hỏi nào chặn bàn giao.** Các 🟡 còn lại đi cùng đề xuất tạm, bạn duyệt khi chơi thử.
