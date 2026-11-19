import { useState } from 'react';
import type { HandState } from '../../../engine';
import { PlayingCard } from '../assets/PlayingCard';
import { canPracticeDecisionRecord } from '../controller';
import {
  formatEvVi,
  formatPercentVi,
  formatStreetLabel,
  formatTimelineEventVi,
  getPlayerName,
  handCategoryVi,
} from '../format';
import {
  HERO_PLAYER_ID,
  type HandReviewSummary,
  type SeatProfileInfo,
  type TerminologyLanguage,
} from '../types';

export interface HandReviewModalProps {
  readonly review: HandReviewSummary;
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly terminology: TerminologyLanguage;
  readonly onPracticeSpot?: (hand: HandState, heroId: string) => void;
  readonly onNextHand?: () => void;
  readonly onClose: () => void;
}

export function HandReviewModal({
  review,
  seatProfiles,
  terminology,
  onPracticeSpot,
  onNextHand,
  onClose,
}: HandReviewModalProps) {
  const [activeTab, setActiveTab] = useState<'decisions' | 'showdown' | 'timeline'>('decisions');
  const nameOf = (id: string) => getPlayerName(id, seatProfiles);

  const hasBaiCao =
    review.showdownResolution?.potAwards.some((p) => p.tieBreak.kind === 'bai-cao') ?? false;

  return (
    <div
      className="sb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-review-title"
    >
      <div className="sb-modal sb-modal--xl">
        <header className="sb-modal__header">
          <div>
            <h2 id="sb-review-title">Xem lại ván #{review.handNumber}</h2>
            <p className="sb-review-outcome" role="status">
              {review.outcomeBannerVi}
            </p>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="sb-tabs" role="tablist" aria-label="Phần xem lại ván">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'decisions'}
            className={`sb-tab ${activeTab === 'decisions' ? 'sb-tab--active' : ''}`}
            onClick={() => setActiveTab('decisions')}
          >
            Quyết định của bạn ({review.decisions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'showdown'}
            className={`sb-tab ${activeTab === 'showdown' ? 'sb-tab--active' : ''}`}
            onClick={() => setActiveTab('showdown')}
          >
            {hasBaiCao ? 'Showdown & Bài cào' : 'Showdown & Pot'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timeline'}
            className={`sb-tab ${activeTab === 'timeline' ? 'sb-tab--active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            Timeline chính xác ({review.timeline.length})
          </button>
        </div>

        <div className="sb-modal__body">
          {activeTab === 'decisions' && (
            <div className="sb-review-decisions">
              {review.decisions.length === 0 ? (
                <p className="sb-muted">
                  Bạn chưa có quyết định chủ động nào trong ván này (ví dụ all-in từ ante hoặc không ngồi bàn).
                </p>
              ) : (
                review.decisions.map((item) => {
                  const snap = item.record.snapshot;
                  return (
                    <article key={item.record.decisionIndex} className="sb-decision-card">
                      <div className="sb-decision-card__head">
                        <div className="sb-decision-card__title">
                          <span className="sb-pill sb-pill--street">
                            {formatStreetLabel(snap.street, terminology)}
                          </span>
                          <span
                            className={`sb-pill ${item.record.fromOutOfTurn ? 'sb-pill--pending' : 'sb-pill--street'}`}
                          >
                            {item.turnLabelVi}
                          </span>
                          <strong className="sb-decision-card__action">
                            {item.chosenActionLabel}
                          </strong>
                        </div>
                        <span className={`sb-quality-badge sb-quality-badge--${item.qualityTone}`}>
                          {item.qualityLabel}
                        </span>
                      </div>

                      <div className="sb-decision-card__cards">
                        <div className="sb-card-strip">
                          <span className="sb-label">Bài Hero:</span>
                          <PlayingCard card={snap.heroCards[0]} size="sm" />
                          <PlayingCard card={snap.heroCards[1]} size="sm" />
                        </div>
                        <div className="sb-card-strip">
                          <span className="sb-label">
                            {item.record.fromOutOfTurn
                              ? 'Board lúc hô trước:'
                              : 'Board lúc quyết định:'}
                          </span>
                          {snap.board.length === 0 ? (
                            <span className="sb-muted">Chưa lật (Preflop)</span>
                          ) : (
                            snap.board.map((c, idx) => (
                              <PlayingCard key={idx} card={c} size="sm" />
                            ))
                          )}
                        </div>
                      </div>

                      <div className="sb-metrics-grid sb-num">
                        <div className="sb-metric-box">
                          <span className="sb-label">Pot odds (Equity cần)</span>
                          <strong>
                            {item.record.potOdds.hasCall
                              ? `${formatPercentVi(item.record.potOdds.requiredEquity)} (${item.record.potOdds.potToCallLabel})`
                              : 'Không cần call'}
                          </strong>
                        </div>
                        <div className="sb-metric-box">
                          <span className="sb-label">Equity ước lượng</span>
                          <strong>
                            {item.estimatedEquity !== null
                              ? formatPercentVi(item.estimatedEquity)
                              : '—'}
                          </strong>
                        </div>
                        <div className="sb-metric-box">
                          <span className="sb-label">
                            EV hành động ({item.chosenEvPrecision === 'exact' ? 'chính xác' : 'ước lượng'})
                          </span>
                          <strong>{formatEvVi(item.chosenEv)}</strong>
                        </div>
                        <div className="sb-metric-box">
                          <span className="sb-label">Phương án tham chiếu</span>
                          <strong>
                            {item.bestAlternativeLabel} ({formatEvVi(item.bestAlternativeEv)})
                          </strong>
                        </div>
                      </div>

                      <p className="sb-decision-card__explain">{item.explanationVi}</p>

                      <details className="sb-assumptions">
                        <summary>Giả định tính toán & range đối thủ</summary>
                        <ul>
                          {item.assumptionsVi.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                          {item.rangeSummariesVi.map((rangeNote, idx) => (
                            <li key={`r-${idx}`}>{rangeNote}</li>
                          ))}
                        </ul>
                      </details>

                      {onPracticeSpot && canPracticeDecisionRecord(item.record) && (
                        <div className="sb-decision-card__footer">
                          <button
                            type="button"
                            className="sb-btn sb-btn--secondary sb-btn--sm"
                            onClick={() =>
                              onPracticeSpot(item.record.handStateAtDecision, HERO_PLAYER_ID)
                            }
                          >
                            Luyện spot này trong Drill
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'showdown' && (
            <div className="sb-review-showdown">
              {review.outcomeKind === 'fold-win' ? (
                <p>
                  <strong>{nameOf(review.foldWinnerId ?? '')}</strong> thắng toàn bộ pot{' '}
                  <strong className="sb-num">{review.foldWinPotAmount} điểm</strong> vì mọi đối thủ đã fold. Bài của người thắng không bị lộ.
                </p>
              ) : review.showdownResolution ? (
                review.showdownResolution.potAwards.map((pot) => (
                  <article key={pot.potIndex} className="sb-pot-award-card">
                    <header className="sb-pot-award-card__head">
                      <h4>
                        {pot.potIndex === 0 ? 'Main Pot' : `Side Pot #${pot.potIndex}`} —{' '}
                        <span className="sb-num">{pot.potAmount} điểm</span>
                      </h4>
                      <span className="sb-num">
                        Thắng:{' '}
                        {pot.awards
                          .map((a) => `${nameOf(a.playerId)} (+${a.amount})`)
                          .join(', ')}
                      </span>
                    </header>

                    <div className="sb-showdown-hands">
                      {pot.eligiblePlayerIds.map((pid) => {
                        const evalHand = pot.evaluatedHands[pid];
                        return (
                          <div key={pid} className="sb-showdown-hand-row">
                            <strong>{nameOf(pid)}</strong>
                            <span>{evalHand ? handCategoryVi(evalHand.category) : '—'}</span>
                          </div>
                        );
                      })}
                    </div>

                    {pot.tieBreak.kind === 'bai-cao' && (
                      <div className="sb-baicao-box">
                        <h5>
                          Hòa bài → Bài cào phân thắng bại (Thắng:{' '}
                          {nameOf(pot.tieBreak.result.winnerId)})
                        </h5>
                        {pot.tieBreak.result.rounds.map((round, rIdx) => (
                          <div key={rIdx} className="sb-baicao-round">
                            <span className="sb-label">Lượt rút #{rIdx + 1}:</span>
                            <div className="sb-baicao-draws">
                              {round.map((draw) => (
                                <div key={draw.playerId} className="sb-baicao-draw">
                                  <strong>{nameOf(draw.playerId)}</strong>
                                  <div className="sb-baicao-cards">
                                    {draw.cards.map((c, cIdx) => (
                                      <PlayingCard key={cIdx} card={c} size="sm" />
                                    ))}
                                  </div>
                                  <span className="sb-badge sb-badge--accent sb-num">
                                    {draw.baTay ? 'Ba tây!' : `${draw.points} điểm`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {pot.tieBreak.kind === 'split' && (
                      <p className="sb-muted">
                        Hòa bài → Chia đều: mỗi người cơ bản {pot.tieBreak.baseAmount} điểm
                        {pot.tieBreak.oddChipRecipients.length > 0
                          ? ` · chip lẻ 5 trao ngẫu nhiên cho: ${pot.tieBreak.oddChipRecipients.map(nameOf).join(', ')}`
                          : ''}.
                      </p>
                    )}
                  </article>
                ))
              ) : null}
            </div>
          )}

          {activeTab === 'timeline' && (
            <ol className="sb-timeline-list">
              {review.timeline.map((ev, idx) => (
                <li
                  key={idx}
                  className={`sb-timeline-item sb-timeline-item--${ev.type}`}
                >
                  <span className="sb-timeline-idx sb-num">#{idx + 1}</span>
                  <span>{formatTimelineEventVi(ev, seatProfiles, terminology)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="sb-modal__footer">
          <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>
            Đóng
          </button>
          {onNextHand && (
            <button type="button" className="sb-btn sb-btn--primary" onClick={onNextHand}>
              Ván tiếp theo
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
