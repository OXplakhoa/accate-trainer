# Packet P1c — Engine một ván Accate

**Implementer** Gemini 4 Neon, effort high.

**Review độc lập** GPT 6.1 Terra và Gemini 4 Argon, effort high. Control tự kiểm trước khi merge.

Đọc `AGENTS.md`, `docs/02-spec.md` §3.1–3.7, `docs/03-acceptance-criteria.md` nhóm R, X, P, S, và `docs/04-decisions-and-open-questions.md` các mục D3–D13b, D18, D20–D24c, D39–D39c, D44 và O9. Đối chiếu các mục P1c trong `QUESTIONS.md` khi tài liệu chưa quy định cùng một hành vi.

## Phạm vi

- Engine thuần TypeScript cho một ván, từ thu ante tới trả pot. Bao gồm chia bài, lượt cược, hô trước lượt, đổi chip với pot, side pot và showdown. Các mode đọc cùng trạng thái và timeline. X7 kiểm tín hiệu cần quyết định từ engine; đồng hồ và animation thuộc packet khác.
- Tạo mô-đun trong `src/engine/` cho vòng đời ván, vòng cược, pot và showdown, cùng test tương ứng trong `tests/engine/`. Dùng lại `cards`, `handEval`, `baiCao`, `bank`, `chips`, `exchange` và `Rng`. Nếu cần chia sẻ trạng thái nguồn rút của bài cào qua nhiều pot, có thể bổ sung API và test trong `baiCao.ts` và `baiCao.test.ts`, giữ hợp đồng hiện tại.
- Giữ spec, acceptance criteria, API P1a/P1b và cấu hình dự án. Dùng tên tiếng Anh trong code. Control xử lý re-export từ `src/engine/index.ts`, merge và push. Ván xuyên suốt H1 thuộc P1d.

## 1. Trạng thái và vòng đời · R1–R16, P6

- Đầu vào theo thứ tự ghế chiều kim đồng hồ. Trạng thái đủ để gọi các phép khởi tạo ván, đọc lượt và action hợp lệ, áp dụng action, hô trước lượt, đổi chip và trả pot. Trả kết quả và timeline có thể dùng lại trong test và UI. Xác thực trước khi chuyển trạng thái để action bị từ chối có thể thử lại trên cùng trạng thái.
- Thu ante 5 của từng ghế, gồm dealer. Ai hết stack sau ante là all-in. Giữ stack, pot và chip đang dành cho lời hô dưới dạng `ChipCounts`. Theo dõi tổng đã góp trong ván (gồm ante) và đã góp trong street hiện tại. Chọn opener một lần theo ván. Mọi street bắt đầu từ mốc đó theo chiều kim đồng hồ, bỏ qua ghế đã fold hoặc all-in.
- Chia hai lá mỗi người theo §3.1. Mặc định lật flop ngay sau khi chia. Khi bật cược trước flop, chạy street preflop trước khi lật flop, cap cấu hình 5–50 theo bước 5. Cap các street sau là 50, tính lại từ đầu mỗi street và bỏ ante khỏi cap.
- Kiểm đúng lượt, bội số 5, cap, mức call và mức raise. Chip chọn phải có trong stack và đúng khoản phải bỏ. Raise dùng giá trị góp **sau** raise, kèm phần chip bỏ thêm. Với stack nhỏ hơn khoản call, cho call all-in trong cap. Action hợp lệ làm stack về 0 vẫn chuyển người chơi sang all-in. Xem `QUESTIONS.md` cho nhánh all-in chủ động.
- Đóng street khi những người còn được hành động đã hành động và đã góp bằng mức hiện hành. Sau một lần raise hợp lệ, người có mức góp thấp hơn mức mới phải quyết định lại nếu còn quyền hành động. Khi chỉ còn một người chưa fold, trả pot ngay theo R8/R15. Nếu còn nhiều người nhưng không còn ai cần quyết định, lật phần board còn lại rồi showdown. Theo R9, người duy nhất còn quyền hành động vẫn phải giải quyết khoản call đang đối mặt trước khi runout.
- Dùng `Rng.fork(label)` với luồng riêng cho deck, opener, bài cào và chip lẻ. Test dùng seed cố định và fixture deck hoặc opener xác định qua cùng đường chuyển trạng thái của engine.
- Tích hợp ở ranh giới ván theo T3/T4, C5/C6 và O9. Hoàn tất trả pot trước khi rebuy hoặc rời bàn, xử lý ghế 0 chip trước ante ván sau. Dùng `planBuyIn` cho kế hoạch với kho. Nếu opener ván trước đã rời bàn, giữ vị trí ghế cũ làm mốc vật lý và ánh xạ sang ghế đang có người đầu tiên theo chiều kim đồng hồ trước khi gọi `planBuyIn`. Luồng quản lý phiên và mời rival thuộc phần Sandbox.

