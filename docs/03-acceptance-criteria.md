# Accate Trainer — Acceptance Criteria (BẢN NHÁP, chờ duyệt)

Quy ước:
- Mọi test engine dùng **seed cố định** cho bộ bài và cho việc random người mở lời, để kết quả lặp lại được.
- Ghế ngồi theo chiều kim đồng hồ: A → B → C → D → E → F → (G…J).
- "Góp" = góp-trong-street, không tính ante.
- Sau **mọi** bước trong mọi test, hai bất biến sau phải đúng:
  - **INV-1:** tổng stack + pot + kho = 6.500 điểm, và đúng theo **từng mệnh giá** (100/100/50/25 chip).
  - **INV-2:** pot = tổng mọi khoản đã góp (gồm ante) trong ván.

---

## H1 — Ván xuyên suốt (6 người, biến thể "Flop trước")

**Thiết lập**
- 6 người, mỗi người 500. Cơ cấu chip: 16×5, 12×10, 6×50.
- Hero = **C**. Rival: A = Cá, B = Điên, D = Đá, E = Cáo, F = Thỏ. Dealer = F.
- Seed: người mở lời của ván = **D**. Tắt hô sớm.
- Bài: C **J♠J♦** · B **8♥6♥** · A K♦4♣ · D Q♣3♦ · E A♣T♠ · F 4♦3♣.
- Board: flop **9♥7♥2♣** · turn **5♠** · river **K♣**.

| # | Bước | Kỳ vọng |
|---|---|---|
| 1 | Ante | Mỗi người −5 → pot **30**, mọi stack **495**. Animation chip vào pot |
| 2 | Chia bài | Mỗi người 2 lá. Chưa có vòng cược. Nút hành động bị khóa |
| 3 | Lật flop | 3 lá ngửa cùng lúc. Indicator lượt chỉ vào **D** |
| 4 | Flop: D check, E check, F check | Hợp lệ (chưa ai bet) |
| 5 | A bet 10 | Mức cược hiện hành = 10. Pot 40 |
| 6 | B raise lên 30 | Hiển thị **"Raise lên 30 (+20)"**. Pot 70 |
| 7 | Lượt **C (hero)** | Nút: Fold / Call 30 / Raise lên 35…50. **Không có nút Check.** Equity cần = 30/(70+30) = **30,0%** |
| 8 | C bấm chip 10+10+10 → Call | Pot 100, stack C = 465 |
| 9 | D, E, F (đã check trước đó, nay phải trả 30) → fold cả ba | Không ai được check |
| 10 | A call thêm 20 | Pot **120**. Vòng flop đóng (A, B, C đều góp 30) |
| 11 | Lật turn 5♠ | Người mở lời vẫn tính từ D; D, E, F đã fold → lượt đến **A** |
| 12 | A check, B bet 50 | Mức cược = 50 = cap. Pot 170 |
| 13 | Lượt C | Nút: Fold / Call 50. **Nút Raise bị vô hiệu** (đã chạm cap). Equity cần = 50/220 = **22,7%** |
| 14 | C call, A fold | Pot **220**. Stack B = 415, C = 415, A = 465 |
| 15 | Lật river K♣ | Thứ tự: B → C |
| 16 | B bet 50; C: equity cần = 50/320 = **15,6%**; C call | Pot **320** |
| 17 | Showdown | B: sảnh 5-6-7-8-9. C: đôi J. **B thắng 320** |
| 18 | Kết thúc | Stack: A 465 · B **685** · C **365** · D/E/F 495. Tổng 3.000 ✔ |
| 19 | Màn xem lại | Mỗi quyết định của C có pot odds đúng như #7, #13, #16. Mỗi quyết định có nhãn chất lượng chấm **độc lập với kết quả**, và có dòng "Kết quả ván: thua — không ảnh hưởng điểm quyết định" |

Kiểm tra bộ tính toán tại #7 (J-J, flop 9♥7♥2♣):
- Lá giúp C lên set = **2** (J♥, J♣). Số lá chưa biết = **47**.
- % trúng ở turn = 2/47 = **4,26%**. % trúng tới river = 1 − (45·44)/(47·46) = **8,42%**. Rule of 4 → 8%.
- Feedback phải nói rõ: con số 8,42% là **xác suất gặp thêm J**, không phải xác suất thắng. Equity trước range của Điên được tính riêng, kèm giả định về range.

