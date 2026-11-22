import * as THREE from 'three';
import type { PublicTableSeat } from '../../sandbox/types';

export type ActionBubbleTone = 'neutral' | 'call' | 'aggressive' | 'fold' | 'all-in';

export interface ActionBubbleSpec {
  readonly label: string;
  readonly tone: ActionBubbleTone;
}

/**
 * Formats a seat's public lastAction/status into a compact label using
 * Vietnamese UI conventions with standard English poker terms.
 */
export function formatSeatActionBubble(
  seat: Pick<PublicTableSeat, 'status' | 'lastAction'>,
): ActionBubbleSpec | null {
  if (seat.status === 'out') {
    return null;
  }
  if (seat.status === 'all-in') {
    return { label: 'All-in', tone: 'all-in' };
  }
  if (!seat.lastAction) {
    return null;
  }

  switch (seat.lastAction.type) {
    case 'check':
      return { label: 'Check', tone: 'neutral' };
    case 'fold':
      return { label: 'Fold', tone: 'fold' };
    case 'call':
      return {
        label: seat.lastAction.amount > 0 ? `Call ${seat.lastAction.amount}` : 'Call',
        tone: 'call',
      };
    case 'bet':
      return {
        label: seat.lastAction.amount > 0 ? `Bet ${seat.lastAction.amount}` : 'Bet',
        tone: 'aggressive',
      };
    case 'raise':
      return {
        label: seat.lastAction.amount > 0 ? `Raise ${seat.lastAction.amount}` : 'Raise',
        tone: 'aggressive',
      };
  }
}

const TONE_STYLES: Record<
  ActionBubbleTone,
  { readonly bg: string; readonly border: string; readonly text: string }
> = {
  neutral: { bg: 'rgba(34, 82, 74, 0.94)', border: '#d9c6a3', text: '#faf5eb' },
  call: { bg: 'rgba(42, 84, 110, 0.94)', border: '#e6c58b', text: '#faf5eb' },
  aggressive: { bg: 'rgba(158, 66, 48, 0.95)', border: '#f5cc78', text: '#fff8ee' },
  fold: { bg: 'rgba(72, 62, 56, 0.90)', border: '#b7a693', text: '#ebe0cf' },
  'all-in': { bg: 'rgba(164, 40, 52, 0.96)', border: '#f7d16b', text: '#fffaf0' },
};

function drawPillPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draws a compact, high-contrast canvas texture for a 3D billboard action bubble.
 * Kept small (256x72) for low memory footprint while remaining crisp at 1440px and 390px.
 */
export function createActionBubbleTexture(spec: ActionBubbleSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const style = TONE_STYLES[spec.tone];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle grounded shadow
    ctx.save();
    ctx.fillStyle = 'rgba(22, 16, 12, 0.28)';
    drawPillPath(ctx, 10, 10, 236, 56, 28);
    ctx.fill();
    ctx.restore();

    // Main pill body
    drawPillPath(ctx, 8, 6, 240, 56, 28);
    ctx.fillStyle = style.bg;
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = style.border;
    ctx.stroke();

    // Bold, high-contrast label readable independent of background color
    ctx.fillStyle = style.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = spec.label.length > 9 ? 28 : 32;
    ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(spec.label, 128, 35, 212);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
