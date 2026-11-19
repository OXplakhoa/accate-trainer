# Accate Trainer — Spec (BẢN NHÁP, chờ duyệt)

Ký hiệu: ✅ đã duyệt · 🟡 đề xuất/giả định · ❓ câu mở (xem `04-decisions-and-open-questions.md`).
Mã `D#` trỏ tới nhật ký quyết định.

---

## 1. Phạm vi

Bản giao là **bản trọn vẹn** (✅ D29), build theo các mốc nội bộ có acceptance test riêng (🟡 D29b):

| Mốc | Nội dung | Điều kiện qua mốc |
|---|---|---|
| M1 | **Engine luật Accate** (thuần logic, không UI): chia bài, ante, lượt, cap, pot/side pot, chip mệnh giá, đổi chip, kho chip, rebuy/cash out, showdown, bài cào | Toàn bộ AC nhóm R, C, P, S, X trong `03-acceptance-criteria.md` pass |
| M2 | **Rival bot** (9 nhân vật) + **bộ tính toán** (outs, xác suất, pot odds, equity theo range, EV) | AC nhóm B, M pass |
| M3 | **Drill** 4 cấp + feedback + chỉ số | AC nhóm D, F pass |
| M4 | **Bàn Sandbox** + Cài đặt | AC nhóm T pass |
| M5 | **Tournament** (đồng hồ) | AC nhóm O pass |
| Xuyên suốt | UI/UX, motion, sound (✅ D32) | Mục 11 |

Ngoài phạm vi: multiplayer, tài khoản, đồng bộ đám mây, tiền thật.

---

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa trong app |
|---|---|
| Ván (hand) | Từ lúc thu ante đến khi trả pot |
| Street | Một vòng cược: flop, turn, river (và preflop nếu bật tuỳ chọn "Cược trước flop", mục 3.2.1) |
| Ante | 5 chip mỗi người bỏ vào pot trước khi chia, gồm cả dealer |
| Góp-trong-street | Tổng chip một người đã bỏ vào pot **trong street hiện tại** (không tính ante) |
| Mức cược hiện hành | Góp-trong-street lớn nhất trong số người còn trong ván |
| Cap | 50 — giới hạn góp-trong-street của mỗi người |
| Hero | Người dùng |
| Rival | Đối thủ bot (9 nhân vật) |
| Kho chip (bank) | Toàn bộ chip chưa phát cho người chơi; tổng bộ chip cố định 6.500 |

---

## 3. Bảng luật Accate đã duyệt

### 3.1 Bàn & người chơi
| Luật | Giá trị | Trạng thái |
|---|---|---|
| Số người | **Bất kỳ số nguyên từ 4 đến 10** (gồm hero), cấu hình trong Cài đặt | ✅ D44 |
| Số người tối thiểu để tiếp tục | Nếu số người ngồi bàn < 4 trước ván mới, app mời thêm rival từ ghế chờ cho đủ 4 | 🟡 |
| Dealer | Một người chơi bình thường; vai trò chỉ để hiển thị, xoay theo chiều kim đồng hồ mỗi ván | 🟡 ❓O3 |
| Lá riêng | 2 lá mỗi người | ✅ D1 |
| Thứ tự chia | Theo chiều kim đồng hồ, bắt đầu từ người bên trái dealer (chỉ thẩm mỹ) | 🟡 D2 |
| Lá đốt (burn) | Không có | 🟡 ❓O5 |

### 3.2 Trình tự một ván — biến thể mặc định "Flop trước" (✅ D4)
1. **Ante**: mỗi người còn ngồi bàn bỏ 5 chip vào pot.
2. **Chia 2 lá riêng** cho mỗi người.
3. **Random người mở lời của ván** (✅ D11). Người này mở lời ở mọi street của ván; lượt đi theo chiều kim đồng hồ, bỏ qua người đã fold/all-in.
4. **Lật flop** (3 lá ngửa cùng lúc). Không có vòng cược nào trước flop.
5. **Vòng cược flop.**
6. **Lật turn** (1 lá) → **vòng cược turn**.
7. **Lật river** (1 lá) → **vòng cược river**.
8. **Showdown** → trả pot (mục 3.6).

Kết thúc sớm: nếu chỉ còn 1 người chưa fold → người đó nhận toàn bộ pot ngay, không lật bài tiếp, không phải show bài (🟡 ❓O6).
Nếu tất cả người còn lại đều all-in (hoặc chỉ còn ≤1 người có thể hành động) → lật hết các lá còn lại rồi showdown.

