import { useEffect, useMemo, useRef, useState } from 'react';
import type { DrillSceneProps, ScenePhase } from '../contract';
import { FallbackScene } from './FallbackScene';
import { getUnseenHearts, parseCard } from './outs';
import type { DrillSceneController } from './sceneController';
import './drillScene.css';

const PHASE_LABELS_VI: Record<ScenePhase, string> = {
  arrival: 'Vào bàn • 4 ghế',
  decision: 'Turn • Quyết định',
  review: 'Lời giải • Phản ứng',
};

function canCreateWebGLContext(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const probeCanvas = document.createElement('canvas');
    const ctx =
      probeCanvas.getContext('webgl2') ??
      probeCanvas.getContext('webgl') ??
      probeCanvas.getContext('experimental-webgl');
    return ctx !== null;
  } catch {
    return false;
  }
}

export function DrillScene({ phase, highlight, spot, reducedMotion }: DrillSceneProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<DrillSceneController | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  const latestPropsRef = useRef({ phase, highlight, spot, reducedMotion });
  latestPropsRef.current = { phase, highlight, spot, reducedMotion };

  // Mount Three.js controller on client; fall back cleanly to 2D illustration if WebGL is unavailable
  useEffect(() => {
    const container = stageRef.current;
    if (!container) {
      return;
    }

    if (!canCreateWebGLContext()) {
      setWebglFailed(true);
      return;
    }

    let cancelled = false;
    let controller: DrillSceneController | null = null;

    void import('./sceneController')
      .then(({ DrillSceneController: Controller }) => {
        if (cancelled) {
          return;
        }
        try {
          controller = new Controller(container, latestPropsRef.current, () => {
            if (!cancelled) {
              setWebglFailed(true);
            }
          });
          controllerRef.current = controller;
        } catch {
          if (!cancelled) {
            setWebglFailed(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWebglFailed(true);
        }
      });

    return () => {
      cancelled = true;
      if (controller) {
        controller.dispose();
      }
      controllerRef.current = null;
    };
  }, []);

  // Push reactive updates (phase camera cut/transition, spot chips/cards, highlight rings)
  useEffect(() => {
    if (controllerRef.current && !webglFailed) {
      controllerRef.current.update({ phase, highlight, spot, reducedMotion });
    }
  }, [phase, highlight, spot, reducedMotion, webglFailed]);

  const parsedBoard = useMemo(() => spot.board.map(parseCard), [spot.board]);
  const parsedHero = useMemo(() => spot.heroCards.map(parseCard), [spot.heroCards]);
  const unseenHearts = useMemo(() => getUnseenHearts(spot), [spot]);

  const totalAfterCall = spot.pot + spot.call;
  const isPotHighlighted = highlight === 'pot' || highlight === 'total';
  const isCallHighlighted = highlight === 'call' || highlight === 'total';
  const isTotalHighlighted = highlight === 'total';
  const isOutsHighlighted = highlight === 'outs';

  return (
    <section
      className="drill3d-scene"
      data-phase={phase}
      data-highlight={highlight ?? 'none'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-webgl={webglFailed ? 'fallback' : 'active'}
      aria-label="Cảnh bàn poker luyện tập 3D"
    >
      {/* 3D WebGL stage or accessible 2D SVG fallback */}
      <div className="drill3d-stage" ref={stageRef}>
        {webglFailed && <FallbackScene phase={phase} highlight={highlight} spot={spot} />}
      </div>

      {/* Scannable, accessible DOM overlay synced with Three.js scene & lesson highlights */}
      <div className="drill3d-hud">
        <div className="drill3d-hud-top">
          <div className="drill3d-status-group">
            <span className="drill3d-phase-badge" data-phase={phase}>
              <span className="drill3d-phase-dot" aria-hidden="true" />
              {PHASE_LABELS_VI[phase]}
            </span>

            <span className="drill3d-rivals-legend" aria-label="Các đối thủ tại bàn: Cá, Cáo, Nóng">
              <span className="drill3d-rival-tag">
                <span className="drill3d-rival-swatch drill3d-rival-swatch--ca" aria-hidden="true" />
                Cá
              </span>
              <span className="drill3d-rival-tag">
                <span
                  className="drill3d-rival-swatch drill3d-rival-swatch--cao"
                  aria-hidden="true"
                />
                Cáo
              </span>
              <span className="drill3d-rival-tag">
                <span
                  className="drill3d-rival-swatch drill3d-rival-swatch--nong"
                  aria-hidden="true"
                />
                Nóng
              </span>
            </span>
          </div>

          <div
            className="drill3d-metrics"
            data-highlight={highlight ?? 'none'}
            role="group"
            aria-label={`Pot ${spot.pot}, cần Call ${spot.call}${
              isTotalHighlighted ? `, tổng pot sau Call ${totalAfterCall}` : ''
            }`}
          >
            <div
              className="drill3d-metric drill3d-metric--pot"
              data-active={isPotHighlighted ? 'true' : 'false'}
            >
              <span className="drill3d-metric-label">Pot</span>
              <span className="drill3d-metric-value">{spot.pot}</span>
            </div>

            <div
              className="drill3d-metric drill3d-metric--call"
              data-active={isCallHighlighted ? 'true' : 'false'}
            >
              <span className="drill3d-metric-label">Call</span>
              <span className="drill3d-metric-value">{spot.call}</span>
            </div>

            {isTotalHighlighted && (
              <div className="drill3d-metric drill3d-metric--total" data-active="true">
                <span className="drill3d-metric-label">Tổng</span>
                <span className="drill3d-metric-value">{totalAfterCall}</span>
              </div>
            )}
          </div>
        </div>

        <div className="drill3d-hud-bottom">
          {/* Unseen heart outs preview: strictly shown ONLY when highlight === 'outs' */}
          {isOutsHighlighted && (
            <div
              className="drill3d-outs-tray"
              role="region"
              aria-label={`${unseenHearts.length} lá cơ chưa ra ở River`}
            >
              <span className="drill3d-outs-title">
                Lá ♥ chưa ra ở River ({unseenHearts.length}):
              </span>
              <ul className="drill3d-outs-list">
                {unseenHearts.map((card) => {
                  const parsed = parseCard(card);
                  return (
                    <li
                      key={card}
                      className="drill3d-out-chip"
                      aria-label={`${parsed.accessibleName} chưa ra`}
                    >
                      {card}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="drill3d-cards-dock">
            <div className="drill3d-card-group" role="group" aria-label="Bốn lá chung vòng Turn">
              <div className="drill3d-group-label">
                <span>Bài chung (Turn)</span>
                {isOutsHighlighted && <span className="drill3d-draw-note">Đang có 4 lá ♥</span>}
              </div>
              <ul className="drill3d-card-row">
                {parsedBoard.map((card, idx) => {
                  const heartGlow = isOutsHighlighted && card.isHeart;
                  return (
                    <li
                      key={`${card.raw}-${idx}`}
                      className={[
                        'drill3d-card',
                        card.isRed ? 'drill3d-card--red' : '',
                        heartGlow ? 'drill3d-card--heart-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={card.accessibleName}
                    >
                      <span className="drill3d-card-rank">{card.rank}</span>
                      <span className="drill3d-card-suit" aria-hidden="true">
                        {card.suit}
                      </span>
                    </li>
                  );
                })}
                <li
                  className="drill3d-card drill3d-card--river-slot"
                  data-outs={isOutsHighlighted ? 'true' : 'false'}
                  aria-label="Lá River chưa chia"
                >
                  <span className="drill3d-river-q">?</span>
                  <span className="drill3d-river-sub">River</span>
                </li>
              </ul>
            </div>

            <div
              className="drill3d-card-group drill3d-card-group--hero"
              role="group"
              aria-label="Bài Hero"
            >
              <div className="drill3d-group-label">
                <span>Bài Hero</span>
              </div>
              <ul className="drill3d-card-row">
                {parsedHero.map((card, idx) => {
                  const heartGlow = isOutsHighlighted && card.isHeart;
                  return (
                    <li
                      key={`${card.raw}-${idx}`}
                      className={[
                        'drill3d-card',
                        'drill3d-card--hero',
                        card.isRed ? 'drill3d-card--red' : '',
                        heartGlow ? 'drill3d-card--heart-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={card.accessibleName}
                    >
                      <span className="drill3d-card-rank">{card.rank}</span>
                      <span className="drill3d-card-suit" aria-hidden="true">
                        {card.suit}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
