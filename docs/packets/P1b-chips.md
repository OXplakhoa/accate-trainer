# Packet P1b — Phát chip, kho, đổi chip, rebuy, cash out, sổ phiên

**Implementer:** Gemini 4 Hydrogen · **Reviewer:** GPT 6.2 Sol + Gemini 4 Neon · **Control:** Claude
**Song song với:** P1a (bài). Hai packet không được sửa chung file nào.

---

## Phần dán cho implementer

Bạn là implementer packet P1b của **Accate Trainer**. Đọc `AGENTS.md` trước, rồi `docs/02-spec.md` §3.1 và §3.5 (cả 3.5.1), `docs/03-acceptance-criteria.md` nhóm **C** và T4, `docs/04` các quyết định D14–D17, D20–D21, D24–D24c, O9. Không đổi luật/spec.

Nguyên tắc xuyên suốt: chip luôn là `ChipCounts` theo **từng mệnh giá** (5/10/50/100). Không bao giờ biểu diễn chip bằng một con số tổng; tổng chỉ là giá trị suy ra. Bộ chip 6.500 là giới hạn cứng (không có "kho vô hạn").

### Phạm vi file (chỉ được tạo/sửa các file này)
```
src/engine/bank.ts         tests/engine/bank.test.ts
src/engine/exchange.ts     tests/engine/exchange.test.ts
src/engine/ledger.ts       tests/engine/ledger.test.ts
```
**Không** sửa `src/engine/index.ts`, `rng.ts`, `chips.ts`, `AGENTS.md`, `QUESTIONS.md`, `docs/`, cấu hình. Dùng API có sẵn của `chips.ts` (`addChips`, `subtractChips`, `chipValue`, `checkInv1`, `CHIP_SET`, `DENOMINATIONS`…). Control tự thêm re-export khi merge.

### 1. Phát chip và kho — `bank.ts`
```ts
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const BUY_IN = 500;

/** Cơ cấu 500 điểm từ nguồn `available`, theo thuật toán spec §3.5.1 tổng quát hoá; không có nghiệm → null. */
export function structureFor500(available: ChipCounts): ChipCounts | null;

/** C1: N người, mỗi người cùng cơ cấu; N ngoài [4,10] hoặc không nguyên → throw (C1b). */
export function initialDistribution(n: number): { perPlayer: ChipCounts; bank: ChipCounts };

/** Lấy đúng `amount` từ `source`, ưu tiên chip LỚN trước (dùng khi cash out trả về kho); không có nghiệm → null. */
export function takeExactLargeFirst(source: ChipCounts, amount: number): ChipCounts | null;

export interface SeatedStack { readonly playerId: string; readonly stack: ChipCounts; }
export type BuyInPlan =
  | { readonly kind: 'from-bank'; readonly chips: ChipCounts }
  | { readonly kind: 'cash-out-then-bank'; readonly cashOutPlayerId: string; readonly cashOutChips: ChipCounts; readonly chips: ChipCounts };

/**
 * Rebuy / buy-in 500 (C4, C5, C6, T4).
 * - Kho đủ cơ cấu 500 → lấy từ kho bằng structureFor500(bank).
 * - Không đủ → người có stack giá trị lớn nhất (không tính `buyerId`) cash out đúng 500, chip lớn trước, về kho; rồi lấy 500 từ kho.
 * - Hòa stack lớn nhất (C6, 🟡 O9): chọn người ngồi gần `openerIndex` nhất theo chiều kim đồng hồ, tính từ chính người mở lời.
 * `seats` theo thứ tự ghế chiều kim đồng hồ.
 */
export function planBuyIn(bank: ChipCounts, seats: readonly SeatedStack[], buyerId: string, openerIndex: number): BuyInPlan;
```
**Thuật toán `structureFor500(available)`** — chính là spec §3.5.1 với ràng buộc "mỗi người được tối đa `floor(CHIP_SET[d] / N)` chip mệnh giá d" thay bằng "tối đa `available[d]`":
1. Chọn (a, b) với `a ≤ available[5]`, `b ≤ available[10]`, `5a + 10b` là bội 50, **tối đa a + b**, hoà thì a lớn hơn.
2. R = 500 − 5a − 10b: chọn (c, d) với `c ≤ available[50]`, `d ≤ available[100]`, `50c + 100d = R`, ưu tiên c lớn.
3. Không có nghiệm → thử (a, b) kế tiếp theo đúng thứ tự ưu tiên ở bước 1, lặp lại.

Vì vậy `initialDistribution(n).perPlayer === structureFor500({5: ⌊100/n⌋, 10: ⌊100/n⌋, 50: ⌊50/n⌋, 100: ⌊25/n⌋})`. Kết quả **phải khớp đúng bảng 7 dòng** ở spec §3.5.1 (cả cột kho còn lại). Đừng hard-code bảng trong code; bảng chỉ nằm trong test.

`takeExactLargeFirst`: trong các cách lấy đúng `amount`, chọn cách có nhiều chip 100 nhất, rồi nhiều 50 nhất, rồi nhiều 10 nhất.

Nếu người được chọn để cash out không ghép được đúng 500 từ stack của họ → throw lỗi có thông điệp rõ và ghi vào câu hỏi trong report (không tự chế luật).