#### 3.2.1 Tuỳ chọn "Cược trước flop" (✅ D5)
Có trong bản giao, **tắt mặc định**, bật/tuỳ chỉnh trong Cài đặt. Khi bật, trình tự thành:
1. Ante → 2. Chia 2 lá → 3. Random người mở lời → **4. Vòng cược preflop** → 5. Lật flop → vòng cược flop → turn → river → showdown.

- Vòng preflop dùng **đúng luật hành động** của mục 3.3 (check được khi chưa ai bet, raise thêm ≥ 5, bội số 5, out-of-turn như 3.4).
- Người mở lời preflop = người mở lời của ván (🟡).
- Tuỳ chỉnh được trong Cài đặt (🟡 giá trị mặc định):
  | Tuỳ chọn | Mặc định | Giá trị |
  |---|---|---|
  | Cược trước flop | Tắt | Tắt / Bật |
  | Cap preflop | 50 | 5–50, bước 5 |
- Cap preflop tính riêng, không cộng vào cap flop (cap luôn theo từng street).
- Mọi người fold preflop trừ một → người đó nhận pot, **không lật flop**.
- Drill: khi bật tuỳ chọn, engine được phép dừng ở spot preflop; equity preflop tính bằng Monte Carlo như các street khác.

### 3.3 Hành động hợp lệ
| Hành động | Điều kiện |
|---|---|
| Check | Góp-trong-street của mình = mức cược hiện hành |
| Bet | Chưa ai bet trong street; số tiền là bội số của 5, ≥ 5, ≤ 50 |
| Call | Có mức cược hiện hành lớn hơn phần mình đã góp; bỏ thêm phần chênh |
| Raise | Mức cược hiện hành < 50; **raise lên** X với X là bội số của 5, X ≥ mức hiện hành + 5, X ≤ 50 |
| Fold | Luôn được (kể cả khi có thể check — app hỏi xác nhận 🟡) |
| All-in | Khi stack < số tiền cần để call, hoặc hero chủ động bỏ hết khi stack ≤ khoản tối đa còn được bỏ trong street |

- **Không có bet/raise tối thiểu** ngoài bội số 5 (✅ D12).
- **Cap 50 tính theo từng street, giới hạn góp-trong-street của mỗi người; ante không tính** (✅ D9). Khi mức cược hiện hành = 50 → chỉ còn call hoặc fold.
- **Không giới hạn số lần raise** trong một street (tự nhiên bị chặn bởi cap).
- Vòng cược kết thúc khi mọi người chưa fold và chưa all-in đã hành động ít nhất một lần **và** góp-trong-street bằng mức cược hiện hành (✅ D7). Khi đã có bet, không ai được check.
- Hiển thị: **"Raise lên X (+Y)"** — X là góp-trong-street sau khi raise, Y là phần bỏ thêm (🟡 D10).
- Cap vẫn áp dụng khi all-in: không ai bỏ quá 50 trong một street (✅ D13b).

### 3.4 Hành động trước lượt (✅ D39)
Ở bàn thật, người chơi hô/quăng chip trước lượt và **hành động đó có hiệu lực**. App tái hiện:
- Một rival có thể **hô trước lượt**: hiển thị bong bóng lời nói + đẩy chip ra trước mặt (chưa vào pot).
- Khi tới lượt rival đó:
  - Nếu **không ai thay đổi action** trước đó (mức cược hiện hành không đổi so với lúc hô) → hành động được thực hiện đúng như đã hô, **bắt buộc**.
  - Nếu action đã thay đổi (có người bet/raise sau khi hô) → **lời hô bị huỷ**, chip đã đẩy ra **trả về stack**, người đó **quyết định lại tự do**: fold, call hoặc raise (✅ D39b — giống casino, Hopkins L8 slide 8).
- **Hero cũng được hô trước lượt** (✅ D39c): khi chưa tới lượt, hero bấm chip rồi "Hô trước". Chip đẩy ra trước mặt, chưa vào pot. Áp dụng đúng hai quy tắc trên. Ví dụ: hero hô bet 20, sau đó rival raise lên 30–50 → lời hô huỷ, 20 trả về, hero chọn lại (kể cả fold mà không mất 20).
- Hero có thể rút lời hô của mình trước khi action thay đổi không: không (lời hô có hiệu lực) (🟡).
- Tần suất hô sớm là một tham số tính cách (Điên, Sói hay hô sớm nhất; Đá, Thỏ gần như không).
- Lời hô sớm là **thông tin công khai**, được dùng trong feedback như một "tell".

