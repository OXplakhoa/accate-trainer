import { useEffect, useRef, useState } from 'react';
import {
  DEMO_SPOTS,
  type DemoSpot,
  type DrillLessonProps,
  type LessonHighlight,
} from '../contract';
import {
  cardsUnseen,
  correctAction,
  DURATION_MS,
  exactPercent,
  requiredPercent,
  secondsRemaining,
  type Action,
  type Level,
  type Outcome,
} from './model';
import './lesson.css';

const percent = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

type Question = {
  title: string;
  options: string[];
  answer: string;
  why: string;
  highlight: LessonHighlight;
};

function questions(spot: DemoSpot): Question[] {
  const required = percent(requiredPercent(spot));
  return [
    {
      title: 'Có bao nhiêu outs?',
      options: ['7', '9', '11'],
      answer: String(spot.outs),
      why: 'Có 13 lá cơ trong bộ bài; đã thấy 4 lá cơ, còn 9 lá cơ giúp hoàn thành thùng.',
      highlight: 'outs',
    },
    {
      title: 'Nhẩm xác suất trúng ở River?',
      options: ['≈ 9%', '≈ 18%', '≈ 36%'],
      answer: '≈ 18%',
      why: 'Chỉ còn một lá để xem: lấy 9 outs × 2 ≈ 18%.',
      highlight: 'outs',
    },
    {
      title: 'Cần thắng bao nhiêu % để hòa vốn?',
      options: ['20%', '25%', '33,3%'],
      answer: `${required}%`,
      why: `Lấy Call ${spot.call} chia cho pot sau Call ${spot.pot + spot.call}: ${spot.call}/${spot.pot + spot.call} = ${required}%. Mẫu số là toàn bộ pot ta có thể thắng sau khi bỏ thêm tiền.`,
      highlight: 'total',
    },
    {
      title: 'Trong mô hình này, chọn gì?',
      options: ['Call', 'Fold'],
      answer: correctAction(spot),
      why:
        spot.id === 'clear'
          ? 'Bạn nhẩm khoảng 18%, nhưng cần 25% để hòa vốn. Cơ hội thấp hơn giá Call, nên Fold.'
          : '9/46 ≈ 19,6% vẫn thấp hơn 20%, nên Fold. Đừng làm tròn lên qua ngưỡng.',
      highlight: 'call',
    },
  ];
}

interface LessonSessionProps extends DrillLessonProps {
  readonly level: Level;
  readonly onLevelChange: (level: Level) => void;
}

