import { useState } from 'react';
import { RIVAL_DISPLAY_INFO } from '../../engine';
import {
  DRILL_CONCEPT_IDS,
  DRILL_CONCEPT_TITLES_VI,
  evaluateLessonMiniCheck,
  getDrillLesson,
  type DrillConceptId,
} from '../../engine/drill';
import { CardView, RivalAvatar } from './VisualComponents';

export function LessonView(props: {
  readonly conceptId: DrillConceptId;
  readonly completedLessons: readonly DrillConceptId[];
  readonly onSelectConcept: (conceptId: DrillConceptId) => void;
  readonly onCompleteAndPractice: (conceptId: DrillConceptId) => void;
}) {
  const { conceptId, completedLessons, onSelectConcept, onCompleteAndPractice } = props;
  const lesson = getDrillLesson(conceptId);
  const [selectedAnswers, setSelectedAnswers] = useState<Partial<Record<DrillConceptId, number>>>(
    {},
  );

  const selectedIdx = selectedAnswers[conceptId];
  const checkResult =
    selectedIdx !== undefined ? evaluateLessonMiniCheck(conceptId, selectedIdx) : null;
  const isCompleted = completedLessons.includes(conceptId);
  const rivalDisplay = RIVAL_DISPLAY_INFO[lesson.accateExample.rivalId];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Concept Tabs */}
      <div
        className="drill-controls-bar"
        role="tablist"
        aria-label="Danh sách bài học khái niệm Cấp 0"
      >
        <div className="drill-level-pills">
          {DRILL_CONCEPT_IDS.map((id, idx) => {
            const done = completedLessons.includes(id);
            const active = id === conceptId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`drill-btn${active ? ' drill-btn-active' : ''}`}
                onClick={() => onSelectConcept(id)}
              >
                <span>
                  {idx + 1}. {DRILL_CONCEPT_TITLES_VI[id]}
                </span>
                {done ? <span aria-label="Đã học">✓</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Lesson Card */}
      <div className="drill- workspace" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <article className="drill-action-panel" aria-label={lesson.titleVi}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <div>
              <h2 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.2rem' }}>
                {lesson.titleVi}
              </h2>
              <p style={{ margin: '4px 0 0', color: 'var(--drill-text-muted)', fontSize: '0.9rem' }}>
                {lesson.subtitleVi}
              </p>
            </div>
            <div className="drill-badges-row">
              <span className="drill-badge drill-badge-accent">
                ⏱ {lesson.estimatedMinutes} phút đọc
              </span>
              {lesson.lectureRefs.map((ref) => (
                <span key={ref} className="drill-badge">
                  📖 {ref}
                </span>
              ))}
              {isCompleted ? (
                <span className="drill-badge" style={{ borderColor: 'var(--drill-good)', color: 'var(--drill-good)' }}>
                  ✓ Đã học xong
                </span>
              ) : null}
            </div>
          </div>

          {lesson.sections.map((sec) => (
            <section key={sec.headingVi} className="drill-feedback-card">
              <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '0.98rem' }}>
                {sec.headingVi}
              </h3>
              {sec.paragraphsVi.map((p, i) => (
                <p key={i} style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>
                  {p}
                </p>
              ))}
            </section>
          ))}

          {/* Concrete Accate Table Example */}
          <section
            className="drill-felt-panel"
            aria-label={`Ví dụ bàn Accate: ${lesson.accateExample.titleVi}`}
          >
            <div className="drill-spot-header">
              <div>
                <h3 className="drill-spot-title">{lesson.accateExample.titleVi}</h3>
                <p className="drill-spot-prompt">{lesson.accateExample.setupVi}</p>
              </div>
              <div className="drill-badges-row">
                <span className="drill-badge drill-badge-accent">
                  Pot: {lesson.accateExample.potBeforeCall}
                </span>
                <span className="drill-badge">
                  Cần Call: {lesson.accateExample.callAmount}
                </span>
                <span className="drill-badge">
                  Cap street: {lesson.accateExample.streetCap}
                </span>
              </div>
            </div>

            <div className="drill-board-zone">
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--drill-text-muted)', marginBottom: 4 }}>
                  Bài riêng của Hero
                </div>
                <div className="drill-cards-row">
                  <CardView card={lesson.accateExample.heroCards[0]} />
                  <CardView card={lesson.accateExample.heroCards[1]} />
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--drill-text-muted)', marginBottom: 4 }}>
                  Board chung trên bàn
                </div>
                <div className="drill-cards-row">
                  {lesson.accateExample.board.map((c, idx) => (
                    <CardView key={`${c.rank}-${c.suit}-${idx}`} card={c} />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RivalAvatar
                  rivalId={lesson.accateExample.rivalId}
                  isTilted={lesson.accateExample.rivalId === 'nong'}
                  size={38}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                    Đối thủ: {rivalDisplay.name}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--drill-accent)' }}>
                    {rivalDisplay.styleLabel}
                  </div>
                </div>
              </div>
            </div>

            <div className="drill-feedback-card" style={{ background: 'rgba(16, 24, 21, 0.78)' }}>
              <div style={{ fontWeight: 700, color: 'var(--drill-accent)' }}>
                Các bước tính toán theo luật Accate:
              </div>
              <ol style={{ margin: '4px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lesson.accateExample.calculationStepsVi.map((step, idx) => (
                  <li key={idx} style={{ fontSize: '0.88rem' }}>
                    {step}
                  </li>
                ))}
              </ol>
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid var(--drill-border)',
                  fontWeight: 600,
                  color: 'var(--drill-good)',
                }}
              >
                💡 Ghi nhớ: {lesson.accateExample.takeawayVi}
              </div>
            </div>
          </section>

          {/* Interactive In-Lesson Mini-Check (Spec §6: Feedback trong bài) */}
          <section className="drill-feedback-card" aria-label="Câu hỏi kiểm tra nhanh trong bài">
            <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '0.98rem' }}>
              Kiểm tra nhanh trong bài
            </h3>
            <p style={{ margin: '4px 0 8px', fontWeight: 600, fontSize: '0.92rem' }}>
              {lesson.miniCheck.questionVi}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lesson.miniCheck.optionsVi.map((opt, idx) => {
                const isChosen = selectedIdx === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`drill-btn${isChosen ? ' drill-btn-active' : ''}`}
                    style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '9px 12px' }}
                    onClick={() =>
                      setSelectedAnswers((prev) => ({
                        ...prev,
                        [conceptId]: idx,
                      }))
                    }
                  >
                    <strong>{String.fromCharCode(65 + idx)}.</strong> <span>{opt}</span>
                  </button>
                );
              })}
            </div>

            {checkResult !== null ? (
              <div
                className={`drill-banner ${checkResult.isCorrect ? 'drill-banner-good' : 'drill-banner-bad'}`}
                role="status"
                style={{ marginTop: 8 }}
              >
                <div>
                  <strong>{checkResult.isCorrect ? '✓ Chính xác!' : '✗ Chưa đúng:'}</strong>{' '}
                  {checkResult.explanationVi}
                </div>
              </div>
            ) : null}
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="drill-btn drill-btn-primary"
              onClick={() => onCompleteAndPractice(conceptId)}
            >
              Đã hiểu bài — Luyện ngay khái niệm này ở Cấp 1 →
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