### 3.5 Chip, kho chip, đổi chip, rebuy, cash out
| Luật | Giá trị | Trạng thái |
|---|---|---|
| Mệnh giá | 5, 10, 50, 100 — **chỉ 4 loại** | ✅ D14 |
| Bộ chip | 100 × chip 5, 100 × chip 10, 50 × chip 50, 25 × chip 100 = **6.500 điểm** | ✅ D16 |
| Bất biến | Chip trên bàn (stack + pot) + kho = đúng bộ chip trên, theo **từng mệnh giá** | ✅ D16 |
| Buy-in | 500 điểm mỗi người (ngoài đời 500 điểm ≈ 50.000đ; app chỉ dùng điểm) | ✅ D15 |
| Phát chip ban đầu | Mỗi người nhận **cùng một cơ cấu**; ưu tiên tối đa số chip nhỏ (5, rồi 10), sau đó 50, cuối cùng 100 | ✅ D17; thuật toán 🟡 3.5.1 |
| Đặt chip | Hero **tự bấm từng chip** để tạo khoản cược | ✅ D19 |
| Đổi chip | Nút "Đổi chip" dùng **bất cứ lúc nào**; đổi chip lớn lấy chip nhỏ cùng tổng giá trị với người chơi khác **hoặc với pot** | ✅ D20, D21 |
| Hết chip | Rebuy 500, không giới hạn số lần | ✅ D24 |
| Kho thiếu chip để rebuy | Người có stack lớn nhất **cash out 500**, ưu tiên trả chip lớn về kho; sau đó người cần rebuy nhận 500 từ kho | ✅ D24b; chi tiết 🟡 D24c |
| Cash out tự nguyện | Được, giữa hai ván; chip về kho | ✅ D24 |
| Rời bàn | Chỉ giữa hai ván (cash out toàn bộ). Rời giữa ván = fold, chip đã vào pot ở lại | 🟡 |
| Sổ phiên | App ghi buy-in, rebuy, cash out của từng người để tính lời/lỗ của phiên | 🟡 |

#### 3.5.1 Thuật toán phát chip ban đầu (🟡)
Cho N người, mỗi người nhận cơ cấu (a×5, b×10, c×50, d×100) giống nhau, tổng = 500:
1. Chọn (a, b) với `N·a ≤ 100`, `N·b ≤ 100`, `5a + 10b` là bội số của 50, **tối đa a + b**, hoà thì ưu tiên a lớn.
2. Phần còn lại R = 500 − 5a − 10b: chọn (c, d) với `N·c ≤ 50`, `N·d ≤ 25`, `50c + 100d = R`, ưu tiên c lớn.
3. Nếu không có nghiệm, giảm (a, b) theo thứ tự ưu tiên rồi lặp lại.

Kết quả kỳ vọng (dùng làm AC):
| N | chip 5 | chip 10 | chip 50 | chip 100 | Kho còn lại (5/10/50/100) |
|---|---|---|---|---|---|
| 4 | 24 | 23 | 3 | 0 | 4 / 8 / 38 / 25 |
| 5 | 20 | 20 | 4 | 0 | 0 / 0 / 30 / 25 |
| 6 | 16 | 12 | 6 | 0 | 4 / 28 / 14 / 25 |
| 7 | 14 | 13 | 6 | 0 | 2 / 9 / 8 / 25 |
| 8 | 12 | 9 | 5 | 1 | 4 / 28 / 10 / 17 |
| 9 | 10 | 10 | 5 | 1 | 10 / 10 / 5 / 16 |
| 10 | 10 | 10 | 5 | 1 | 0 / 0 / 0 / 15 |

Mọi dòng đã kiểm: mỗi người đúng 500; chip trên bàn + kho = 6.500 theo từng mệnh giá.

Rebuy lấy 500 từ kho, cũng ưu tiên chip nhỏ có sẵn trong kho.