---

## R — Luật cược

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| R1 | Flop: A bet 20, B raise lên 50, đến lượt C | C chỉ có Call 50 / Fold. Khi về A: Call +30 / Fold |
| R2 | Flop B bet 50, mọi người call; turn B bet 50 | Hợp lệ. Cap tính lại từ 0 ở mỗi street |
| R3 | Sau ante, người đầu tiên bet 50 trên flop | Hợp lệ (ante không tính vào cap; tổng đã bỏ = 55) |
| R4 | A bet 20; B thử raise lên 25 / 22 / 55 | 25: hợp lệ · 22: từ chối (không phải bội 5) · 55: từ chối (vượt cap) |
| R5 | A bet 10; người sau thử check | Không có nút Check |
| R6 | Bet 0 hoặc bet 3 | Từ chối |
| R7 | Người mở lời ván là D; D fold ở flop | Từ turn, lượt bắt đầu ở người đầu tiên còn trong ván theo chiều kim đồng hồ tính từ D |
| R8 | Flop: A bet 10, mọi người fold | A nhận pot ngay. Không lật turn. Bài A không bị lộ |
| R9 | Còn 2 người, một người all-in, người kia đã call | Tự động lật hết board rồi showdown, không còn vòng cược |
| R10 | Một vòng: A bet 5, B raise lên 10, C raise lên 15, … tới 50 | Hợp lệ; sau khi chạm 50 chỉ còn call/fold |
| R11 | Tắt "Cược trước flop" (mặc định) | Sau khi chia bài lật flop ngay, không có vòng cược nào trước flop |
| R12 | Bật "Cược trước flop", cap preflop 50 | Sau khi chia 2 lá có vòng cược preflop, bắt đầu từ người mở lời của ván; rồi mới lật flop |
| R13 | Bật preflop; A bet 50 preflop, mọi người call; flop A bet 50 | Hợp lệ: cap preflop và cap flop tính riêng |
| R14 | Bật preflop, cap preflop = 20; B thử raise lên 25 preflop | Từ chối; cap flop vẫn là 50 |
| R15 | Bật preflop; A bet 10 preflop, mọi người fold | A nhận pot, **không lật flop** |
| R16 | Bật preflop; mọi người check preflop | Lật flop, vòng flop bắt đầu bình thường |

## X — Hành động trước lượt (bật hô sớm)

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| X1 | Thứ tự D, E, F, A, B, C. B (Điên) **hô "bet 20"** khi D đang tới lượt. D, E, F, A đều check | Bong bóng lời hô + chip đẩy ra nhưng chưa vào pot. Tới lượt B → bet 20 được thực hiện tự động, **bắt buộc** |
| X2 | Như X1, nhưng A bet 10 trước khi tới lượt B | Lời hô của B **bị huỷ**; chip 20 trả về stack B; B quyết định lại tự do (fold / call 10 / raise) |
| X3 | Màn xem lại sau ván có lời hô sớm | Lời hô xuất hiện trong timeline như một hành động công khai (kể cả lời hô đã bị huỷ) |
| X4 | Chưa tới lượt hero; hero bấm 2×10 rồi "Hô trước: bet 20"; những người trước đều check | 20 chip đẩy ra trước mặt hero, chưa vào pot. Tới lượt hero → bet 20 tự thực hiện, không hỏi lại |
| X5 | Như X4, nhưng một rival raise lên 40 trước khi tới lượt hero | Lời hô huỷ; 2×10 trả về stack hero; hero thấy đủ Fold / Call 40 / Raise. Hero fold → không mất 20 |
| X6 | Như X4; hero muốn rút lời hô khi action chưa đổi | Không có nút rút (🟡) |
| X7 | Tournament: hero đã hô trước, tới lượt hero | Lời hô còn hiệu lực thì thực hiện ngay, đồng hồ không chạy; nếu bị huỷ, đồng hồ chạy đủ thời gian |

