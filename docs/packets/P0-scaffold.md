# Packet P0 — Khung project, test runner, RNG có seed

**Implementer:** Gemini 4 Hydrogen · **Reviewer:** GPT 6.2 Sol + Gemini 4 Neon · **Control:** Claude (session điều phối)
**Thư mục làm việc:** `F:\CODE\Poke` (hiện đã có `docs/`, chưa phải git repo)

---

## Phần dán cho implementer (copy từ đây)

Bạn là implementer của packet P0 cho dự án **Accate Trainer**: web app luyện poker theo luật bàn riêng của một nhóm bạn. Spec nằm ở `docs/`. **Đọc trước:** `docs/01-product-brief.md` §6 (nền tảng) và `docs/02-spec.md` §1 (các mốc), §3.5 (chip). Bạn **không** cài đặt luật poker trong packet này.

### Mục tiêu
Dựng nền để các packet sau (P1a–P5) chỉ việc thêm code vào đúng chỗ:
1. Project chạy được, có test, lint, typecheck.
2. Ranh giới rõ giữa **engine** (luật, thuần logic) và **UI**.
3. RNG có seed: mọi thứ ngẫu nhiên trong engine lặp lại được.
4. Kiểu dữ liệu chip và bất biến **INV-1** dùng chung.

### Stack (🟡 control chọn, đừng đổi)
- Node 22, npm, **TypeScript strict**.
- **Vite + React** cho UI (UI chỉ cần trang trống có tiêu đề "Accate Trainer").
- **Vitest** cho test; **ESLint** + **Prettier**.
- Không thêm thư viện state/animation/audio. Các thư viện đó để P4 chọn.

### Cấu trúc thư mục
```
src/
  engine/          # thuần TypeScript, KHÔNG import React/DOM/window, KHÔNG dùng Math.random
    rng.ts
    chips.ts
    index.ts       # re-export public API của engine
  ui/
    App.tsx
  main.tsx
tests/
  engine/
    rng.test.ts
    chips.test.ts
AGENTS.md          # quy ước cho mọi model (xem bên dưới)
```

### 1. RNG có seed — `src/engine/rng.ts`
```ts
export interface Rng {
  next(): number;              // float trong [0, 1)
  int(maxExclusive: number): number;  // số nguyên trong [0, maxExclusive), không lệch (dùng rejection sampling)
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];  // Fisher–Yates, trả mảng MỚI, không sửa mảng vào
  fork(label: string): Rng;    // RNG con độc lập, xác định từ seed cha + label
  readonly seed: string;
}
export function createRng(seed: string | number): Rng;
```
- Thuật toán: PRNG 32-bit có seed (vd `sfc32` hoặc `xoshiro128**`), seed chuỗi được băm thành state (vd `cyrb128`). Ghi tên thuật toán trong comment.
- `fork` để các phần (chia bài, bot, bài cào, tilt của Nóng) có luồng ngẫu nhiên riêng: thêm một lần gọi RNG ở bot **không** được làm thay đổi bài được chia.
- `int(0)` hoặc số âm/không nguyên → throw.

### 2. Chip — `src/engine/chips.ts`
```ts
export const DENOMINATIONS = [5, 10, 50, 100] as const;
export type Denomination = typeof DENOMINATIONS[number];
export type ChipCounts = Readonly<Record<Denomination, number>>;   // số lượng chip mỗi mệnh giá, số nguyên ≥ 0

export const CHIP_SET: ChipCounts = { 5: 100, 10: 100, 50: 50, 100: 25 };  // tổng 6.500
export function chipValue(c: ChipCounts): number;
export function addChips(a: ChipCounts, b: ChipCounts): ChipCounts;
export function subtractChips(a: ChipCounts, b: ChipCounts): ChipCounts;  // throw nếu bất kỳ mệnh giá nào âm
export function emptyChips(): ChipCounts;

/** INV-1: tổng chip ở mọi nơi (stack, pot, phần đẩy ra khi hô sớm, kho) = CHIP_SET theo TỪNG mệnh giá. */
export function checkInv1(locations: readonly ChipCounts[]): { ok: true } | { ok: false; diff: Record<Denomination, number> };
```
- App **không bao giờ** biểu diễn chip bằng một con số tổng. Tổng giá trị chỉ là giá trị suy ra từ `ChipCounts`.
- Chưa cài thuật toán phát chip (thuộc P1b).