### 3.6 Showdown và trả pot
- So bài **Hold'em chuẩn**: 5 lá mạnh nhất trong 7 lá (2 riêng + 5 chung), được dùng cả 5 lá chung (✅ D22). Thứ hạng và kicker theo luật chuẩn.
- **Side pot** theo luật chuẩn (✅ D13, D18): mỗi người all-in chỉ thắng tối đa phần pot mà họ góp đủ; mỗi pot được so riêng giữa những người đủ điều kiện.
- **Hòa** (mặc định, ✅ D23): những người hòa ở một pot chơi **bài cào** để chọn một người thắng pot đó. Tuỳ chọn Cài đặt: **chia đều**, chip lẻ 5 trao **ngẫu nhiên** cho một người hòa.

### 3.7 Bài cào (tie-break) (✅ D23b)
- Rút từ **các lá chưa chia** của bộ bài ván đó. Mỗi người hòa rút 3 lá.
- Điểm: A = 1; 2–9 theo số; 10, J, Q, K = 0 (tính 10). Điểm = hàng đơn vị của tổng. Cao nhất 9.
- **Ba tây** (cả 3 lá đều là J/Q/K) thắng mọi bài không phải ba tây.
- Bằng nhau (cùng điểm, hoặc cùng ba tây) → những người bằng nhau **rút tiếp** đến khi có người thắng. Không bao giờ hòa.
- Hòa từ 3 người trở lên: cả nhóm cùng rút (🟡 D23c).
- Không đủ lá: xào lại các lá bài cào đã rút của ván đó rồi rút tiếp (🟡 D23c).
- Nhiều pot cùng hòa: mỗi pot chạy bài cào riêng giữa những người hòa ở pot đó (🟡).

---

## 4. Rival (bot)

### 4.1 Chín nhân vật rival (8 kiểu cố định + Nóng ở 4.1.1) (✅ D28, D33)
Mỗi nhân vật **cố định** một kiểu chơi, có tên, avatar, màu riêng, giữ nguyên qua các phiên. Kiểu chơi **luôn hiện rõ** cho hero (✅ D30). "Shuffle" = ngẫu nhiên ai ngồi bàn và ngồi ghế nào (✅ D33).

| # | Tên | Kiểu | Hành vi chính | Tham số gợi ý 🟡 |
|---|---|---|---|---|
| 1 | Đá | Tight-passive (nit) | Ít chơi tiếp sau flop; bet = bài thật | tiếp tục thấp, aggression thấp, bluff ~0 |
| 2 | Cá | Loose-passive (calling station) | Call gần như mọi thứ, hiếm raise | tiếp tục rất cao, aggression thấp |
| 3 | Cáo | Tight-aggressive (TAG) | Chọn lọc, khi chơi thì chơi mạnh | tiếp tục vừa-thấp, aggression cao, bluff vừa |
| 4 | Sói | Loose-aggressive (LAG) | Chơi nhiều, bet nhiều kể cả board xấu | tiếp tục cao, aggression cao, bluff cao |
| 5 | Điên | Maniac | Raise lên cap gần như mọi street; hay hô sớm | aggression rất cao, sizing = cap |
| 6 | Đại gia | Whale | Stack lớn, call lớn bằng draw yếu | tiếp tục cao, ít fold draw |
| 7 | Thỏ | Weak-tight | Fold khi bị raise kể cả bài khá | fold-to-raise cao |
| 8 | Bẫy | Slowplay / check-raise | Check bài mạnh rồi check-raise | check-raise cao khi mạnh |

Avatar và hình tượng được thiết kế theo kiểu chơi (✅ D31). Trong Cài đặt, hero chọn những kiểu nào được ngồi bàn.

#### 4.1.1 Nhân vật thứ 9: Nóng — Tilter (✅ D45; tên và tham số 🟡)
Có 9 nhân vật để bàn 10 người đủ 9 rival, không trùng ai (✅ D45). Nóng khác 8 người kia ở chỗ **kiểu chơi đổi theo trạng thái**. Bài học đi kèm là **tilt** (Hopkins L8 slide 6).

| Trạng thái | Khi nào | Hành vi | Tham số gợi ý 🟡 |
|---|---|---|---|
| Bình thường | Mặc định | Chơi chắc tay, gần Cáo nhưng ít bluff hơn | tiếp tục vừa, aggression vừa, bluff thấp |
| **Tilt** | Vừa thua một pot ≥ 150 ở showdown, **hoặc** thua khi đang dẫn ở turn (bad beat) | Chơi rộng, bet/raise lên cap, hô sớm nhiều, call bằng draw yếu | kéo dài 3–5 ván (random), rồi trở lại bình thường |