### 2. Đổi chip — `exchange.ts` (D20, D21, C2, C3)
```ts
/** Hai bên đổi chip cùng tổng giá trị. Khác giá trị, hoặc một bên không đủ chip ở bất kỳ mệnh giá nào → throw. */
export function exchangeChips(a: ChipCounts, b: ChipCounts, fromA: ChipCounts, fromB: ChipCounts): { a: ChipCounts; b: ChipCounts };

/** Gợi ý đổi 1 chip `chip` lấy chip NHỎ HƠN từ `counterparty` (người chơi khác hoặc pot), cùng giá trị.
 *  Mặc định: tham lam từ mệnh giá nhỏ hơn lớn nhất xuống. Không ghép được → null. */
export function defaultBreakdown(chip: Denomination, counterparty: ChipCounts): ChipCounts | null;

/** C2: tổng chip hero đã chọn có khớp đúng `amount` không (UI dùng để khoá nút xác nhận). */
export function selectionMatches(selection: ChipCounts, amount: number): boolean;
```
Engine không biết "pot" hay "người chơi"; đó chỉ là hai `ChipCounts`. P1c sẽ ghép với pot.

### 3. Sổ phiên — `ledger.ts` (C7)
```ts
export type LedgerEvent =
  | { readonly type: 'buy-in'; readonly playerId: string; readonly chips: ChipCounts }
  | { readonly type: 'rebuy'; readonly playerId: string; readonly chips: ChipCounts }
  | { readonly type: 'cash-out'; readonly playerId: string; readonly chips: ChipCounts };
export interface PlayerLedger { readonly buyIns: number; readonly rebuys: number; readonly cashOuts: number; readonly invested: number; readonly cashedOut: number; }
export function summarizeLedger(events: readonly LedgerEvent[]): Readonly<Record<string, PlayerLedger>>;
/** Lời/lỗ = đã cash out + giá trị stack hiện tại − đã bỏ vào. */
export function profitLoss(ledger: PlayerLedger, currentStack: ChipCounts): number;
```
Sổ lưu `ChipCounts` của từng sự kiện; số điểm chỉ là giá trị suy ra.

### 4. Test bắt buộc (mọi test kiểm INV-1 sau **mỗi** bước bằng `checkInv1([bank, ...stacks, ...khác])`)
- **C1**: N = 4…10, `initialDistribution` khớp **từng ô** của bảng spec §3.5.1 (cơ cấu mỗi người và kho). Mỗi người đúng 500.
- **C1b**: N = 3, 11, 0, 4.5, NaN → throw.
- **C2**: `selectionMatches({5:1,10:3,...}, 30)` sai khi chọn 35, đúng khi chọn đúng 30.
- **C3**: hero stack `{50:3, 100:1}` cần call 35 → `defaultBreakdown(50, đối tác)` + `exchangeChips` → tổng giá trị hai bên không đổi, hero giờ có chip nhỏ để trả 35, INV-1 đúng. Thêm ca đối tác không có đủ chip nhỏ → `null`.
- **C4**: N = 10, ba người lần lượt rebuy → mỗi lần `planBuyIn` trả `from-bank` với `{100: 5}`; sau 3 lần kho = 0 mọi mệnh giá.
- **C5**: tiếp C4, người thứ tư rebuy → `cash-out-then-bank`, người stack lớn nhất trả 500 chip lớn trước; người cần rebuy nhận 500; INV-1 đúng sau từng bước (cash out, rồi buy-in).
- **C6**: hai người cùng stack lớn nhất → chọn đúng người gần người mở lời theo chiều kim đồng hồ (thử ít nhất 2 vị trí `openerIndex`).
- **C7**: chuỗi buy-in, 2 rebuy, cash out → `summarizeLedger` và `profitLoss` đúng.
- **T4**: 3 người ngồi, mời thêm 1 rival → `planBuyIn` cho người mới, nhận 500 từ kho.
- `structureFor500` với kho lẻ (vd chỉ có chip 100 và 50; hoặc không có chip 5): trả đúng cơ cấu hoặc `null`.
- `exchangeChips` khác giá trị hoặc thiếu chip → throw.

### Không được
- Cài vòng cược, pot, side pot, showdown, bài — thuộc P1a/P1c.
- Thêm dependency. Đổi API của P0.

### Xong khi
- `npm run check` pass. Không `TODO` ẩn.
- Mỗi AC C1, C1b, C2, C3, C4, C5, C6, C7, T4 có ít nhất một test mang tên chứa ID đó.

### Git
- Làm trong worktree được giao, nhánh `p1b-chips` (đã tạo từ `main`). Commit theo từng bước hợp lý. **Không push, không merge** — control push sau khi kiểm.

### Nộp lại (ghi vào file report control chỉ định)
1. Danh sách commit. 2. Bảng: mục 1–4 và từng AC → file/test. 3. Output `npm run check`. 4. Giả định và câu hỏi (đừng sửa `QUESTIONS.md`; ghi vào report).

---

## Yêu cầu review P1b (dán cho Sol và Neon, riêng từng người)

Review packet P1b ở nhánh `p1b-chips`. Review độc lập, đừng đọc review khác. **Không sửa, tạo, xoá file trong repo.** Đối chiếu phần "dán cho implementer" ở trên, `docs/02-spec.md` §3.5, `docs/03` nhóm C và T4. Kiểm riêng: (1) bảng 7 dòng đúng từng ô và được tính bằng thuật toán, không hard-code; (2) mọi phép chip theo từng mệnh giá, INV-1 kiểm sau mỗi bước; (3) rebuy/cash out/hòa stack đúng D24b–c, O9; (4) `npm run check`; (5) file ngoài phạm vi. Báo cáo mỗi lỗi: AC · file:dòng · input · mong đợi · thực tế. Tách (1) lỗi chặn merge (2) gợi ý.
