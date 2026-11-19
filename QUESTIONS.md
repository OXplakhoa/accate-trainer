# Questions & Assumptions (P0)

1. **`checkInv1` sign convention for `diff`:**
   `docs/packets/P0-scaffold.md` §2 specifies `{ ok: false; diff: Record<Denomination, number> }` and §3 states "thiếu 1 chip 10 và thừa 2 chip 5" (missing 1×10 and 2 extra×5).
   - **Assumption made:** `diff[d] = actualTotal[d] - CHIP_SET[d]` (positive = surplus/thừa, negative = deficit/thiếu), yielding `{ 5: 2, 10: -1, 50: 0, 100: 0 }`.
   - Please confirm if the opposite sign (`CHIP_SET[d] - actualTotal[d]`) was intended.

2. **`fork(label)` `.seed` format and empty label:**
   - **Assumption made:** `fork(label)` derives the child via `createRng(`${parentSeed.length}:${parentSeed}:${label}`)` so child `.seed` is deterministic, collision-free, and reproducible via `createRng(child.seed)`. Empty string `""` is accepted as a seed/label.
