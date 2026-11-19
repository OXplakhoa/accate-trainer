# P0-fix1 — Sửa sau review (implementer: Gemini 4 Hydrogen)

Bạn là implementer của packet P0 dự án Accate Trainer, repo `F:\CODE\Poke`, đang ở nhánh `p0-scaffold`. Hai reviewer độc lập (GPT 6.2 Sol, Gemini 4 Neon) và control (Claude) đã review. Kết luận: **chưa merge**, vì ranh giới engine không được công cụ bảo vệ đủ. Mục đích gốc của packet: **engine phải tất định và thuần logic — không thứ gì phụ thuộc thời gian, entropy, môi trường hay UI, ngoài `Rng`.** Danh sách cấm dưới đây là ví dụ của mục đích đó, không phải giới hạn của nó.

Làm trên nhánh `p0-scaffold`, commit theo từng mục hợp lý, push lên `origin/p0-scaffold`. Không merge, không đụng `main`, không sửa `docs/`, không thêm dependency.

## Lỗi chặn merge

Tất cả các mẫu sau, đặt trong `src/engine/probe.ts`, hiện **qua** lint (exit 0). Sau khi sửa, mỗi mẫu phải **fail** ở ít nhất một trong: `npm run lint`, `npm run typecheck`, hoặc test runtime.

```
globalThis.Math.random()          const m = Math; m.random()
globalThis.Date.now()             new Date()      Date()
performance.now()                 crypto.getRandomValues(new Uint32Array(1))
crypto.randomUUID()               self.document.title     self.window
const g = globalThis; g.window    navigator       localStorage     fetch("x")
setTimeout(() => {}, 0)           import("react")         import("../ui/App")
import "../main"
```
Và các file khác đuôi `.ts` trong engine (`src/engine/probe.js`, `.mts`, `.tsx`) hiện không bị kiểm gì.

### F1. Tách cấu hình ESLint (`eslint.config.js`)
- `react-hooks`, `react-refresh`, `globals.browser` **chỉ** áp cho `src/ui/**` và `src/main.tsx`. (Hiện chúng áp cả engine: Neon thấy hàm thuần TS tên `useBank()` trong engine bị báo lỗi giả `rules-of-hooks`, và browser globals rò vào engine.)
- Block engine áp cho **mọi** file trong `src/engine/**` (mọi đuôi), chỉ có ES builtins làm globals.
- `no-restricted-globals` trong engine: ít nhất `window, document, self, globalThis, navigator, localStorage, sessionStorage, indexedDB, fetch, XMLHttpRequest, WebSocket, performance, crypto, setTimeout, setInterval, clearTimeout, clearInterval, requestAnimationFrame, queueMicrotask, process, Date` (engine không cần `Date` ở dạng nào).
- `no-restricted-syntax` trong engine: cấm `ImportExpression` (dynamic import), cấm gán `Math` cho biến (`VariableDeclarator[init.name='Math']`) và cấm destructure `Math`.
- Giữ `no-restricted-properties` cho `Math.random`. Mở rộng `no-restricted-imports`: thêm `**/main`, `node:*` và module built-in của Node.
- `lint` script: `eslint . --max-warnings 0`.

### F2. Typecheck engine không có DOM
- Thêm `tsconfig.engine.json`: `lib: ["ES2022"]`, `types: []`, include `src/engine`. `typecheck` chạy cả tsconfig gốc và tsconfig engine. Khi đó `document`, `performance`, `crypto`, `navigator`… trong engine là lỗi type.

### F3. Engine chỉ chứa `.ts`
- Thêm `tests/engine/boundary.test.ts`: duyệt đệ quy `src/engine`, fail nếu có file không phải `.ts` (cho phép `.ts` thường; cấm `.js/.mjs/.cjs/.mts/.cts/.tsx/.jsx`).

### F4. Lưới an toàn runtime
- Thêm vitest `setupFiles` cho test engine: thay `Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues`, `crypto.randomUUID` bằng hàm throw. Test engine nào vô tình chạy vào chúng sẽ fail, kể cả khi lint bị lách qua cách gián tiếp. Thêm một test tự kiểm lưới này (gọi `Math.random()` → throw).

### F5. `checkInv1` với số âm (`src/engine/chips.ts:81-112`)
- Hiện `checkInv1([{5:101,10:100,50:50,100:25},{5:-1,10:0,50:0,100:0}])` trả `{ok:false, diff:{0,0,0,0}}` — khó hiểu. Đổi: count âm → `throw RangeError` (nhất quán với count không nguyên và `assertNonNegativeCounts`). Cập nhật JSDoc. Test cho ca này.

## Gợi ý đã chấp nhận (làm luôn)
- **F6. Test RNG biên** (`tests/engine/rng.test.ts`):
  - Rejection sampling thật sự chạy: `createRng("p0-review")`, gọi `int(2 ** 31 + 1)` ba lần; lần thứ ba phải là `334994198` (bản chỉ lấy modulo sẽ ra `1187297695`). Ghi comment giải thích đây là golden value.
  - Phân bố trực tiếp của `int(3)` và `int(7)` (không qua shuffle): mỗi bucket lệch ≤ 5% với ≥ 60.000 mẫu.
  - `int(2 ** 32)` hợp lệ; `int(2 ** 32 + 1)` throw. `shuffle([])` → `[]`, `shuffle([1])` → `[1]`.
- **F7. Test chip biên** (`tests/engine/chips.test.ts`): số thập phân và số âm ở `addChips/subtractChips/chipValue` (theo hành vi hiện có), `checkInv1([])` → `ok:false` với `diff` = −CHIP_SET.
- **F8.** JSDoc của `int` ghi rõ miền: `1 ≤ maxExclusive ≤ 2**32`, số nguyên.
- **F9.** `Object.freeze` đối tượng `Rng` trả về từ `createRng`.

## Không làm
- Không đổi thuật toán RNG, không đổi API công khai (ngoài việc F5 throw thay vì trả `ok:false` khi count âm).
- Không sửa `docs/`. Không thêm dependency.

## Xong khi
1. `npm run check` pass.
2. Mỗi mẫu trong danh sách trên, đưa vào `src/engine/probe.ts` qua `npx eslint --stdin --stdin-filename src/engine/probe.ts`, cho exit 1 — hoặc bạn chỉ ra cụ thể nó bị bắt ở typecheck/runtime. Các ca hợp lệ (vd `export const x = Math.floor(1.5);`, `export function useBank() { return 1; }`) phải exit 0. Thử thêm qua `--stdin-filename src/engine/probe.js`.
3. `src/ui/probe.tsx` với `window.innerWidth + Date.now()` vẫn lint pass (UI không bị siết nhầm).
4. Working tree sạch sau khi push (không để lại file probe).

## Nộp lại
Ghi báo cáo vào file report do control chỉ định (UTF-8): danh sách commit; bảng F1–F9 → file/test; kết quả từng mẫu probe (exit code, bị bắt ở tầng nào); output `npm run check`; giả định đặt thêm.