## P — Side pot

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| P1 | 4 người A, B, C, D (ante 20). A chỉ còn 30. Flop: B bet 50, A all-in 30, C call 50, D fold | Main pot = 20 + 30×3 = **110** (A, B, C). Side pot = 20×2 = **40** (B, C) |
| P2 | Tiếp P1: turn B bet 40, C call | Side pot = **120**. A không góp thêm, vẫn được xem tới river |
| P3 | Tiếp P2: showdown A > B > C | A nhận 110; B nhận 120 |
| P4 | 4 người (ante 20). A còn 15, D còn 35. Flop: B bet 50, C call, A all-in 15, D all-in 35 | Main = 20 + 15×4 = **80** (A, B, C, D). Side 1 = 20×3 = **60** (B, C, D). Side 2 = 15×2 = **30** (B, C). Tổng 170 |
| P5 | Tiếp P4: showdown D > A > B > C | D nhận 80 + 60; B nhận 30 |
| P6 | Một người còn 5 điểm lúc ante | Bỏ 5 vào ante, all-in ngay; được xem tới showdown, chỉ thắng main pot phần ante |

## S — Showdown, hòa, bài cào

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| S1 | Board 5-6-7-8-9, B và C cùng chơi board, pot 320, mặc định bài cào | Màn bài cào: B rút 4, 5, K → 9 điểm; C rút Q, J, K → **ba tây** → C thắng 320 |
| S2 | Bài cào: B 7 điểm, C 7 điểm | Rút tiếp giữa B và C đến khi có người thắng |
| S3 | Ba người hòa | Cả ba cùng rút; người có bài cao nhất thắng; nếu người cao nhất bằng nhau thì chỉ những người đó rút tiếp |
| S4 | Bài cào: 10-J-Q | **Không** phải ba tây (10 không phải tây); điểm = 0 |
| S5 | Cài đặt "chia đều", pot 115, hai người hòa | Mỗi người 55, chip 5 lẻ trao ngẫu nhiên (theo seed) cho một người |
| S6 | Hòa ở side pot nhưng không hòa ở main pot | Bài cào chỉ chạy cho side pot, giữa những người hòa ở pot đó |
| S7 | 10 người, hết lá để rút bài cào | Xào lại các lá bài cào đã rút của ván rồi rút tiếp |

## C — Chip, kho, đổi chip, rebuy

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| C1 | Bắt đầu phiên với mỗi N từ 4 đến 10 | Cơ cấu phát chip và kho còn lại đúng bảng 7 dòng trong spec mục 3.5.1 |
| C1b | Cài đặt chọn N = 3 hoặc 11 | Không cho chọn (chỉ 4–10) |
| C2 | Hero chọn chip có tổng 35 khi cần call 30 | Nút xác nhận bị khóa đến khi tổng chip chọn khớp một khoản hợp lệ |
| C3 | Hero cần call 35, stack chỉ còn 3×50 + 1×100 | Bấm "Đổi chip" → đổi 1×50 lấy chip nhỏ (vd 4×10 + 2×5) từ người khác hoặc pot. Tổng giá trị không đổi; INV-1 đúng |
| C4 | N = 10, ba người lần lượt rebuy | Mỗi lần lấy 5×100 từ kho; sau 3 lần kho = 0 |
| C5 | Tiếp C4: người thứ tư cần rebuy | Người có stack lớn nhất cash out 500, **chip lớn trả trước**; chip về kho; người cần rebuy nhận 500 |
| C6 | Hai người cùng stack lớn nhất ở C5 | Chọn theo quy tắc cố định (🟡: người ngồi gần người mở lời ván trước nhất) |
| C7 | Sổ phiên | Hiển thị đúng buy-in, rebuy, cash out và lời/lỗ của từng người |

## T — Thay đổi số người

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| T1 | Một rival cash out giữa hai ván | Rời bàn; chip về kho; ván sau chỉ thu ante từ người còn ngồi |
| T2 | Hero rời giữa ván | Coi như fold; chip đã vào pot ở lại |
| T3 | Một người còn 0 chip trước ván mới | Phải rebuy hoặc rời bàn trước khi thu ante |
| T4 | Số người ngồi bàn giảm còn 3 trước ván mới | Ván chưa bắt đầu; app mời thêm rival từ ghế chờ cho đủ 4, phát 500 từ kho (🟡) |

