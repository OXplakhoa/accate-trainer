export const DRILL_SCOPED_CSS = `
.accate-drill-root {
  --drill-bg: #101815;
  --drill-panel: #1b2923;
  --drill-panel-alt: #22352d;
  --drill-felt: #194a38;
  --drill-felt-deep: #123628;
  --drill-border: #334d42;
  --drill-border-warm: #755b3c;
  --drill-text: #f5eee2;
  --drill-text-muted: #bbc8bc;
  --drill-accent: #edc28d;
  --drill-accent-strong: #f5ce9b;
  --drill-card-bg: #fbf7ef;
  --drill-card-border: #d6c8b2;
  --drill-good: #6be0a2;
  --drill-good-bg: rgba(38, 122, 80, 0.28);
  --drill-warn: #f4c668;
  --drill-warn-bg: rgba(158, 108, 25, 0.28);
  --drill-bad: #ff8e85;
  --drill-bad-bg: rgba(155, 44, 44, 0.30);
  --drill-tilt: #ff7366;

  background-color: var(--drill-bg);
  color: var(--drill-text);
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-variant-numeric: tabular-nums;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 12px;
  line-height: 1.45;
}

.accate-drill-root *,
.accate-drill-root *::before,
.accate-drill-root *::after {
  box-sizing: border-box;
}

.accate-drill-root button,
.accate-drill-root input,
.accate-drill-root select {
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}

.accate-drill-root button:focus-visible,
.accate-drill-root input:focus-visible,
.accate-drill-root select:focus-visible {
  outline: 2px solid var(--drill-accent);
  outline-offset: 2px;
}

.drill-shell {
  max-width: 1380px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drill-topbar {
  background: var(--drill-panel);
  border: 1px solid var(--drill-border);
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.drill-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drill-brand-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--drill-accent);
  letter-spacing: 0.01em;
}

.drill-brand-sub {
  font-size: 0.82rem;
  color: var(--drill-text-muted);
}

.drill-nav-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.drill-btn {
  background: var(--drill-panel-alt);
  color: var(--drill-text);
  border: 1px solid var(--drill-border);
  border-radius: 8px;
  padding: 7px 12px;
  min-height: 38px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.drill-btn:hover:not(:disabled) {
  border-color: var(--drill-accent);
  background: #2b4238;
}

.drill-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.drill-btn-primary {
  background: var(--drill-accent);
  color: #101815;
  border-color: var(--drill-accent);
  font-weight: 700;
}

.drill-btn-primary:hover:not(:disabled) {
  background: var(--drill-accent-strong);
  color: #101815;
}

.drill-btn-active {
  background: #2c4a3c;
  border-color: var(--drill-accent);
  color: var(--drill-accent);
}

.drill-btn-danger {
  background: rgba(155, 44, 44, 0.35);
  border-color: #c95b54;
  color: #ffd3cf;
}

.drill-controls-bar {
  background: var(--drill-panel);
  border: 1px solid var(--drill-border);
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.drill-level-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.drill-select-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.drill-select {
  background: var(--drill-bg);
  color: var(--drill-text);
  border: 1px solid var(--drill-border);
  border-radius: 8px;
  padding: 7px 10px;
  min-height: 38px;
  font-size: 0.86rem;
}

.drill-banner {
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.9rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.drill-banner-good {
  background: var(--drill-good-bg);
  border: 1px solid var(--drill-good);
  color: var(--drill-text);
}

.drill-banner-warn {
  background: var(--drill-warn-bg);
  border: 1px solid var(--drill-warn);
  color: var(--drill-text);
}

.drill-banner-bad {
  background: var(--drill-bad-bg);
  border: 1px solid var(--drill-bad);
  color: var(--drill-text);
}

.drill-workspace {
  display: grid;
  grid-template-columns: 1.15fr 0.95fr;
  gap: 14px;
  align-items: start;
}

@media (max-width: 1024px) {
  .drill-workspace {
    grid-template-columns: 1fr;
  }
}

.drill-felt-panel {
  background: radial-gradient(circle at 50% 38%, var(--drill-felt) 0%, var(--drill-felt-deep) 88%);
  border: 3px solid var(--drill-border-warm);
  border-radius: 18px;
  padding: 14px;
  box-shadow: inset 0 0 28px rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drill-spot-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  background: rgba(16, 24, 21, 0.58);
  border: 1px solid rgba(237, 194, 141, 0.28);
  border-radius: 10px;
  padding: 10px 12px;
}

.drill-spot-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--drill-accent);
}

.drill-spot-prompt {
  margin: 4px 0 0;
  font-size: 0.86rem;
  color: var(--drill-text);
}

.drill-badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.drill-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 600;
  background: rgba(16, 24, 21, 0.72);
  border: 1px solid var(--drill-border);
  color: var(--drill-text-muted);
}

.drill-badge-accent {
  border-color: var(--drill-accent);
  color: var(--drill-accent);
}

.drill-badge-tilt {
  background: rgba(180, 38, 38, 0.35);
  border-color: var(--drill-tilt);
  color: #ffc5bf;
}

.drill-seats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 8px;
}

.drill-seat-card {
  background: rgba(16, 24, 21, 0.76);
  border: 1px solid rgba(187, 200, 188, 0.25);
  border-radius: 11px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.drill-seat-card-active {
  border-color: var(--drill-accent);
  box-shadow: 0 0 0 1px var(--drill-accent);
}

.drill-seat-card-folded {
  opacity: 0.55;
}

.drill-seat-card-tilted {
  border-color: var(--drill-tilt);
  background: rgba(58, 18, 18, 0.78);
}

.drill-seat-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drill-seat-name {
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--drill-text);
}

.drill-seat-style {
  font-size: 0.75rem;
  color: var(--drill-accent);
}

.drill-seat-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--drill-text-muted);
  gap: 4px;
}

.drill-oot-bubble {
  background: rgba(237, 194, 141, 0.18);
  border: 1px dashed var(--drill-accent);
  border-radius: 8px;
  padding: 3px 7px;
  font-size: 0.75rem;
  color: var(--drill-accent);
}

.drill-board-zone {
  background: rgba(16, 24, 21, 0.55);
  border: 1px solid rgba(237, 194, 141, 0.32);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.drill-cards-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.drill-playing-card {
  width: 48px;
  height: 68px;
  background: var(--drill-card-bg);
  border: 1.5px solid var(--drill-card-border);
  border-radius: 7px;
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 4px 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.32);
  user-select: none;
  animation: drill-card-enter 0.22s ease-out;
}

.drill-playing-card-sm {
  width: 38px;
  height: 54px;
  padding: 3px 4px;
}

.drill-playing-card-back {
  background: repeating-linear-gradient(
    45deg,
    #254438,
    #254438 5px,
    #1c352b 5px,
    #1c352b 10px
  );
  border-color: var(--drill-accent);
}

.drill-card-rank {
  font-size: 0.92rem;
  font-weight: 800;
  line-height: 1;
}

.drill-card-suit {
  font-size: 1.1rem;
  line-height: 1;
  align-self: center;
}

.drill-pot-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.drill-pot-main {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--drill-accent);
}

.drill-hero-zone {
  background: rgba(16, 24, 21, 0.82);
  border: 1.5px solid var(--drill-accent);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drill-chip-rack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.drill-chip-btn {
  background: rgba(27, 41, 35, 0.9);
  border: 1px solid var(--drill-border);
  border-radius: 10px;
  padding: 6px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--drill-text);
  font-size: 0.84rem;
  font-weight: 700;
}

.drill-chip-btn:hover:not(:disabled) {
  border-color: var(--drill-accent);
  transform: translateY(-1px);
}

.drill-chip-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.drill-action-panel {
  background: var(--drill-panel);
  border: 1px solid var(--drill-border);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drill-step-track {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.drill-step-pill {
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 0.76rem;
  font-weight: 600;
  background: var(--drill-bg);
  border: 1px solid var(--drill-border);
  color: var(--drill-text-muted);
}

.drill-step-pill-current {
  border-color: var(--drill-accent);
  color: var(--drill-accent);
  background: rgba(237, 194, 141, 0.12);
}

.drill-step-pill-done-ok {
  border-color: var(--drill-good);
  color: var(--drill-good);
}

.drill-step-pill-done-err {
  border-color: var(--drill-bad);
  color: var(--drill-bad);
}

.drill-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.drill-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drill-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--drill-text-muted);
}

.drill-input {
  background: var(--drill-bg);
  color: var(--drill-text);
  border: 1px solid var(--drill-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.95rem;
  min-height: 40px;
}

.drill-timer-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--drill-bg);
  border: 1px solid var(--drill-border);
}

.drill-timer-urgent {
  border-color: var(--drill-tilt);
  background: rgba(165, 38, 38, 0.25);
  color: #ffc5bf;
}

.drill-feedback-card {
  background: var(--drill-bg);
  border: 1px solid var(--drill-border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.86rem;
}

.drill-progress-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.drill-metric-card {
  background: var(--drill-panel);
  border: 1px solid var(--drill-border);
  border-radius: 11px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drill-metric-value {
  font-size: 1.45rem;
  font-weight: 800;
  color: var(--drill-accent);
}

.drill-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.drill-table th,
.drill-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--drill-border);
  text-align: left;
}

.drill-table th {
  color: var(--drill-accent);
  font-weight: 700;
}

@keyframes drill-card-enter {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .accate-drill-root *,
  .accate-drill-root *::before,
  .accate-drill-root *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}

.accate-drill-root.drill-reduced-motion *,
.accate-drill-root.drill-reduced-motion *::before,
.accate-drill-root.drill-reduced-motion *::after {
  animation-duration: 0.001ms !important;
  transition-duration: 0.001ms !important;
}

@media (max-width: 420px) {
  .accate-drill-root {
    padding: 8px;
  }
  .drill-topbar,
  .drill-controls-bar,
  .drill-felt-panel,
  .drill-action-panel {
    padding: 10px;
  }
  .drill-seats-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 340px) {
  .drill-seats-grid {
    grid-template-columns: 1fr;
  }
}
`;
