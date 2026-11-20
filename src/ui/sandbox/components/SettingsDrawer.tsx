import { useMemo, useState } from 'react';
import {
  BET_STEP,
  BUY_IN,
  MAX_PLAYERS,
  MAX_PREFLOP_CAP,
  MIN_PLAYERS,
  MIN_PREFLOP_CAP,
  RIVAL_DISPLAY_INFO,
  RIVAL_IDS,
  type RivalId,
} from '../../../engine';
import { formatChipBreakdown } from '../format';
import {
  getChipDistributionRows,
  hasTableRuleChanges,
  VALID_TOURNAMENT_TIMERS,
} from '../settings';
import type { SandboxSettings, TerminologyLanguage, TournamentTimerSeconds } from '../types';

export interface SettingsDrawerProps {
  readonly appliedSettings: SandboxSettings;
  readonly pendingSettings: SandboxSettings | null;
  readonly isInHand: boolean;
  readonly hasPracticeSpotCallback: boolean;
  readonly onApply: (next: SandboxSettings, mode: 'apply-boundary' | 'new-session') => void;
  readonly onTestAudio?: (channel: 'chips' | 'cards' | 'timer', next: SandboxSettings) => void;
  readonly onClose: () => void;
}

export function SettingsDrawer({
  appliedSettings,
  pendingSettings,
  isInHand,
  hasPracticeSpotCallback,
  onApply,
  onTestAudio,
  onClose,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState<SandboxSettings>(pendingSettings ?? appliedSettings);
  const [showFullDistTable, setShowFullDistTable] = useState(false);

  const distRows = useMemo(() => getChipDistributionRows(), []);
  const selectedDist =
    distRows.find((r) => r.playerCount === draft.playerCount) ?? distRows[2]!;

  const minRivalsRequired = draft.playerCount - 1;
  const rivalPoolTooSmall = draft.enabledRivalIds.length < minRivalsRequired;
  const tableChanged = hasTableRuleChanges(appliedSettings, draft);

  const toggleRival = (id: RivalId) => {
    const exists = draft.enabledRivalIds.includes(id);
    if (exists) {
      const next = draft.enabledRivalIds.filter((x) => x !== id);
      setDraft({ ...draft, enabledRivalIds: next });
    } else {
      setDraft({ ...draft, enabledRivalIds: [...draft.enabledRivalIds, id] });
    }
  };

  const setPlayerCount = (n: number) => {
    if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
      return;
    }
    const nextEnabled = [...draft.enabledRivalIds];
    if (nextEnabled.length < n - 1) {
      for (const id of RIVAL_IDS) {
        if (!nextEnabled.includes(id)) {
          nextEnabled.push(id);
          if (nextEnabled.length >= n - 1) {
            break;
          }
        }
      }
    }
    setDraft({
      ...draft,
      playerCount: n,
      enabledRivalIds: nextEnabled,
    });
  };

  const preflopCapValues: number[] = [];
  for (let v = MIN_PREFLOP_CAP; v <= MAX_PREFLOP_CAP; v += BET_STEP) {
    preflopCapValues.push(v);
  }

  return (
    <div
      className="sb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-settings-title"
    >
      <div className="sb-modal sb-modal--xl">
        <header className="sb-modal__header">
          <div>
            <h2 id="sb-settings-title">Cài đặt Bàn Sandbox & Tùy chọn</h2>
            <p className="sb-muted">
              Tùy chọn giao diện/âm thanh áp dụng ngay. Thay đổi luật và số ghế áp dụng ở ranh giới ván tiếp theo.
            </p>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="sb-modal__body sb-settings-grid">
          <section className="sb-settings-section">
            <h3>1. Bàn chơi & Cơ cấu chip</h3>

            <div className="sb-field">
              <span>Số người chơi trên bàn (4–10 người, gồm Hero)</span>
              <div className="sb-seat-count-bar" role="group" aria-label="Chọn số người chơi từ 4 đến 10">
                {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`sb-pill-btn sb-num ${draft.playerCount === n ? 'sb-pill-btn--active' : ''}`}
                    aria-pressed={draft.playerCount === n}
                    onClick={() => setPlayerCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="sb-chip-dist-card">
              <div className="sb-chip-dist-card__row">
                <span>Buy-in cố định:</span>
                <strong className="sb-num">{BUY_IN} điểm / người (Kho tổng 6.500 điểm)</strong>
              </div>
              <div className="sb-chip-dist-card__row">
                <span>Phát mỗi người ({selectedDist.playerCount} ghế):</span>
                <strong className="sb-num">{formatChipBreakdown(selectedDist.perPlayer)}</strong>
              </div>
              <div className="sb-chip-dist-card__row">
                <span>Kho còn lại ban đầu:</span>
                <span className="sb-num">{formatChipBreakdown(selectedDist.bank)}</span>
              </div>
              <button
                type="button"
                className="sb-btn sb-btn--ghost sb-btn--xs"
                onClick={() => setShowFullDistTable((prev) => !prev)}
              >
                {showFullDistTable ? 'Ẩn bảng phát chip 4–10 ghế' : 'Xem đủ bảng phát chip 4–10 ghế'}
              </button>

              {showFullDistTable && (
                <div className="sb-table-wrap">
                  <table className="sb-table sb-num">
                    <thead>
                      <tr>
                        <th>N</th>
                        <th>Chip 5</th>
                        <th>Chip 10</th>
                        <th>Chip 50</th>
                        <th>Chip 100</th>
                        <th>Kho còn (5/10/50/100)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distRows.map((row) => (
                        <tr
                          key={row.playerCount}
                          className={row.playerCount === draft.playerCount ? 'sb-row-highlight' : ''}
                        >
                          <td>{row.playerCount}</td>
                          <td>{row.perPlayer[5]}</td>
                          <td>{row.perPlayer[10]}</td>
                          <td>{row.perPlayer[50]}</td>
                          <td>{row.perPlayer[100]}</td>
                          <td>
                            {row.bank[5]} / {row.bank[10]} / {row.bank[50]} / {row.bank[100]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="sb-field">
              <span>
                Danh sách rival được phép ngồi bàn ({draft.enabledRivalIds.length}/9 — cần tối thiểu{' '}
                {minRivalsRequired})
              </span>
              <div className="sb-rival-grid">
                {RIVAL_IDS.map((id) => {
                  const info = RIVAL_DISPLAY_INFO[id];
                  const checked = draft.enabledRivalIds.includes(id);
                  return (
                    <label
                      key={id}
                      className={`sb-rival-toggle ${checked ? 'sb-rival-toggle--on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRival(id)}
                      />
                      <div>
                        <strong>{info.name}</strong>
                        <span className="sb-rival-toggle__style">{info.styleLabel}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              {rivalPoolTooSmall && (
                <p className="sb-validation-hint" role="alert">
                  Cần bật ít nhất {minRivalsRequired} rival cho bàn {draft.playerCount} người (không trùng nhân vật).
                </p>
              )}
            </div>
          </section>

          <section className="sb-settings-section">
            <h3>2. Luật Accate & Đồng hồ</h3>

            <label className="sb-check-row">
              <input
                type="checkbox"
                checked={draft.enablePreflopBetting}
                onChange={(e) => setDraft({ ...draft, enablePreflopBetting: e.target.checked })}
              />
              <span>
                <strong>Cược trước flop (Preflop)</strong> — mặc định tắt (lật flop trước rồi mới cược)
              </span>
            </label>

            <label className="sb-field">
              <span>Cap preflop (5–50, bước 5 · cap postflop cố định 50)</span>
              <select
                value={draft.preflopCap}
                disabled={!draft.enablePreflopBetting}
                onChange={(e) => setDraft({ ...draft, preflopCap: Number(e.target.value) })}
              >
                {preflopCapValues.map((v) => (
                  <option key={v} value={v}>
                    {v} điểm
                  </option>
                ))}
              </select>
            </label>

            <div className="sb-field">
              <span>Xử lý hòa ở showdown</span>
              <div className="sb-radio-row">
                <label className="sb-radio-pill">
                  <input
                    type="radio"
                    name="tieBreakMode"
                    checked={draft.tieBreakMode === 'bai-cao'}
                    onChange={() => setDraft({ ...draft, tieBreakMode: 'bai-cao' })}
                  />
                  <span>Bài cào (mặc định)</span>
                </label>
                <label className="sb-radio-pill">
                  <input
                    type="radio"
                    name="tieBreakMode"
                    checked={draft.tieBreakMode === 'split'}
                    onChange={() => setDraft({ ...draft, tieBreakMode: 'split' })}
                  />
                  <span>Chia đều (chip lẻ 5 ngẫu nhiên)</span>
                </label>
              </div>
            </div>

            <label className="sb-check-row">
              <input
                type="checkbox"
                checked={draft.allowOutOfTurn}
                onChange={(e) => setDraft({ ...draft, allowOutOfTurn: e.target.checked })}
              />
              <span>
                <strong>Bật hô sớm trước lượt</strong> (cho cả rival và Hero theo luật X1–X7)
              </span>
            </label>

            <div className="sb-field">
              <span>Thời gian đồng hồ mỗi lượt (thiết lập cho Tournament)</span>
              <div className="sb-seat-count-bar" role="group" aria-label="Chọn thời gian đồng hồ">
                {VALID_TOURNAMENT_TIMERS.map((sec: TournamentTimerSeconds) => (
                  <button
                    key={sec}
                    type="button"
                    className={`sb-pill-btn sb-num ${draft.tournamentTimerSeconds === sec ? 'sb-pill-btn--active' : ''}`}
                    aria-pressed={draft.tournamentTimerSeconds === sec}
                    onClick={() => setDraft({ ...draft, tournamentTimerSeconds: sec })}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            <label className="sb-field">
              <span>Tốc độ lượt rival</span>
              <select
                value={draft.botSpeedMs}
                onChange={(e) => setDraft({ ...draft, botSpeedMs: Number(e.target.value) })}
              >
                <option value={300}>Nhanh (0,3 giây)</option>
                <option value={700}>Tiêu chuẩn (0,7 giây)</option>
                <option value={1200}>Chậm rãi dễ đọc (1,2 giây)</option>
              </select>
            </label>

            {hasPracticeSpotCallback && (
              <label className="sb-check-row">
                <input
                  type="checkbox"
                  checked={draft.pauseOnImportantSpot}
                  onChange={(e) =>
                    setDraft({ ...draft, pauseOnImportantSpot: e.target.checked })
                  }
                />
                <span>
                  <strong>Gợi ý dừng ở spot quan trọng</strong> (hiện nút nhanh chuyển sang Drill)
                </span>
              </label>
            )}
          </section>

          <section className="sb-settings-section">
            <h3>3. Âm thanh, Chuyển động & Ngôn ngữ</h3>

            <label className="sb-check-row">
              <input
                type="checkbox"
                checked={draft.reducedMotion}
                onChange={(e) => setDraft({ ...draft, reducedMotion: e.target.checked })}
              />
              <span>
                <strong>Giảm chuyển động (Reduced motion)</strong> — tắt animation bay chip/lật bài
              </span>
            </label>

            <label className="sb-field">
              <span>Ngôn ngữ thuật ngữ poker</span>
              <select
                value={draft.terminology}
                onChange={(e) =>
                  setDraft({ ...draft, terminology: e.target.value as TerminologyLanguage })
                }
              >
                <option value="en-standard">Thuật ngữ tiếng Anh chuẩn (Bet / Call / Raise / Pot odds)</option>
                <option value="vi-bilingual">Song ngữ Việt–Anh (Cược / Theo / Tố kèm tiếng Anh)</option>
              </select>
            </label>

            <label className="sb-check-row">
              <input
                type="checkbox"
                checked={draft.audio.muted}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    audio: { ...draft.audio, muted: e.target.checked },
                  })
                }
              />
              <span>
                <strong>Tắt toàn bộ âm thanh</strong>
              </span>
            </label>

            {(
              [
                ['chips', 'Âm lượng chip'],
                ['cards', 'Âm lượng chia/lật bài'],
                ['timer', 'Âm lượng đồng hồ'],
                ['music', 'Nhạc nền dịu (lounge)'],
              ] as const
            ).map(([channel, label]) => (
              <label key={channel} className="sb-slider-row">
                <span>
                  {label}: <strong className="sb-num">{draft.audio[channel]}%</strong>
                </span>
                <div className="sb-slider-row__control">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={draft.audio.muted}
                    value={draft.audio[channel]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        audio: { ...draft.audio, [channel]: Number(e.target.value) },
                      })
                    }
                  />
                  {channel !== 'music' && onTestAudio && (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--xs"
                      disabled={draft.audio.muted}
                      onClick={() => onTestAudio(channel, draft)}
                    >
                      Thử
                    </button>
                  )}
                </div>
              </label>
            ))}
          </section>
        </div>

        <footer className="sb-modal__footer sb-modal__footer--wrap">
          <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="sb-btn sb-btn--secondary"
            disabled={rivalPoolTooSmall}
            onClick={() => {
              onApply(draft, 'new-session');
              onClose();
            }}
          >
            Tạo phiên mới (reset 500)
          </button>
          <button
            type="button"
            className="sb-btn sb-btn--primary"
            disabled={rivalPoolTooSmall}
            onClick={() => {
              onApply(draft, 'apply-boundary');
              onClose();
            }}
          >
            {isInHand && tableChanged ? 'Lưu (áp dụng từ ván sau)' : 'Lưu & Áp dụng'}
          </button>
        </footer>
      </div>
    </div>
  );
}