- Trạng thái tilt là **thông tin công khai**, như ngoài đời: avatar đổi biểu cảm (đỏ mặt, cau có) và có hiệu ứng nhẹ trên ghế.
- Feedback dùng trạng thái này: "Nóng đang tilt, range rộng hơn hẳn → equity của bạn trước Nóng cao hơn lúc bình thường."
- Bàn có ≤ 8 rival: Nóng nằm chung danh sách 9 nhân vật để shuffle, không bắt buộc ngồi.

### 4.2 Thông tin bot được biết (🟡 ❓O7)
Bot **chỉ biết**: 2 lá của chính nó, các lá chung đã lật, lịch sử hành động công khai (kể cả lời hô sớm), stack và pot. Bot **không** nhìn lá của người khác hoặc lá sắp ra.

### 4.3 Mức chân thực
Đủ để: (a) mỗi kiểu có hành vi nhận ra được sau vài ván, (b) có **range** mô tả được bằng lời để làm feedback ("Điên bet 50 ở đây với range rộng gồm draw và bluff"). Không cần bot chơi tối ưu (GTO).

---

## 5. Bộ tính toán (dùng cho feedback & chấm điểm)
| Đại lượng | Định nghĩa | Cách tính |
|---|---|---|
| Lá cải thiện | Lá làm bài hero mạnh lên (vd lên set) | Đếm tổ hợp |
| Outs | Lá giúp hero **thắng** theo giả định về bài đối thủ (đã trừ outs bẩn) | Đếm theo range giả định, ghi rõ giả định |
| % trúng 1 lá | outs / số lá chưa biết (47 ở flop, 46 ở turn) | Chính xác |
| % trúng tới river (từ flop) | 1 − C(47−outs,2)/C(47,2) | Chính xác; so với Rule of 4 (và bản chỉnh khi outs > 8) |
| Pot odds (equity cần) | call / (pot sau khi đối thủ bet + call) | Chính xác; hiển thị % chính, kèm "x-to-1" (✅ D38 ghi chú) |
| Equity | Xác suất thắng (chia hòa theo phần) trước **range** rival theo kiểu chơi và hành động | Mô phỏng Monte Carlo trên range; luôn ghi giả định: range, số đối thủ, stack, pot, cap |
| EV quyết định | So EV của các hành động hợp lệ | Từ equity + pot + khoản phải bỏ (call/fold chính xác; bet/raise ước lượng có ghi giả định) |
| Spot "rõ ràng" | Chênh lệch giữa equity và equity cần > 5 điểm % | Dùng cho chỉ số đúng/sai và Tournament review |

Chất lượng quyết định **chỉ** chấm trên thông tin tại thời điểm quyết định, không theo kết quả ván.

---

## 6. Mode Drill (4 cấp, chọn tự do — ✅ D37)

Drill được **sinh bằng engine**: các rival chơi một ván thật theo luật Accate; khi tới lượt hero ở một spot phù hợp với khái niệm đang luyện, app dừng và biến lúc đó thành bài tập (🟡). Mọi drill vì vậy hợp lệ về pot, cap, stack và chip.

| Cấp | Tên | Hero làm gì | Feedback | Hint |
|---|---|---|---|---|
| 0 | Học lại | Bài học 2–3 phút cho một khái niệm, ví dụ trên bàn Accate | Trong bài | — |
| 1 | Tính từng bước | Trả lời lần lượt: outs → % trúng → pot odds → hành động | **Ngay sau mỗi bước**, chỉ rõ sai bước nào | Miễn phí |
| 2 | Tự giải | Nhập outs, %, pot odds và chọn hành động trong một lượt | Một dòng ngay sau hành động; phân tích đầy đủ sau ván | Có, được ghi nhận vào chỉ số |
| 3 | Áp lực thật | Quyết định trong thời gian giới hạn | **Chỉ sau ván** | Không |

Thứ tự khái niệm gợi ý: outs → % trúng → pot odds → so sánh → equity theo range rival → board texture → bet sizing (gồm "giá để đuổi draw" dưới cap 50). App **gợi ý** lên cấp khi đúng ≥ 80% trong 20 lần gần nhất (🟡), không khóa.