### 3. Test bắt buộc
`tests/engine/rng.test.ts`
- Cùng seed → cùng 1.000 số đầu tiên; khác seed → khác.
- `int(n)` luôn trong [0, n) với n = 1, 2, 7, 52, 2³¹.
- `shuffle` của 52 phần tử: là hoán vị (đủ, không trùng); không sửa mảng vào; cùng seed → cùng thứ tự.
- Phân bố đều: 60.000 lần `shuffle([0..5])`, mỗi phần tử ở vị trí 0 khoảng 10.000 lần (sai lệch ≤ 5%).
- `fork("deal")` cho cùng dãy dù RNG cha hay một fork khác đã được gọi bao nhiêu lần.
- Input không hợp lệ → throw.

`tests/engine/chips.test.ts`
- `chipValue(CHIP_SET) === 6500`.
- `subtractChips` throw khi âm, kể cả khi tổng giá trị vẫn đủ (vd lấy 1×50 từ 10×10).
- `checkInv1` ok với `[CHIP_SET]` và với một cách chia CHIP_SET thành 4 phần; báo đúng `diff` khi thiếu 1 chip 10 và thừa 2 chip 5.

### 4. Ràng buộc engine (bắt bằng công cụ, không chỉ bằng quy ước)
- ESLint chặn `Math.random`, `Date.now`, `window`, `document` trong `src/engine/**`.
- ESLint chặn `src/engine/**` import từ `src/ui/**` hoặc từ `react`.

### 5. Scripts trong `package.json`
`dev`, `build`, `test`, `lint`, `typecheck`, và `check` = typecheck + lint + test (chạy tuần tự, fail nếu một bước fail).

### 6. `AGENTS.md` (ngắn, ≤ 40 dòng)
Viết cho mọi model làm các packet sau:
- Spec là nguồn đúng duy nhất: `docs/02-spec.md`, AC ở `docs/03-acceptance-criteria.md`, quyết định ở `docs/04-…`.
- Không đổi luật/spec. Chỗ mơ hồ → ghi `QUESTIONS.md`, làm phần còn lại.
- Ranh giới engine/UI và lệnh cấm ở mục 4.
- Mọi ngẫu nhiên đi qua `Rng`; mỗi test dùng seed cố định.
- Mọi test engine sau mỗi bước phải kiểm INV-1 (và INV-2 khi có pot, từ P1c).
- Thuật ngữ poker giữ tiếng Anh trong code; chuỗi hiển thị tiếng Việt.
- Chạy `npm run check` trước khi nộp.
Tạo thêm `CLAUDE.md` và `GEMINI.md` mỗi file chỉ một dòng: `See AGENTS.md`.

### 7. Git
- `git init`, nhánh `main`. Commit đầu: chỉ thư mục `docs/` có sẵn.
- Làm P0 trên nhánh `p0-scaffold`, commit theo từng bước hợp lý. **Không merge** vào `main` (control merge sau review).
- `.gitignore`: `node_modules`, `dist`, `coverage`, `.env*`.

### Không được
- Cài luật poker, đánh giá tay bài, phát chip, UI bàn chơi — thuộc packet sau.
- Thêm thư viện ngoài danh sách stack.
- Sửa bất kỳ file nào trong `docs/`.

### Xong khi
- `npm run check` pass trên máy sạch (`rm -rf node_modules && npm ci && npm run check`).
- `npm run dev` mở được trang "Accate Trainer".
- Viết thêm một file tạm trong `src/engine` dùng `Math.random` → `npm run lint` fail (rồi xoá file đó).

### Nộp lại
1. Tên nhánh và danh sách commit.
2. Bảng: yêu cầu ở mục 1–7 → file/test tương ứng.
3. Output của `npm run check`.
4. Giả định đã đặt và nội dung `QUESTIONS.md` (nếu có).

---

## Yêu cầu review P0 (dán cho GPT 6.2 Sol và Gemini 4 Neon, **riêng từng người**)

Review packet P0 của dự án Accate Trainer ở nhánh `p0-scaffold` (thư mục `F:\CODE\Poke`). Review độc lập, đừng đọc review khác. **Không sửa code.**

Đối chiếu với file `docs/packets/P0-scaffold.md`, phần "dán cho implementer". Kiểm riêng:
1. RNG: có lệch phân bố không (đặc biệt `int` với n không phải luỹ thừa 2), `shuffle` có đúng Fisher–Yates không, `fork` có thật sự độc lập với số lần gọi RNG cha không.
2. `subtractChips` và `checkInv1` làm việc theo **từng mệnh giá**, không theo tổng giá trị.
3. Lệnh cấm ESLint có thật sự fail khi vi phạm không (hãy thử).
4. `npm ci && npm run check` pass.
5. Có thứ gì ngoài phạm vi P0 bị thêm vào không.

Báo cáo mỗi lỗi: mục · file:dòng · input/seed · mong đợi · thực tế. Tách riêng (1) lỗi chặn merge (2) gợi ý.
