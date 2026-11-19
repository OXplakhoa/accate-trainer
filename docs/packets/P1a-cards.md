# Packet P1a — Bài, bộ bài, đánh giá tay Hold'em, bài cào

**Implementer:** GPT 6.2 Astra (codex) · **Reviewer:** GPT 6.2 Sol + Gemini 4 Neon · **Control:** Claude
**Song song với:** P1b (chip). Hai packet không được sửa chung file nào.

---

## Phần dán cho implementer

Bạn là implementer packet P1a của **Accate Trainer**. Đọc `AGENTS.md` trước, rồi `docs/02-spec.md` §3.1, §3.6, §3.7 và `docs/03-acceptance-criteria.md` nhóm **S** (S1–S4, S7). Không đổi luật/spec.

### Phạm vi file (chỉ được tạo/sửa các file này)
```
src/engine/cards.ts        tests/engine/cards.test.ts
src/engine/handEval.ts     tests/engine/handEval.test.ts
src/engine/baiCao.ts       tests/engine/baiCao.test.ts
```
**Không** sửa `src/engine/index.ts`, `rng.ts`, `chips.ts`, `AGENTS.md`, `QUESTIONS.md`, `docs/`, cấu hình. Control tự thêm re-export khi merge. Test import thẳng từ file module.

### 1. Lá bài và bộ bài — `cards.ts`
```ts
export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // J=11 Q=12 K=13 A=14
export interface Card { readonly rank: Rank; readonly suit: Suit; }
export function parseCard(s: string): Card;      // "As", "Td", "9c"; sai định dạng → throw
export function formatCard(c: Card): string;     // ngược của parseCard
export function parseCards(s: string): Card[];   // "As Kd 5c" (cách bởi khoảng trắng)
export function createDeck(): Card[];            // 52 lá, thứ tự cố định
export function shuffledDeck(rng: Rng): Card[];  // rng.shuffle(createDeck())
```
Lá bài là giá trị bất biến; so sánh lá bằng rank+suit.

### 2. Đánh giá tay — `handEval.ts`
```ts
export type HandCategory =
  | 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight'
  | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush';
export interface HandValue {
  readonly category: HandCategory;
  readonly ranks: readonly number[];   // vector so sánh theo luật chuẩn (category trước, rồi kicker)
  readonly best5: readonly Card[];     // 5 lá tạo nên tay (để UI tô sáng)
}
export function evaluateHand(cards: readonly Card[]): HandValue;   // 5, 6 hoặc 7 lá; khác → throw; lá trùng → throw
export function compareHands(a: HandValue, b: HandValue): -1 | 0 | 1;
```
- Luật Hold'em chuẩn (spec §3.6): 5 lá mạnh nhất trong 7, được dùng cả 5 lá chung. Không có suit nào mạnh hơn suit nào.
- A dùng cao hoặc thấp cho straight: `A-2-3-4-5` (wheel) là straight thấp nhất, `5-4-3-2-A` flush thì là straight flush thấp nhất. Không có straight vòng (`Q-K-A-2-3`).
- Hai tay cùng `category` và cùng `ranks` → `compareHands` trả 0 (hòa, sau đó P1c sẽ gọi bài cào).
- Hiệu năng: P2a sẽ chạy Monte Carlo, nên tránh cấp phát lớn trong mỗi lần gọi. Ghi lại benchmark số lần `evaluateHand` 7 lá/giây trên máy bạn (chỉ báo cáo, không đưa vào test).

### 3. Bài cào — `baiCao.ts` (spec §3.7)
```ts
export function baiCaoPoints(cards: readonly Card[]): number;   // đúng 3 lá; A=1, 2–9 theo số, 10/J/Q/K=0; hàng đơn vị của tổng
export function isBaTay(cards: readonly Card[]): boolean;       // cả 3 lá là J/Q/K (10 KHÔNG phải tây)
export function compareBaiCao(a: readonly Card[], b: readonly Card[]): -1 | 0 | 1; // ba tây > mọi bài không ba tây; ba tây vs ba tây = 0; còn lại so điểm

export interface BaiCaoDraw { readonly playerId: string; readonly cards: readonly Card[]; readonly points: number; readonly baTay: boolean; }
export interface BaiCaoResult { readonly winnerId: string; readonly rounds: readonly (readonly BaiCaoDraw[])[]; }
export function resolveBaiCao(
  contenders: readonly string[],      // ≥ 2 người hòa, theo thứ tự ghế chiều kim đồng hồ
  undealt: readonly Card[],           // các lá chưa chia của ván, theo thứ tự trên cùng trước
  rng: Rng,                           // dùng cho việc xào lại (caller truyền rng.fork('baicao'))
): BaiCaoResult;
```
Quy tắc rút (🟡 control chốt để cài, ghi chú trong comment):
- Mỗi vòng, từng người còn tranh (theo thứ tự `contenders`) rút **3 lá liên tiếp** từ trên cùng nguồn rút.
- Người thắng vòng là người có bài cao nhất theo `compareBaiCao`. Nếu nhiều người cùng cao nhất, **chỉ những người đó** rút vòng tiếp. Lặp đến khi còn đúng 1 người (S2, S3). Không bao giờ trả hòa.
- Hết lá (S7): khi nguồn rút cạn giữa chừng, lấy **mọi lá bài cào đã rút trước đó trong ván này** (kể cả của người đã rút trong vòng hiện tại — điểm của họ đã ghi), xào bằng `rng`, làm nguồn rút mới, rồi rút tiếp lá còn thiếu. Nếu cả nguồn rút và lá đã rút đều rỗng → throw.
- `rounds` ghi lại đủ để UI diễn lại từng vòng.