function LessonSession({
  spot,
  onSpotChange,
  onPhaseChange,
  onHighlightChange,
  level,
  onLevelChange,
}: LessonSessionProps) {
  const [step, setStep] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [remaining, setRemaining] = useState(20);
  const deadline = useRef<number | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const sceneCallbacks = useRef({ onPhaseChange, onHighlightChange });
  useEffect(() => {
    sceneCallbacks.current = { onPhaseChange, onHighlightChange };
  }, [onPhaseChange, onHighlightChange]);
  const finished = outcome !== null;

  useEffect(() => {
    sceneCallbacks.current.onPhaseChange(finished ? 'review' : 'decision');
    sceneCallbacks.current.onHighlightChange(null);
  }, [finished, level, spot.id]);

  useEffect(() => {
    if (level !== 3 || finished) return;
    const end = Date.now() + DURATION_MS;
    deadline.current = end;
    setRemaining(20);
    const tick = () => {
      if (deadline.current !== end) return;
      const seconds = secondsRemaining(end, Date.now());
      setRemaining(seconds);
      if (seconds === 0) {
        deadline.current = null;
        setOutcome('expired');
      }
    };
    const timer = window.setInterval(tick, 200);
    return () => {
      window.clearInterval(timer);
      deadline.current = null;
    };
  }, [level, finished, spot.id, sessionId]);

  function reset(nextLevel: Level) {
    deadline.current = null;
    onLevelChange(nextLevel);
    setStep(0);
    setFeedback(null);
    setOutcome(null);
    setShowExplanation(false);
    setRemaining(20);
    onHighlightChange(null);
    onPhaseChange('decision');
    // Restart the timed session even when the selected level is already active.
    setSessionId((id) => id + 1);
  }

  function chooseAction(action: Action) {
    if (deadline.current === null) return;
    const now = Date.now();
    const expired = now >= deadline.current;
    setRemaining(secondsRemaining(deadline.current, now));
    deadline.current = null;
    setOutcome(expired ? 'expired' : action);
  }

  const question = questions(spot)[step]!;
  return (
    <section className="drill-lesson" aria-label="Bài tập quyết định poker">
      <header className="dl-header">
        <h2>Nhẩm và chọn action</h2>
      </header>
      <div className="dl-selectors">
        <div>
          <span className="dl-label">CHỌN CẤP</span>
          <div className="dl-segment" role="group" aria-label="Chọn cấp độ">
            <button type="button" aria-pressed={level === 1} onClick={() => reset(1)}>
              Cấp 1 <span>Từng bước</span>
            </button>
            <button type="button" aria-pressed={level === 3} onClick={() => reset(3)}>
              Cấp 3 <span>Thử tốc độ</span>
            </button>
          </div>
        </div>
        <div>
          <span className="dl-label">TÌNH HUỐNG</span>
          <div className="dl-segment" role="group" aria-label="Chọn tình huống">
            {DEMO_SPOTS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={spot.id === item.id}
                onClick={() => {
                  if (spot.id !== item.id) {
                    deadline.current = null;
                    onHighlightChange(null);
                    onPhaseChange('decision');
                    onSpotChange(item);
                  }
                }}
              >
                {item.id === 'clear' ? 'Cơ bản' : 'Sát ngưỡng'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="dl-assumption">
        Tình huống học tập: bạn đang thua; mỗi lá cơ còn lại đều thắng, không xét blocker. Không trả
        thêm để xem River; lá đối thủ chưa lật.
      </div>
      {!finished && level === 1 && (
        <div className="dl-card">
          <div className="dl-card-top">
            <span className="dl-eyebrow">CẤP 1 · TỪNG BƯỚC</span>
            <span className="dl-count">{step + 1} / 4</span>
          </div>
          <div className="dl-progress" aria-hidden="true">
            <span style={{ width: `${(step + 1) * 25}%` }} />
          </div>
          <h3>{question.title}</h3>
          <p className="dl-subtitle">Chọn một câu trả lời để tiếp tục.</p>
          <div className="dl-options">
            {question.options.map((option) => (
              <button
                type="button"
                key={option}
                disabled={feedback === 'correct'}
                onClick={() => {
                  const right = option === question.answer;
                  setFeedback(right ? 'correct' : 'wrong');
                  onHighlightChange(question.highlight);
                }}
              >
                {option}
              </button>
            ))}
          </div>
          {feedback && (
            <div className={`dl-feedback ${feedback}`} role="status">
              <strong>{feedback === 'correct' ? 'Chính xác!' : 'Chưa đúng — thử lại nhé.'}</strong>
              <p>{question.why}</p>
            </div>
          )}
          {feedback === 'correct' && (
            <button
              className="dl-primary"
              type="button"
              onClick={() => {
                onHighlightChange(null);
                if (step === 3) setOutcome(correctAction(spot));
                else {
                  setStep(step + 1);
                  setFeedback(null);
                }
              }}
            >
              {step === 3 ? 'Hoàn thành' : 'Bước tiếp theo'} <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
      {!finished && level === 3 && (
        <div className="dl-card">
          <div className="dl-card-top">
            <span className="dl-eyebrow">CẤP 3 · THỬ TỐC ĐỘ</span>
            <span className="dl-timer" role="timer" aria-label={`Còn ${remaining} giây`}>
              {String(remaining).padStart(2, '0')}
              <small> giây</small>
            </span>
          </div>
          <h3>Bạn quyết định thế nào?</h3>
          <p className="dl-subtitle">
            Pot {spot.pot} · Call {spot.call}. Chọn trước khi hết giờ.
          </p>
          <div className="dl-actions">
            <button type="button" onClick={() => chooseAction('Fold')}>
              Fold
            </button>
            <button type="button" className="dl-primary" onClick={() => chooseAction('Call')}>
              Call
            </button>
          </div>
        </div>
      )}
      {finished && (
        <div className="dl-card dl-result" aria-live="polite">
          <span className="dl-eyebrow">HOÀN THÀNH TÌNH HUỐNG</span>
          <h3>
            {outcome === 'expired'
              ? 'Đã hết giờ'
              : level === 1
                ? 'Bạn đã hoàn thành!'
                : outcome === correctAction(spot)
                  ? 'Quyết định chính xác!'
                  : 'Cùng xem lại nhé.'}
          </h3>
          <p>
            {outcome === 'expired'
              ? 'Bạn chưa chọn Call hay Fold.'
              : level === 3
                ? `Bạn đã chọn ${outcome}.`
                : 'Bạn đã đi qua cả bốn bước.'}{' '}
            Đáp án trong mô hình: <strong>{correctAction(spot)}</strong>.
          </p>
          <button
            className="dl-primary"
            type="button"
            onClick={() => {
              if (showExplanation) onHighlightChange(null);
              setShowExplanation(!showExplanation);
            }}
            aria-expanded={showExplanation}
          >
            {showExplanation ? 'Ẩn lời giải' : 'Xem lời giải ngắn'}{' '}
            <span aria-hidden="true">{showExplanation ? '↑' : '→'}</span>
          </button>
          {showExplanation && (
            <div className="dl-explanation">
              <p className="dl-hint">Bấm từng dòng để xem trên bàn.</p>
              <button type="button" onClick={() => onHighlightChange('outs')}>
                <b>01</b>
                <span>9 outs · 9 × 2 ≈ 18% trúng ở River.</span>
              </button>
              <button type="button" onClick={() => onHighlightChange('pot')}>
                <b>02</b>
                <span>Pot hiện tại {spot.pot}, đã gồm cược của đối thủ.</span>
              </button>
              <button type="button" onClick={() => onHighlightChange('call')}>
                <b>03</b>
                <span>Call thêm {spot.call} để xem một lá.</span>
              </button>
              <button type="button" onClick={() => onHighlightChange('total')}>
                <b>04</b>
                <span>
                  Pot sau Call {spot.pot + spot.call}: cần {spot.call}/{spot.pot + spot.call} ={' '}
                  {percent(requiredPercent(spot))}%.{' '}
                  {spot.id === 'close' ? '9/46 ≈ 19,6% vẫn dưới 20%.' : '≈ 18% thấp hơn mức cần.'}{' '}
                  Chọn {correctAction(spot)}.
                </span>
              </button>
              <details>
                <summary>Đọc sâu: xác suất chính xác &amp; hòa vốn</summary>
                <div className="dl-deep">
                  <p>
                    Đã thấy 6 lá (2 lá trên tay và 4 lá chung), còn {cardsUnseen} lá chưa thấy. Xác
                    suất lá River là một trong {spot.outs} lá cơ: {spot.outs}/{cardsUnseen} ≈{' '}
                    {percent(exactPercent(spot))}%. Đây là xác suất trúng lá cơ, không phải equity
                    showdown chính xác: đối thủ chưa lật bài và kết quả thực tế có thể khác giả
                    định.
                  </p>
                  <p>
                    Trong mô hình một lá, nếu Call và thắng thì lời {spot.pot}; nếu thua thì mất{' '}
                    {spot.call}. Do đó cần thắng {spot.call}/({spot.pot} + {spot.call}) ={' '}
                    {percent(requiredPercent(spot))}% để hòa vốn.{' '}
                    {spot.id === 'clear'
                      ? 'Ví dụ: một lần thắng +150 và ba lần thua −50 cân bằng nhau.'
                      : 'Ở đây một lần thắng +160 và bốn lần thua −40 cân bằng nhau.'}
                  </p>
                  <p>
                    Quy tắc nhân 2 là ước lượng cho một lá. Quy tắc nhân 4 chỉ phù hợp để ước lượng
                    khi chắc chắn được xem cả hai lá tiếp theo với giá đang xét, chẳng hạn all-in ở
                    Flop; nó không áp dụng cho quyết định Turn chỉ còn River này.
                  </p>
                  <p>Nguồn tham khảo: Hopkins Lecture 2 và 7.</p>
                </div>
              </details>
            </div>
          )}
          <button className="dl-reset" type="button" onClick={() => reset(level)}>
            Làm lại tình huống ↻
          </button>
        </div>
      )}
    </section>
  );
}

export function DrillLesson(props: DrillLessonProps) {
  const [level, setLevel] = useState<Level>(1);
  return <LessonSession key={props.spot.id} {...props} level={level} onLevelChange={setLevel} />;
}
