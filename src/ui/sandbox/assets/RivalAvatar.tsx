import type { RivalId } from '../../../engine';

export interface RivalAvatarProps {
  readonly rivalId: RivalId | null;
  readonly isTilted?: boolean;
  readonly size?: number;
  readonly className?: string;
}

const AVATAR_BG: Readonly<Record<RivalId | 'hero', { readonly bg: string; readonly ring: string }>> =
  Object.freeze({
    hero: { bg: '#215442', ring: '#edc28d' },
    da: { bg: '#3e4a47', ring: '#9cb0aa' },
    ca: { bg: '#1f5368', ring: '#6dc4e0' },
    cao: { bg: '#7a4520', ring: '#f0a65d' },
    soi: { bg: '#3b3c4f', ring: '#b8b9d9' },
    dien: { bg: '#7c2432', ring: '#f07167' },
    'dai-gia': { bg: '#65501e', ring: '#f3cf7a' },
    tho: { bg: '#4e5c4c', ring: '#c6d8b9' },
    bay: { bg: '#472c54', ring: '#cfa6e8' },
    nong: { bg: '#5a3a28', ring: '#e8a87c' },
  });

export function RivalAvatar({
  rivalId,
  isTilted = false,
  size = 44,
  className,
}: RivalAvatarProps) {
  const key = rivalId ?? 'hero';
  const palette =
    rivalId === 'nong' && isTilted
      ? { bg: '#7f1d1d', ring: '#ff7052' }
      : AVATAR_BG[key];

  const renderGlyph = () => {
    if (rivalId === null) {
      // Hero: warm calm portrait with golden visor/crown accent
      return (
        <g>
          <circle cx="32" cy="27" r="11" fill="#f3d5b5" />
          <path d="M18 52c2-10 26-10 28 0" fill="#edc28d" />
          <path d="M21 24c2-8 20-8 22 0" fill="#2c241d" />
          <circle cx="28" cy="28" r="1.7" fill="#1c1917" />
          <circle cx="36" cy="28" r="1.7" fill="#1c1917" />
          <path d="M28 33q4 3 8 0" fill="none" stroke="#6b3e26" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    }

    switch (rivalId) {
      case 'da':
        // Đá (Rock): stoic geometric boulder face
        return (
          <g>
            <polygon points="32,12 49,22 46,45 32,52 18,45 15,22" fill="#7c8a85" stroke="#cdd8d3" strokeWidth="1.8" />
            <line x1="23" y1="28" x2="29" y2="28" stroke="#1d2422" strokeWidth="2.6" strokeLinecap="round" />
            <line x1="35" y1="28" x2="41" y2="28" stroke="#1d2422" strokeWidth="2.6" strokeLinecap="round" />
            <line x1="26" y1="38" x2="38" y2="38" stroke="#1d2422" strokeWidth="2.4" strokeLinecap="round" />
          </g>
        );
      case 'ca':
        // Cá (Fish): cheerful wide-eyed fish
        return (
          <g>
            <ellipse cx="34" cy="32" rx="15" ry="11" fill="#6cc8e2" />
            <polygon points="19,32 10,23 10,41" fill="#46a3bf" />
            <circle cx="40" cy="29" r="3.5" fill="#faf5e8" />
            <circle cx="41" cy="29" r="1.7" fill="#102a36" />
            <path d="M44 36q-4 3-7 0" fill="none" stroke="#102a36" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        );
      case 'cao':
        // Cáo (Fox): sharp TAG fox silhouette
        return (
          <g>
            <polygon points="18,16 27,24 20,30" fill="#e5883e" />
            <polygon points="46,16 37,24 44,30" fill="#e5883e" />
            <polygon points="32,48 18,28 32,20 46,28" fill="#eb944d" />
            <polygon points="32,48 25,36 39,36" fill="#faf5e8" />
            <circle cx="27" cy="31" r="1.9" fill="#1f140d" />
            <circle cx="37" cy="31" r="1.9" fill="#1f140d" />
            <circle cx="32" cy="43" r="2.2" fill="#1f140d" />
          </g>
        );
      case 'soi':
        // Sói (Wolf): fierce LAG wolf
        return (
          <g>
            <polygon points="17,15 26,23 19,31" fill="#9ea3bd" />
            <polygon points="47,15 38,23 45,31" fill="#9ea3bd" />
            <polygon points="32,50 18,29 24,20 40,20 46,29" fill="#b4b9d1" />
            <path d="M23 28l6 2" stroke="#1c1d29" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M41 28l-6 2" stroke="#1c1d29" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="27" cy="31" r="1.7" fill="#f0c451" />
            <circle cx="37" cy="31" r="1.7" fill="#f0c451" />
            <polygon points="29,40 35,40 32,44" fill="#1c1d29" />
          </g>
        );
      case 'dien':
        // Điên (Maniac): wild grin + electric sparks
        return (
          <g>
            <circle cx="32" cy="33" r="14" fill="#f6c7a8" />
            <path d="M18 24l5-9 6 6 5-8 5 8 6-6 3 9" fill="none" stroke="#f07167" strokeWidth="2.6" strokeLinejoin="round" />
            <circle cx="26.5" cy="30" r="3" fill="#fff" />
            <circle cx="27" cy="30" r="1.3" fill="#1d1115" />
            <circle cx="37.5" cy="30" r="3.4" fill="#fff" />
            <circle cx="37" cy="30" r="1.5" fill="#1d1115" />
            <path d="M23 39q9 7 18 0" fill="#fff" stroke="#6b1d28" strokeWidth="1.8" />
          </g>
        );
      case 'dai-gia':
        // Đại gia (Whale): golden crown & sunglasses
        return (
          <g>
            <circle cx="32" cy="35" r="13.5" fill="#f0cba4" />
            <polygon points="20,23 24,13 32,19 40,13 44,23" fill="#f3cf7a" stroke="#7d5c16" strokeWidth="1.3" />
            <rect x="21" y="29" width="9.5" height="6" rx="2" fill="#1b2421" />
            <rect x="33.5" y="29" width="9.5" height="6" rx="2" fill="#1b2421" />
            <line x1="30.5" y1="31.5" x2="33.5" y2="31.5" stroke="#1b2421" strokeWidth="1.8" />
            <path d="M27 41q5 3 10 0" fill="none" stroke="#6e4422" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        );
      case 'tho':
        // Thỏ (Rabbit): shy weak-tight bunny
        return (
          <g>
            <ellipse cx="25" cy="18" rx="4" ry="11" fill="#e8ece2" />
            <ellipse cx="39" cy="18" rx="4" ry="11" fill="#e8ece2" />
            <ellipse cx="25" cy="18" rx="2" ry="7" fill="#e6b0b0" />
            <ellipse cx="39" cy="18" rx="2" ry="7" fill="#e6b0b0" />
            <circle cx="32" cy="36" r="13" fill="#f3f5ef" />
            <circle cx="27" cy="34" r="2" fill="#29302a" />
            <circle cx="37" cy="34" r="2" fill="#29302a" />
            <path d="M30 40q2-2 4 0" fill="none" stroke="#6e7870" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        );
      case 'bay':
        // Bẫy (Trap): mysterious mask & cunning smirk
        return (
          <g>
            <circle cx="32" cy="33" r="14" fill="#ecd2b8" />
            <path d="M18 28q14-6 28 0l-3 7q-11-3-22 0z" fill="#2c1738" />
            <circle cx="26.5" cy="30.5" r="1.8" fill="#edc28d" />
            <circle cx="37.5" cy="30.5" r="1.8" fill="#edc28d" />
            <path d="M26 40q7 2 12-2" fill="none" stroke="#472c54" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
      case 'nong':
        // Nóng (Tilter): distinct normal vs tilted expression (AC B5)
        if (isTilted) {
          return (
            <g>
              <path d="M16 18q4-7 7 0M41 18q4-7 7 0" fill="none" stroke="#ff9f68" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="32" cy="35" r="14" fill="#e26252" stroke="#ffb399" strokeWidth="1.4" />
              <path d="M22 28l8 4M42 28l-8 4" stroke="#2d0909" strokeWidth="2.6" strokeLinecap="round" />
              <circle cx="26.5" cy="34" r="2" fill="#2d0909" />
              <circle cx="37.5" cy="34" r="2" fill="#2d0909" />
              <path d="M25 43q7-5 14 0" fill="none" stroke="#2d0909" strokeWidth="2.4" strokeLinecap="round" />
            </g>
          );
        }
        return (
          <g>
            <circle cx="32" cy="34" r="14" fill="#f0cba4" />
            <path d="M22 27h7M35 27h7" stroke="#3c2618" strokeWidth="2" strokeLinecap="round" />
            <circle cx="26.5" cy="32" r="1.9" fill="#2b1b12" />
            <circle cx="37.5" cy="32" r="1.9" fill="#2b1b12" />
            <line x1="27" y1="41" x2="37" y2="41" stroke="#5c3926" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
    }
  };

  const label =
    rivalId === null
      ? 'Avatar Hero'
      : rivalId === 'nong' && isTilted
        ? 'Avatar Nóng đang tilt (đỏ mặt, cau có)'
        : `Avatar rival ${rivalId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={label}
      data-avatar-mood={rivalId === 'nong' && isTilted ? 'tilted' : 'normal'}
    >
      <circle cx="32" cy="32" r="30" fill={palette.bg} stroke={palette.ring} strokeWidth="2.8" />
      {renderGlyph()}
    </svg>
  );
}
