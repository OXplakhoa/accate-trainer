import type { Denomination } from '../../../engine';

interface ChipTheme {
  readonly base: string;
  readonly rim: string;
  readonly spot: string;
  readonly center: string;
  readonly text: string;
  readonly pattern: 'bars-4' | 'bars-6' | 'diamonds-8' | 'crown-12';
}

const CHIP_THEMES: Readonly<Record<Denomination, ChipTheme>> = Object.freeze({
  5: {
    base: '#b23b32',
    rim: '#7a221b',
    spot: '#f5eee2',
    center: '#faf3e6',
    text: '#6e1d17',
    pattern: 'bars-4',
  },
  10: {
    base: '#206785',
    rim: '#134156',
    spot: '#edc28d',
    center: '#f2f7f9',
    text: '#103b4f',
    pattern: 'bars-6',
  },
  50: {
    base: '#b87a24',
    rim: '#774c12',
    spot: '#194a38',
    center: '#fcf5e6',
    text: '#5c3809',
    pattern: 'diamonds-8',
  },
  100: {
    base: '#2c2638',
    rim: '#171320',
    spot: '#edc28d',
    center: '#f8f0df',
    text: '#241c30',
    pattern: 'crown-12',
  },
});

export interface ChipSvgProps {
  readonly denomination: Denomination;
  readonly size?: number;
  readonly className?: string;
  readonly decorative?: boolean;
}

export function ChipSvg({
  denomination,
  size = 44,
  className,
  decorative = false,
}: ChipSvgProps) {
  const theme = CHIP_THEMES[denomination];

  const renderEdgeSpots = () => {
    if (theme.pattern === 'bars-4') {
      return [0, 90, 180, 270].map((angle) => (
        <rect
          key={angle}
          x="29"
          y="2"
          width="6"
          height="9"
          rx="1.5"
          fill={theme.spot}
          transform={`rotate(${angle} 32 32)`}
        />
      ));
    }
    if (theme.pattern === 'bars-6') {
      return [0, 60, 120, 180, 240, 300].map((angle) => (
        <rect
          key={angle}
          x="29.5"
          y="2"
          width="5"
          height="9"
          rx="1.5"
          fill={theme.spot}
          transform={`rotate(${angle} 32 32)`}
        />
      ));
    }
    if (theme.pattern === 'diamonds-8') {
      return [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <polygon
          key={angle}
          points="32,2 36,7 32,11 28,7"
          fill={theme.spot}
          stroke="#f5eee2"
          strokeWidth="0.7"
          transform={`rotate(${angle} 32 32)`}
        />
      ));
    }
    return [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => (
      <rect
        key={angle}
        x="30"
        y="2"
        width="4"
        height="8.5"
        rx="1.5"
        fill={angle % 60 === 0 ? theme.spot : '#f5eee2'}
        transform={`rotate(${angle} 32 32)`}
      />
    ));
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `Chip mệnh giá ${denomination} điểm`}
    >
      <circle cx="32" cy="32" r="30" fill={theme.base} stroke={theme.rim} strokeWidth="2.5" />
      {renderEdgeSpots()}
      <circle
        cx="32"
        cy="32"
        r="21"
        fill="none"
        stroke={theme.spot}
        strokeWidth="1.5"
        strokeDasharray={denomination === 100 ? '3 2' : '5 3'}
        opacity="0.85"
      />
      <circle cx="32" cy="32" r="17.5" fill={theme.center} stroke={theme.rim} strokeWidth="1.5" />
      <text
        x="32"
        y="37.5"
        textAnchor="middle"
        fill={theme.text}
        fontSize={denomination === 100 ? '14' : '16'}
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {denomination}
      </text>
    </svg>
  );
}