## O — Tournament (đồng hồ)

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| O1 | Đồng hồ 20 giây, hero không bị ai bet, hết giờ | Tự **check** |
| O2 | Hero đang bị bet, hết giờ | Tự **fold**; chip đã bấm nhưng chưa xác nhận trả về stack |
| O3 | Lật turn có animation | Đồng hồ chỉ bắt đầu sau khi animation kết thúc |
| O4 | Cài đặt đổi thời gian 10 / 15 / 20 / 25 | Áp dụng từ ván kế tiếp |
| O5 | 3 giây cuối | Có tiếng tích tắc (trừ khi đã tắt âm) |
| O6 | Feedback | Chỉ xuất hiện sau ván |

## D — Drill & feedback

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| D1 | Cấp 1, spot J-J như H1 #7 | Hỏi lần lượt: outs → số lá chưa biết → % turn → % tới river → pot odds → hành động. Mỗi bước có feedback ngay; sai bước nào chỉ ra bước đó |
| D2 | Cấp 2 | Nhập tất cả rồi chọn hành động; một dòng tóm tắt ngay sau đó; phân tích đầy đủ sau ván |
| D3 | Cấp 3 | Không có feedback giữa ván; không có hint |
| D4 | Mọi drill được sinh | Trạng thái bàn hợp lệ: pot = tổng góp, không ai vượt cap, chip đúng mệnh giá (INV-1, INV-2) |
| D5 | Lời giải có equity | Ghi rõ giả định: range rival, số đối thủ, stack, pot, ai nói trước/sau, cap |
| D6 | Sau ván thua dù quyết định tốt | Nhãn "Quyết định: Tốt — thua do river" |
| D7 | Hero chọn cấp bất kỳ | Không cấp nào bị khóa; app chỉ hiển thị gợi ý khi đạt ≥ 80% trong 20 lần gần nhất |
| D8 | Drill "giá để đuổi draw": pot 300 trên turn, hero bet tối đa 50 | Feedback giải thích: equity cần của đối thủ = 50/400 = 12,5% < ~19,6% của flush draw → **không thể đuổi draw bằng cap**; khác với Hopkins L2 slide 18–20 |

## B — Bot

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| B1 | Hàm quyết định của bot | Đầu vào **không chứa** lá riêng của người khác hay lá chưa lật |
| B2 | Mô phỏng 1.000 ván, mỗi kiểu rival | Thống kê hành vi tách biệt rõ: vd tần suất raise của Điên > Sói > Cáo > Cá; tỉ lệ fold-to-raise của Thỏ cao nhất |
| B3 | Hiển thị | Kiểu chơi của mỗi rival luôn hiện trên ghế ngồi |
| B4 | Bàn 10 người | Đủ 9 rival, 9 nhân vật khác nhau, không trùng |
| B5 | Nóng thua pot 160 ở showdown | Ván sau Nóng chuyển sang tilt: avatar đổi biểu cảm; tilt kéo dài 3–5 ván (theo seed) rồi trở lại bình thường |
| B6 | Mô phỏng 1.000 ván Nóng | Tần suất raise khi tilt cao hơn rõ rệt so với khi bình thường |
| B7 | Nóng thua pot 100 ở showdown | Không tilt (dưới ngưỡng 150), trừ khi đó là bad beat ở turn |

## M — Chỉ số

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| M1 | Hero nhập 9 outs khi đáp án là 8 | Ghi sai cho chỉ số "đếm outs"; sai số được lưu |
| M2 | Hero nhập 25% khi equity cần là 21,4% | Sai số 3,6 điểm được ghi vào chỉ số pot odds |
| M3 | Spot chênh lệch < 5 điểm | Không tính vào chỉ số "quyết định đúng ở spot rõ" |
| M4 | Màn Tiến bộ | Có xu hướng theo thời gian, theo khái niệm, theo cấp và theo từng rival |
