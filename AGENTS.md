# Accate Trainer — Agent Conventions

- **Single source of truth:** `docs/02-spec.md` (rules/spec), `docs/03-acceptance-criteria.md` (AC), `docs/04-decisions-and-open-questions.md` (decisions).
- **Never alter rules or spec.** If something is ambiguous or contradictory, document it in `QUESTIONS.md` and implement the unambiguous parts.
- **Engine / UI boundary (enforced by ESLint):**
  - `src/engine/**` must be pure TypeScript.
  - Forbidden in `src/engine/**`: `Math.random`, `Date.now`, `window`, `document`, and imports from `react` or `src/ui/**`.
- **Determinism:** All randomness must go through `Rng` (`src/engine/rng.ts`) using `fork(label)` for independent streams. Every test must use a fixed seed.
- **Invariants:** Every engine test must verify **INV-1** (`checkInv1` per denomination, never by total value) after every step, and **INV-2** (pot = total contributions) from P1c onward.
- **Language:** Use English poker terminology in code/identifiers; use Vietnamese for user-facing display strings.
- **Before submitting:** Run `npm run check` (`typecheck` + `lint` + `test`) and verify all checks pass cleanly.