## 2. Hô trước lượt và đổi chip · X1–X7, C2/C3

- Ghi lời hô công khai kèm street, action, mức cược tại thời điểm hô và chip được giữ riêng. Chip giữ riêng vẫn thuộc người hô và chưa tính vào pot hoặc khoản đã góp.
- Đến lượt nếu mức cược chưa đổi, tự áp dụng lời hô. Nếu bet/raise đã đổi mức cược, hủy lời hô, trả đúng chip đã giữ về stack rồi trả quyền quyết định. Giữ cả lời hô, việc hủy và action đã thực hiện trong timeline. Xả chip của lời hô còn lại khi street hoặc ván kết thúc.
- Áp dụng cho hero và rival, kể cả khi một rival raise trước lượt hero ở X5. Giữ lời hô có hiệu lực theo X6. Với X7, phát tín hiệu cần quyết định sau khi lời hô bị hủy. Khi lời hô hợp lệ tự thực hiện, engine không yêu cầu quyết định thủ công.
- Đổi chip theo D20/D21 với người khác hoặc pot qua `exchangeChips`. Giá trị hai bên và tổng đóng góp giữ nguyên, cơ cấu chip vật lý có thể đổi. Phép đổi không thay đổi lượt hay mức cược. Kiểm đủ mệnh giá trước khi áp dụng và bảo toàn chip đã dành cho lời hô.

## 3. Pot và showdown · P1–P6, S1–S7

- Tính pot theo các mức góp cả ván. Chip của người đã fold vẫn được tính vào pot; họ không nằm trong danh sách đủ điều kiện thắng. Dùng test P1–P5 để khóa cả số điểm và danh sách đủ điều kiện của từng pot. Theo luật chuẩn §3.6, phần cược vượt chưa có ai theo được trả lại đúng người đã bỏ phần đó. Đường thắng do mọi người fold vẫn trả toàn bộ pot theo R8/R15.
- Đánh giá 5 lá mạnh nhất qua `evaluateHand` và `compareHands`. Xác định người thắng riêng cho từng pot. Mặc định gọi resolver bài cào cho nhóm đứng đầu cùng hạng trong pot đó, dùng nguồn lá chưa chia của ván và giữ kết quả từng vòng. Khi nhiều pot cần bài cào, mỗi pot có kết quả riêng và dùng chung trạng thái vật lý của nguồn rút trong ván. Lá được tái sử dụng theo quy tắc xào lại của S7.
- Chế độ chia đều chia theo đơn vị 5. Trao phần chip lẻ theo RNG của pot giữa những người hòa, giữ số điểm các phần chia chênh nhiều nhất 5. S5 phải ra 55/60 và chọn người nhận 5 một cách xác định theo seed. Tính cả kế hoạch chi trả theo từng mệnh giá trước khi áp dụng. Khi cần đổi mệnh giá, dùng trao đổi cùng giá trị theo §3.5. Ca thiếu cơ cấu chip cho bước bắt buộc được ghi trong `QUESTIONS.md`.
- Giữ INV-1 theo từng mệnh giá trong lúc thu, đổi, hoàn chip và trả pot. Nếu giữ lời hô ngoài stack khả dụng, kiểm cùng nhóm chip đó đúng một lần. INV-2 so giá trị pot với tổng đóng góp **chưa thanh toán** gồm ante. Sau khi hoàn hoặc trả pot, giảm phần còn phải thanh toán tương ứng. Timeline giữ lịch sử các khoản đã góp để phát lại.

## Kiểm thử và bàn giao

- Mỗi AC R1–R16, X1–X7, P1–P6 và S1–S7 có test hoặc dẫn tới test P1a đã bao phủ phần thuần chấm bài. Với S1/S6/S7 vẫn kiểm đường tích hợp showdown gọi bài cào trong P1c. Thêm ca đổi với pot và ca trả phần cược chưa được theo. Kiểm `checkInv1` và INV-2 sau mỗi bước, cả khi action hoặc phép đổi bị từ chối.
- Chạy `npm.cmd run check` và probe ESLint trong handoff. Nếu Vitest bị giới hạn ghi file tạm, dùng `npm.cmd run check -- -- --pool threads --configLoader runner --no-cache` và ghi rõ.
- Khi được giao, dùng worktree riêng từ `main`, nhánh `p1c-hand`, và commit các file của packet. Nộp commit, bảng AC → tên test, kết quả kiểm tra và các điểm còn mở. Giữ mọi phần mơ hồ trong `QUESTIONS.md` để control đối chiếu với source of truth.
