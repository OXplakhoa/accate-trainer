import type { LessonHighlight, ScenePhase, SceneRival, SceneTableSnapshot } from '../contract';
import { buildChipStacksForAmount, getUnseenHearts, parseCard } from './outs';
import {
  getEffectiveHighlight,
  getLiveStreetLabel,
  getOccupiedRivals,
  isLiveSnapshot,
  isRivalCardsVisible,
  RIVAL_LABELS_VI,
  shouldShowOuts,
  shouldShowRiverPlaceholder,
} from './snapshot';

interface FallbackSceneProps {
  readonly phase: ScenePhase;
  readonly highlight: LessonHighlight;
  readonly spot: SceneTableSnapshot;
}

const SVG_BOARD_XS: readonly number[] = [0, 44, 88, 132, 182];

export function FallbackScene({ phase, highlight, spot }: FallbackSceneProps) {
  const isLive = isLiveSnapshot(spot);
  const effectiveHighlight = getEffectiveHighlight(spot, highlight);
  const showOuts = shouldShowOuts(spot, highlight);
  const showRiverPlaceholder = shouldShowRiverPlaceholder(spot);
  const unseenHearts = showOuts ? getUnseenHearts(spot) : [];

  const isReview = !isLive && phase === 'review';
  const isDecision = !isLive && phase === 'decision';

  const occupiedList = getOccupiedRivals(spot);
  const occupied = new Set<SceneRival>(occupiedList);
  const activeRival = spot.live?.activeRival ?? null;

  // Subtle lean-in offsets toward the table center when a rival is active in Live mode
  const caLeanX = isLive && activeRival === 'ca' ? 6 : 0;
  const caLeanY = isLive && activeRival === 'ca' ? 7 : 0;
  const caoLeanY = isLive && activeRival === 'cao' ? 8 : 0;
  const nongLeanX = isLive && activeRival === 'nong' ? -6 : 0;
  const nongLeanY = isLive && activeRival === 'nong' ? 7 : 0;

  // Neutral gaze shift toward the active player in Live mode (no inferred tells)
  const caPupilDx = isLive
    ? activeRival === 'cao' || activeRival === 'nong'
      ? 2.2
      : activeRival === null && spot.live?.activePlayerName
        ? -1.2
        : 0.6
    : isDecision
      ? 1
      : 0;
  const caoPupilDx = isLive
    ? activeRival === 'ca'
      ? -2.2
      : activeRival === 'nong'
        ? 2.2
        : 0
    : 0;
  const nongPupilDx = isLive
    ? activeRival === 'ca' || activeRival === 'cao'
      ? -2.2
      : activeRival === null && spot.live?.activePlayerName
        ? 1.2
        : -0.6
    : 0;

  const potChipStacks = isLive ? buildChipStacksForAmount(spot.pot).slice(0, 3) : [];
  const callChipStacks = isLive ? buildChipStacksForAmount(spot.call).slice(0, 2) : [];

  // Distinct framing per phase even in 2D illustration fallback
  const viewBox =
    phase === 'arrival'
      ? '0 0 640 420'
      : phase === 'decision'
        ? '24 18 592 384'
        : '40 8 560 364';

  const occupiedNames = occupiedList.map((r) => RIVAL_LABELS_VI[r]).join(', ');
  const fallbackAriaLabel = isLive
    ? `Minh họa bàn poker Sandbox gồm Hero${occupiedNames ? `, ${occupiedNames}` : ''}, vòng ${getLiveStreetLabel(spot.live?.street ?? null)}, pot ${spot.pot}, cần Call ${spot.call}`
    : 'Minh họa bàn poker 4 ghế gồm Hero, Cá, Cáo và Nóng';

  return (
    <div className="drill3d-fallback" role="img" aria-label={fallbackAriaLabel}>
      <svg
        className="drill3d-fallback-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="drill3d-felt-grad" cx="50%" cy="46%" r="58%">
            <stop offset="0%" stopColor="#3E8B7E" />
            <stop offset="70%" stopColor="#34786D" />
            <stop offset="100%" stopColor="#285F56" />
          </radialGradient>
          <linearGradient id="drill3d-wall-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#F7EFE0" />
            <stop offset="68%" stopColor="#F3E8D4" />
            <stop offset="100%" stopColor="#E1CEB1" />
          </linearGradient>
        </defs>

        {/* Warm cream room backdrop + wainscoting */}
        <rect x="0" y="0" width="640" height="420" fill="url(#drill3d-wall-grad)" />
        <rect x="0" y="212" width="640" height="208" fill="#DFCCB0" opacity="0.55" />
        <rect x="0" y="208" width="640" height="6" fill="#C9B292" />

        {/* Subtle framed wall prints */}
        <g opacity="0.5">
          <rect
            x="92"
            y="34"
            width="46"
            height="58"
            rx="4"
            fill="#FAF4E8"
            stroke="#533C31"
            strokeWidth="3"
          />
          <text x="115" y="71" textAnchor="middle" fontSize="24" fill="#3E5768">
            ♠
          </text>
          <rect
            x="297"
            y="26"
            width="46"
            height="58"
            rx="4"
            fill="#FAF4E8"
            stroke="#533C31"
            strokeWidth="3"
          />
          <text x="320" y="63" textAnchor="middle" fontSize="24" fill="#C95849">
            ♥
          </text>
          <rect
            x="502"
            y="34"
            width="46"
            height="58"
            rx="4"
            fill="#FAF4E8"
            stroke="#533C31"
            strokeWidth="3"
          />
          <text x="525" y="71" textAnchor="middle" fontSize="24" fill="#D18244">
            ♦
          </text>
        </g>

        {/* --- OCCUPIED RIVAL CHARACTERS AROUND THE OVAL TABLE --- */}

        {/* CÁ (Left-far — #4F9DD3 blue fish humanoid) */}
        {occupied.has('ca') && (
          <g transform={`translate(${132 + caLeanX}, ${134 + caLeanY})`}>
            {/* Maritime vest torso */}
            <path d="M-34 54 C-34 22 34 22 34 54 L38 78 L-38 78 Z" fill="#2F5069" />
            <path d="M-12 28 L0 48 L12 28 Z" fill="#F1E8D8" />
            {/* Dorsal crest fin */}
            <path d="M-6 -32 Q4 -56 22 -38 Q18 -24 6 -22 Z" fill="#3276AB" />
            {/* Side cheek fins */}
            <path d="M-26 -8 Q-44 -16 -42 -2 Q-36 8 -24 4 Z" fill="#3276AB" />
            <path d="M26 -8 Q44 -16 42 -2 Q36 8 24 4 Z" fill="#3276AB" />
            {/* Fish head */}
            <ellipse cx="0" cy="-4" rx="28" ry="26" fill="#4F9DD3" />
            <ellipse cx="0" cy="8" rx="22" ry="13" fill="#A9D2EB" />
            {/* Round eyes */}
            <circle cx="-11" cy="-9" r="8" fill="#FAF5EB" stroke="#3276AB" strokeWidth="2" />
            <circle cx="11" cy="-9" r="8" fill="#FAF5EB" stroke="#3276AB" strokeWidth="2" />
            <circle cx={-10 + caPupilDx} cy={isReview ? -10 : -8} r="3.8" fill="#261F1C" />
            <circle cx={12 + caPupilDx} cy={isReview ? -10 : -8} r="3.8" fill="#261F1C" />
            {/* Fish lips */}
            <ellipse
              cx="0"
              cy="9"
              rx="8"
              ry={isReview ? 6 : 4.5}
              fill="#D98A7C"
              stroke="#B66A5D"
              strokeWidth="1.5"
            />
            <ellipse cx="0" cy="9" rx="4" ry={isReview ? 3.2 : 2} fill="#261F1C" />
          </g>
        )}

        {/* CÁO (Center-far — #E18A46 orange fox humanoid) */}
        {occupied.has('cao') && (
          <g transform={`translate(320, ${108 + caoLeanY})`}>
            {/* Olive waistcoat torso + maroon tie */}
            <path d="M-36 52 C-36 20 36 20 36 52 L40 76 L-40 76 Z" fill="#495E4C" />
            <path d="M-12 24 L0 46 L12 24 Z" fill="#F7ECDB" />
            <path d="M-4 30 L4 30 L6 48 L0 54 L-6 48 Z" fill="#8F3D32" />
            {/* Tall pointed fox ears with charcoal tips */}
            <path d="M-24 -14 L-30 -52 L-6 -26 Z" fill="#E18A46" />
            <path d="M-24 -38 L-30 -52 L-17 -39 Z" fill="#3A2A23" />
            <path d="M-21 -19 L-25 -39 L-11 -25 Z" fill="#F0C7A2" />
            <path d="M24 -14 L30 -52 L6 -26 Z" fill="#E18A46" />
            <path d="M24 -38 L30 -52 L17 -39 Z" fill="#3A2A23" />
            <path d="M21 -19 L25 -39 L11 -25 Z" fill="#F0C7A2" />
            {/* Fox head + cream cheek ruffs + muzzle */}
            <ellipse cx="0" cy="-6" rx="28" ry="23" fill="#E18A46" />
            <path
              d="M-32 2 Q-18 -4 -6 6 L0 16 L6 6 Q18 -4 32 2 Q22 18 0 18 Q-22 18 -32 2 Z"
              fill="#F7ECDB"
            />
            {/* Sly eyes & brows */}
            <ellipse cx="-11" cy="-8" rx="6" ry="4" fill="#FAF5EB" />
            <ellipse cx="11" cy="-8" rx="6" ry="4" fill="#FAF5EB" />
            <circle cx={-10 + caoPupilDx} cy="-8" r="2.6" fill="#261F1C" />
            <circle cx={10 + caoPupilDx} cy="-8" r="2.6" fill="#261F1C" />
            <path
              d={isReview ? 'M-18 -16 Q-11 -21 -4 -15' : 'M-18 -14 L-4 -12'}
              stroke="#A85921"
              strokeWidth="2.8"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={isReview ? 'M18 -16 Q11 -21 4 -15' : 'M18 -14 L4 -12'}
              stroke="#A85921"
              strokeWidth="2.8"
              strokeLinecap="round"
              fill="none"
            />
            {/* Button nose */}
            <ellipse cx="0" cy="8" rx="5.5" ry="4" fill="#3A2A23" />
          </g>
        )}

        {/* NÓNG (Right-far — #C95849 brick-red kettle-headed humanoid) */}
        {occupied.has('nong') && (
          <g transform={`translate(${508 + nongLeanX}, ${134 + nongLeanY})`}>
            {/* Work vest over ochre sweater */}
            <path d="M-35 54 C-35 22 35 22 35 54 L39 78 L-39 78 Z" fill="#3F3938" />
            <path d="M-14 28 L0 46 L14 28 Z" fill="#C79045" />
            {/* Overhead arched kettle handle + cocoa grip */}
            <path
              d="M-22 -24 C-26 -54 26 -54 22 -24"
              fill="none"
              stroke="#C19654"
              strokeWidth="4.5"
            />
            <rect x="-13" y="-49" width="26" height="9" rx="4.5" fill="#4B3328" />
            {/* Pouring spout on outer-right silhouette */}
            <path
              d="M24 2 Q42 -2 46 -22"
              fill="none"
              stroke="#C95849"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <circle cx="46" cy="-22" r="4.5" fill="#C19654" />
            {/* Steam puffs */}
            <g fill="#FBF6EC" opacity={isReview ? 0.96 : 0.78}>
              <circle cx="52" cy="-31" r={isReview ? 6 : 4.5} />
              <circle cx="59" cy="-41" r={isReview ? 8.5 : 6} />
              <circle cx="50" cy="-47" r={isReview ? 6.5 : 4.5} />
            </g>
            {/* Turned kettle body */}
            <path
              d="M-24 18 C-34 6 -30 -24 -18 -29 L18 -29 C30 -24 34 6 24 18 Z"
              fill="#C95849"
            />
            {/* Cream belly enamel stripe */}
            <path d="M-28 5 Q0 10 28 5 L27 11 Q0 16 -27 11 Z" fill="#EEE1CA" />
            {/* Kettle lid + knob (tilts up on review) */}
            <g
              transform={
                isReview ? 'translate(-16, -29) rotate(-14) translate(16, 29)' : undefined
              }
            >
              <path d="M-19 -29 Q0 -40 19 -29 Z" fill="#A33F32" />
              <circle cx="0" cy="-40" r="5" fill="#4B3328" />
            </g>
            {/* Expressive kettle eyes & brows */}
            <circle cx="-10" cy="-10" r="5.5" fill="#FAF5EB" />
            <circle cx="10" cy="-10" r="5.5" fill="#FAF5EB" />
            <circle cx={-10 + nongPupilDx} cy="-10" r="2.7" fill="#261F1C" />
            <circle cx={10 + nongPupilDx} cy="-10" r="2.7" fill="#261F1C" />
            <path
              d={isReview ? 'M-17 -19 L-4 -18' : 'M-17 -19 L-4 -14'}
              stroke="#261F1C"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            <path
              d={isReview ? 'M17 -19 L4 -18' : 'M17 -19 L4 -14'}
              stroke="#261F1C"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            <path
              d="M-7 1 Q0 -2 7 1"
              stroke="#261F1C"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* --- REAL OVAL POKER TABLE (#533C31 cocoa rail + #34786D lake-teal felt) --- */}
        <ellipse cx="320" cy="272" rx="284" ry="118" fill="#422E25" />
        <ellipse cx="320" cy="264" rx="280" ry="114" fill="#533C31" />
        <ellipse cx="320" cy="264" rx="250" ry="92" fill="url(#drill3d-felt-grad)" />
        <ellipse
          cx="320"
          cy="264"
          rx="202"
          ry="68"
          fill="none"
          stroke="#F3E8D4"
          strokeWidth="1.5"
          opacity="0.32"
        />

        {/* Active rival turn halo on the felt (live mode only) */}
        {isLive && activeRival === 'ca' && occupied.has('ca') && (
          <ellipse
            cx="154"
            cy="228"
            rx="30"
            ry="16"
            fill="rgba(240, 190, 82, 0.24)"
            stroke="#F0BE52"
            strokeWidth="2.6"
          />
        )}
        {isLive && activeRival === 'cao' && occupied.has('cao') && (
          <ellipse
            cx="320"
            cy="195"
            rx="32"
            ry="15"
            fill="rgba(240, 190, 82, 0.24)"
            stroke="#F0BE52"
            strokeWidth="2.6"
          />
        )}
        {isLive && activeRival === 'nong' && occupied.has('nong') && (
          <ellipse
            cx="486"
            cy="228"
            rx="30"
            ry="16"
            fill="rgba(240, 190, 82, 0.24)"
            stroke="#F0BE52"
            strokeWidth="2.6"
          />
        )}

        {/* Face-down rival hole cards (strictly unflipped; hidden when unoccupied or between hands) */}
        <g fill="#7C3E35" stroke="#F7EFE0" strokeWidth="2">
          {isRivalCardsVisible(spot, 'ca') && (
            <>
              <rect
                x="138"
                y="214"
                width="18"
                height="25"
                rx="3"
                transform="rotate(18 147 226)"
              />
              <rect
                x="152"
                y="218"
                width="18"
                height="25"
                rx="3"
                transform="rotate(28 161 230)"
              />
            </>
          )}

          {isRivalCardsVisible(spot, 'cao') && (
            <>
              <rect
                x="302"
                y="182"
                width="18"
                height="25"
                rx="3"
                transform="rotate(-7 311 194)"
              />
              <rect
                x="320"
                y="182"
                width="18"
                height="25"
                rx="3"
                transform="rotate(7 329 194)"
              />
            </>
          )}

          {isRivalCardsVisible(spot, 'nong') && (
            <>
              <rect
                x="470"
                y="218"
                width="18"
                height="25"
                rx="3"
                transform="rotate(-28 479 230)"
              />
              <rect
                x="484"
                y="214"
                width="18"
                height="25"
                rx="3"
                transform="rotate(-18 493 226)"
              />
            </>
          )}
        </g>

        {/* Synced table felt highlight rings */}
        {effectiveHighlight === 'total' && (
          <ellipse
            cx="332"
            cy="300"
            rx="102"
            ry="34"
            fill="rgba(245, 203, 98, 0.22)"
            stroke="#F5CB62"
            strokeWidth="3.5"
          />
        )}
        {(effectiveHighlight === 'pot' || effectiveHighlight === 'total') && spot.pot > 0 && (
          <ellipse
            cx="288"
            cy="294"
            rx="46"
            ry="20"
            fill="rgba(240, 190, 82, 0.24)"
            stroke="#F0BE52"
            strokeWidth="3"
          />
        )}
        {(effectiveHighlight === 'call' || effectiveHighlight === 'total') && spot.call > 0 && (
          <ellipse
            cx="392"
            cy="308"
            rx="34"
            ry="16"
            fill="rgba(228, 116, 82, 0.26)"
            stroke="#E47452"
            strokeWidth="3"
          />
        )}

        {/* Community cards (0-5; index 4 occupies exact River slot x = 182) + optional River ? slot */}
        <g transform="translate(204, 224)">
          {spot.board.slice(0, 5).map((cardStr, idx) => {
            const parsed = parseCard(cardStr);
            const isHeartHighlight = showOuts && parsed.isHeart;
            const x = SVG_BOARD_XS[idx] ?? idx * 44;
            return (
              <g key={`${cardStr}-${idx}`} transform={`translate(${x}, 0)`}>
                <rect
                  x="0"
                  y="0"
                  width="36"
                  height="50"
                  rx="4.5"
                  fill="#FBF6EC"
                  stroke={isHeartHighlight ? '#E25C67' : '#D5C6AE'}
                  strokeWidth={isHeartHighlight ? '3' : '1.6'}
                />
                <text
                  x="18"
                  y="22"
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="800"
                  fill={parsed.isRed ? '#C73B3A' : '#24292E'}
                >
                  {parsed.rank}
                </text>
                <text
                  x="18"
                  y="40"
                  textAnchor="middle"
                  fontSize="16"
                  fill={parsed.isRed ? '#C73B3A' : '#24292E'}
                >
                  {parsed.suit}
                </text>
              </g>
            );
          })}

          {/* Open River slot (never shown when board index 4 is present; never shown preflop/flop/idle in live mode) */}
          {showRiverPlaceholder && (
            <g transform="translate(182, 0)">
              <rect
                x="0"
                y="0"
                width="36"
                height="50"
                rx="4.5"
                fill={showOuts ? 'rgba(226, 92, 103, 0.22)' : 'rgba(243, 232, 212, 0.1)'}
                stroke={showOuts ? '#E25C67' : 'rgba(243, 232, 212, 0.65)'}
                strokeWidth={showOuts ? '2.8' : '1.8'}
                strokeDasharray="5 4"
              />
              <text
                x="18"
                y="30"
                textAnchor="middle"
                fontSize="18"
                fontWeight="800"
                fill={showOuts ? '#FFF1F2' : '#F3E8D4'}
              >
                ?
              </text>
              {/* Ghostly unseen heart indicator hovering above River ONLY in Drill mode when highlight === 'outs' */}
              {showOuts && (
                <g transform="translate(18, -14)">
                  <rect
                    x="-36"
                    y="-14"
                    width="72"
                    height="22"
                    rx="11"
                    fill="#FFF5F3"
                    stroke="#E25C67"
                    strokeWidth="1.8"
                    strokeDasharray="3 2"
                  />
                  <text
                    x="0"
                    y="1"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="800"
                    fill="#B7323C"
                  >
                    {unseenHearts.length} ♥ chưa ra
                  </text>
                </g>
              )}
            </g>
          )}
        </g>

        {/* Pot & Call chip stacks */}
        {isLive ? (
          <>
            {potChipStacks.length > 0 && (
              <g transform="translate(288, 294)">
                {potChipStacks.map((stack, stackIdx) => {
                  const cx = (stackIdx - (potChipStacks.length - 1) / 2) * 18;
                  const visibleChips = Math.min(4, Math.max(1, stack.count));
                  return (
                    <g key={`pot-${stack.denom.value}-${stackIdx}`}>
                      {Array.from({ length: visibleChips }).map((_, chipIdx) => (
                        <ellipse
                          key={chipIdx}
                          cx={cx}
                          cy={4 - chipIdx * 3.5}
                          rx="10"
                          ry="5"
                          fill={stack.denom.bodyHex}
                          stroke={stack.denom.stripeHex}
                          strokeWidth="1.5"
                        />
                      ))}
                    </g>
                  );
                })}
              </g>
            )}

            {callChipStacks.length > 0 && (
              <g transform="translate(392, 308)">
                {callChipStacks.map((stack, stackIdx) => {
                  const cx = (stackIdx - (callChipStacks.length - 1) / 2) * 16;
                  const visibleChips = Math.min(3, Math.max(1, stack.count));
                  return (
                    <g key={`call-${stack.denom.value}-${stackIdx}`}>
                      {Array.from({ length: visibleChips }).map((_, chipIdx) => (
                        <ellipse
                          key={chipIdx}
                          cx={cx}
                          cy={3 - chipIdx * 3.5}
                          rx="9.5"
                          ry="4.8"
                          fill={stack.denom.bodyHex}
                          stroke={stack.denom.stripeHex}
                          strokeWidth="1.4"
                        />
                      ))}
                    </g>
                  );
                })}
              </g>
            )}
          </>
        ) : (
          <>
            <g transform="translate(288, 294)">
              <ellipse
                cx="-14"
                cy="4"
                rx="10"
                ry="5"
                fill="#2E6A5E"
                stroke="#F3E8D4"
                strokeWidth="1.5"
              />
              <ellipse
                cx="-14"
                cy="0"
                rx="10"
                ry="5"
                fill="#2E6A5E"
                stroke="#F3E8D4"
                strokeWidth="1.5"
              />
              <ellipse
                cx="4"
                cy="6"
                rx="10"
                ry="5"
                fill="#C95849"
                stroke="#F5EAD8"
                strokeWidth="1.5"
              />
              <ellipse
                cx="4"
                cy="2"
                rx="10"
                ry="5"
                fill="#C95849"
                stroke="#F5EAD8"
                strokeWidth="1.5"
              />
              <ellipse
                cx="4"
                cy="-2"
                rx="10"
                ry="5"
                fill="#C95849"
                stroke="#F5EAD8"
                strokeWidth="1.5"
              />
              <ellipse
                cx="20"
                cy="4"
                rx="10"
                ry="5"
                fill="#4F9DD3"
                stroke="#F7EFE2"
                strokeWidth="1.5"
              />
              <ellipse
                cx="20"
                cy="0"
                rx="10"
                ry="5"
                fill="#4F9DD3"
                stroke="#F7EFE2"
                strokeWidth="1.5"
              />
            </g>

            <g transform="translate(392, 308)">
              <ellipse
                cx="-6"
                cy="3"
                rx="9.5"
                ry="4.8"
                fill="#D89A46"
                stroke="#533C31"
                strokeWidth="1.4"
              />
              <ellipse
                cx="-6"
                cy="-1"
                rx="9.5"
                ry="4.8"
                fill="#D89A46"
                stroke="#533C31"
                strokeWidth="1.4"
              />
              <ellipse
                cx="8"
                cy="2"
                rx="9.5"
                ry="4.8"
                fill="#C95849"
                stroke="#F5EAD8"
                strokeWidth="1.4"
              />
              <ellipse
                cx="8"
                cy="-2"
                rx="9.5"
                ry="4.8"
                fill="#C95849"
                stroke="#F5EAD8"
                strokeWidth="1.4"
              />
            </g>
          </>
        )}
      </svg>

      <div className="drill3d-fallback-note" role="note">
        Minh họa bàn 2D (WebGL không khả dụng)
      </div>
    </div>
  );
}