### 4. Test bắt buộc
`cards.test.ts`: parse/format khứ hồi cho đủ 52 lá; input sai throw; `createDeck` đủ 52 lá không trùng; `shuffledDeck` cùng seed → cùng thứ tự, khác seed → khác.

`handEval.test.ts`:
- Mỗi category ít nhất 2 ví dụ, gồm wheel, steel wheel, broadway, royal flush.
- Kicker: cùng pair khác kicker; two pair khác kicker; trips khác kicker; flush so lá thứ 5.
- Tay 7 lá chọn đúng tay mạnh nhất: có cả straight và flush; hai bộ ba (→ full house); ba đôi (→ two pair với kicker đúng); bộ tứ + kicker cao nhất từ board.
- **Board plays**: board `5c 6d 7h 8s 9c`, hai người cầm bài không cải thiện → hòa (tiền đề S1).
- **Đếm toàn bộ C(52,5) = 2.598.960 tay 5 lá**, đúng tần suất chuẩn: straight flush 40 · four of a kind 624 · full house 3.744 · flush 5.108 · straight 10.200 · three of a kind 54.912 · two pair 123.552 · pair 1.098.240 · high card 1.302.540. (Nếu chạy quá 20 giây thì báo lại trong report, đừng bỏ test.)
- Input không hợp lệ (4 lá, 8 lá, lá trùng) throw.

`baiCao.test.ts`:
- S4: `Td Jc Qh` → 0 điểm, không phải ba tây. `Jc Qd Kh` → ba tây. `4c 5d Kh` → 9 điểm. `Ac 9d Ks` → 0 điểm.
- S1: dựng `undealt` cố định sao cho B rút `4 5 K` (9 điểm), C rút `Q J K` (ba tây) → C thắng.
- S2: B và C cùng 7 điểm ở vòng 1 → vòng 2 chỉ B và C rút, có người thắng.
- S3: ba người, vòng 1 hai người cùng cao nhất → vòng 2 chỉ hai người đó rút.
- S7: 10 người hòa, `undealt` 27 lá (52 − 20 − 5) → phải xào lại, kết quả xác định theo seed, không throw, có đúng 1 người thắng.
- Cùng seed, cùng input → cùng `BaiCaoResult`.

### Không được
- Cài vòng cược, pot, side pot, chia pot hòa (S5, S6), chip — thuộc P1b/P1c.
- Thêm dependency. Đổi API của P0.

### Xong khi
- `npm run check` pass. Không `TODO` ẩn.
- Mỗi AC S1, S2, S3, S4, S7 có ít nhất một test mang tên chứa ID đó (vd `it('S4: 10-J-Q is not ba tay', …)`).

### Git
- Làm trong worktree được giao, nhánh `p1a-cards` (đã tạo từ `main`). Commit theo từng bước hợp lý. **Không push, không merge** — control push sau khi kiểm.

### Nộp lại (ghi vào file report control chỉ định)
1. Danh sách commit. 2. Bảng: mục 1–4 và AC S1/S2/S3/S4/S7 → file/test. 3. Output `npm run check`. 4. Benchmark evaluator. 5. Giả định và câu hỏi (đừng sửa `QUESTIONS.md`; ghi vào report).

---

## Yêu cầu review P1a (dán cho Sol và Neon, riêng từng người)

Review packet P1a ở nhánh `p1a-cards`. Review độc lập, đừng đọc review khác. **Không sửa, tạo, xoá file trong repo.** Đối chiếu phần "dán cho implementer" ở trên, `docs/02-spec.md` §3.6–3.7, `docs/03` nhóm S. Kiểm riêng: (1) evaluator đúng luật chuẩn ở mọi biên (wheel, kicker, chọn 5/7, board plays) — tự thử thêm ca; (2) bài cào: điểm, ba tây, vòng rút, xào lại khi hết lá, không bao giờ hòa; (3) test có thật sự kiểm điều nó tuyên bố; (4) `npm run check`; (5) file ngoài phạm vi. Báo cáo mỗi lỗi: AC/mục · file:dòng · input · mong đợi · thực tế. Tách (1) lỗi chặn merge (2) gợi ý.