### 6.1 Nội dung feedback
- Tách rõ: **lá cải thiện** / **outs** / **% trúng 1 lá & 2 lá** / **equity trước range** / **pot odds**.
- Board texture: dry / wet / nhiều draw và những nhóm bài một cú bet/raise có thể đại diện, theo kiểu rival.
- Bet sizing: tách **kích thước hợp lệ theo luật** (bội 5, ≤ 50 trong street, phần còn lại có thể bỏ) khỏi **lựa chọn chiến thuật**.
- Mọi lời giải ghi rõ giả định: range, số đối thủ, stack, pot, vị trí (ai nói trước/sau), cap.
- Sau ván có nhãn tách quyết định khỏi kết quả, vd "Quyết định flop: Tốt — thua vì river".
- Phần bài học trích nguồn bài giảng (mục 10).

---

## 7. Mode Bàn Sandbox
Chơi trọn ván liên tục theo luật mục 3. Cuối mỗi ván có màn xem lại (timeline action, pot odds tại mỗi quyết định của hero, EV, nhãn chất lượng). Hero có thể bật **"dừng ở spot quan trọng"** để biến spot thành drill cấp 1 ngay trên bàn (🟡).

## 8. Mode Tournament (✅ D34–D36)
- Là Bàn Sandbox + **đồng hồ mỗi lượt của hero**: 10 / 15 / 20 / 25 giây (✅ D35), mặc định 20 giây (🟡 D35b).
- **Không loại người**, vẫn rebuy/cash out như Sandbox.
- **Hết giờ**: check nếu được, nếu không thì fold (✅ D36). Chip hero đã bấm nhưng chưa xác nhận bị trả lại stack.
- Đồng hồ chỉ bắt đầu **sau khi animation chia/lật bài kết thúc** (🟡). Thời gian bấm chip nằm trong đồng hồ (❓O11).
- Tiếng tích tắc trong 3 giây cuối (🟡).
- Feedback chỉ sau ván.

## 9. Cài đặt / Sandbox (✅ D25)
Số người · danh sách kiểu rival được ngồi bàn · buy-in & cơ cấu phát chip · cược trước flop (tắt/bật, cap preflop — mục 3.2.1) · cách xử lý hòa (bài cào / chia đều) · thời gian đồng hồ · bật/tắt hô sớm của rival · âm lượng từng kênh (nhạc, chip, bài, đồng hồ) · giảm motion · ngôn ngữ thuật ngữ.

## 10. Chỉ số theo dõi (✅ D38)
| # | Chỉ số | Mục tiêu 🟡 | Nguồn |
|---|---|---|---|
| 1 | Đếm outs đúng | ≥ 90% | Hopkins L2 slide 24–27 |
| 2 | Sai số outs → % | ≤ 3 điểm % | L7 slide 6 |
| 3 | Sai số pot odds | ≤ 3 điểm % | L2 slide 12–13; L7 slide 7–9 |
| 4 | Quyết định đúng ở spot rõ | ≥ 90% | L2 slide 10–11 |
| 5 | EV mất / quyết định (chip) | giảm dần | L2 slide 8 |
| 6 | Tốc độ trung vị câu đúng | < đồng hồ đã chọn | L7 slide 5 |
| 7 | Đọc board texture | ≥ 85% | L5 slide 23–24; L8 slide 18 |
| 8 | Đọc theo kiểu rival | theo dõi riêng từng rival | L5 slide 25, 41, 65 |

Màn hình Tiến bộ hiển thị theo khái niệm, theo cấp và theo rival (vd "bạn hay call sai trước Điên").

## 11. UI/UX, motion, sound (✅ D32, D40)
- **Phong cách hình ảnh**: pha trộn — cảm giác bàn thật (nỉ, chip, bài vật lý) + không khí ấm của buổi tối bạn bè + độ rõ ràng hiện đại cho con số và dữ liệu. Có chất "nghệ", lá bài được thiết kế trau chuốt (✅ D40).
- **Chip**: 4 mệnh giá phân biệt rõ bằng màu, hoa văn mép và tiếng; stack chip hiển thị vật lý theo mệnh giá (✅ D14).
- **Motion mang thông tin**: chip bay vào pot theo người góp; lật flop/turn/river có nhịp; bong bóng hô sớm; đẩy pot về người thắng; bài cào có màn rút riêng.
- **Sound mang thông tin**: tiếng va chip khác nhau theo mệnh giá; tiếng chia/lật bài; tích tắc 3 giây cuối; âm thanh đúng/sai trong drill.
- **Trợ năng**: giảm motion, tắt âm từng kênh; con số có thể đọc được không phụ thuộc màu.
- Responsive: điện thoại dọc và máy tính.
