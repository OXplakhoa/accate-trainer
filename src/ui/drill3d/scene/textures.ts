import * as THREE from 'three';
import { parseCard, type CardSuit } from './outs';

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawSuitSymbol(
  ctx: CanvasRenderingContext2D,
  suit: CardSuit,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.beginPath();

  switch (suit) {
    case '♥': {
      const s = size * 0.52;
      ctx.moveTo(0, s * 0.88);
      ctx.bezierCurveTo(-s * 1.15, s * 0.25, -s * 1.15, -s * 0.72, -s * 0.45, -s * 0.78);
      ctx.bezierCurveTo(-s * 0.14, -s * 0.8, 0, -s * 0.5, 0, -s * 0.34);
      ctx.bezierCurveTo(0, -s * 0.5, s * 0.14, -s * 0.8, s * 0.45, -s * 0.78);
      ctx.bezierCurveTo(s * 1.15, -s * 0.72, s * 1.15, s * 0.25, 0, s * 0.88);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case '♦': {
      const s = size * 0.54;
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.26, -s * 0.24, s * 0.76, 0);
      ctx.quadraticCurveTo(s * 0.26, s * 0.24, 0, s);
      ctx.quadraticCurveTo(-s * 0.26, s * 0.24, -s * 0.76, 0);
      ctx.quadraticCurveTo(-s * 0.26, -s * 0.24, 0, -s);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case '♠': {
      const s = size * 0.52;
      ctx.moveTo(0, -s * 0.94);
      ctx.bezierCurveTo(s * 1.12, -s * 0.2, s * 1.06, s * 0.58, s * 0.38, s * 0.54);
      ctx.bezierCurveTo(s * 0.18, s * 0.52, s * 0.08, s * 0.38, 0.04 * s, s * 0.26);
      ctx.lineTo(s * 0.24, s * 0.92);
      ctx.lineTo(-s * 0.24, s * 0.92);
      ctx.lineTo(-0.04 * s, s * 0.26);
      ctx.bezierCurveTo(-s * 0.08, s * 0.38, -s * 0.18, s * 0.52, -s * 0.38, s * 0.54);
      ctx.bezierCurveTo(-s * 1.06, s * 0.58, -s * 1.12, -s * 0.2, 0, -s * 0.94);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case '♣': {
      const r = size * 0.25;
      ctx.arc(0, -r * 1.18, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-r * 1.08, r * 0.14, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 1.08, r * 0.14, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, r * 0.1);
      ctx.lineTo(r * 0.32, r * 0.1);
      ctx.lineTo(r * 0.62, r * 1.85);
      ctx.lineTo(-r * 0.62, r * 1.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

function finalizeTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeatX !== 1 || repeatY !== 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
  }
  texture.needsUpdate = true;
  return texture;
}

export const CARD_TEXTURE_METRICS = {
  width: 320,
  height: 448,
  cornerRankFontSingle: 108,
  cornerRankFontDouble: 92,
  cornerSuitSize: 72,
  centerSuitSize: 184,
  centerSuitGhostSize: 168,
  bottomRankFontSingle: 72,
  bottomRankFontDouble: 62,
} as const;

export function createCardFaceTexture(
  cardText: string,
  options: { readonly ghost?: boolean } = {},
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_TEXTURE_METRICS.width;
  canvas.height = CARD_TEXTURE_METRICS.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  const parsed = parseCard(cardText);
  const ghost = options.ghost ?? false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer card body (warm cream card style)
  drawRoundedRectPath(ctx, 8, 8, 304, 432, 26);
  ctx.fillStyle = ghost ? '#FFF5F3' : '#FBF6EC';
  ctx.fill();

  ctx.lineWidth = ghost ? 7 : 6;
  ctx.strokeStyle = ghost ? '#D95A66' : '#D5C6AE';
  if (ghost) {
    ctx.setLineDash([16, 11]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Subtle inner frame
  drawRoundedRectPath(ctx, 20, 20, 280, 408, 18);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = ghost ? 'rgba(217, 90, 102, 0.32)' : 'rgba(83, 60, 49, 0.13)';
  ctx.stroke();

  const inkColor = parsed.isRed ? '#C73B3A' : '#24292E';
  const isDoubleRank = parsed.rank.length > 1;
  const cornerRankPx = isDoubleRank
    ? CARD_TEXTURE_METRICS.cornerRankFontDouble
    : CARD_TEXTURE_METRICS.cornerRankFontSingle;

  // Top-left jumbo corner rank & suit pip (extra bold for high distance legibility)
  ctx.fillStyle = inkColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${cornerRankPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(parsed.rank, isDoubleRank ? 24 : 30, 20);
  drawSuitSymbol(ctx, parsed.suit, 68, 162, CARD_TEXTURE_METRICS.cornerSuitSize, inkColor);

  // Prominent central suit emblem
  drawSuitSymbol(
    ctx,
    parsed.suit,
    178,
    258,
    ghost ? CARD_TEXTURE_METRICS.centerSuitGhostSize : CARD_TEXTURE_METRICS.centerSuitSize,
    inkColor,
  );

  // Subtle "RIVER?" stamp on ghost outs cards
  if (ghost) {
    ctx.fillStyle = 'rgba(199, 59, 58, 0.14)';
    drawRoundedRectPath(ctx, 38, 360, 244, 50, 14);
    ctx.fill();
    ctx.fillStyle = '#A83238';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('RIVER?', 160, 386);
  } else {
    // Bottom-right inverted jumbo rank
    const bottomRankPx = isDoubleRank
      ? CARD_TEXTURE_METRICS.bottomRankFontDouble
      : CARD_TEXTURE_METRICS.bottomRankFontSingle;
    ctx.save();
    ctx.translate(292, 424);
    ctx.rotate(Math.PI);
    ctx.fillStyle = inkColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `900 ${bottomRankPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(parsed.rank, 0, 0);
    ctx.restore();
  }

  return finalizeTexture(canvas);
}

export function createCardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  drawRoundedRectPath(ctx, 6, 6, 244, 348, 22);
  ctx.fillStyle = '#F7EFE0';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#C9B89E';
  ctx.stroke();

  drawRoundedRectPath(ctx, 22, 22, 212, 316, 14);
  ctx.fillStyle = '#7C3E35';
  ctx.fill();

  // Warm woven diamond lattice
  ctx.save();
  ctx.beginPath();
  drawRoundedRectPath(ctx, 26, 26, 204, 308, 12);
  ctx.clip();

  ctx.strokeStyle = 'rgba(243, 232, 212, 0.28)';
  ctx.lineWidth = 2.5;
  for (let y = -160; y < 480; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + 256);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(256, y);
    ctx.lineTo(0, y + 256);
    ctx.stroke();
  }
  ctx.restore();

  // Center medallion
  ctx.fillStyle = '#F3E8D4';
  ctx.beginPath();
  ctx.ellipse(128, 180, 38, 52, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#533C31';
  ctx.beginPath();
  ctx.ellipse(128, 180, 26, 38, 0, 0, Math.PI * 2);
  ctx.fill();

  drawSuitSymbol(ctx, '♥', 128, 180, 34, '#E8C596');

  return finalizeTexture(canvas);
}

export function createFeltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  // Base lake-teal felt #34786D with subtle radial studio warmth
  const grad = ctx.createRadialGradient(256, 256, 32, 256, 256, 285);
  grad.addColorStop(0, '#3D897C');
  grad.addColorStop(0.65, '#34786D');
  grad.addColorStop(1, '#296359');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine matte baize grain (deterministic pattern, no Math.random)
  ctx.fillStyle = 'rgba(255, 248, 232, 0.032)';
  for (let y = 0; y < 512; y += 4) {
    for (let x = (y % 8) / 2; x < 512; x += 6) {
      if ((x * 7 + y * 13) % 11 < 4) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  ctx.fillStyle = 'rgba(18, 46, 42, 0.045)';
  for (let y = 2; y < 512; y += 5) {
    for (let x = 1; x < 512; x += 7) {
      if ((x * 11 + y * 5) % 9 < 3) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  return finalizeTexture(canvas);
}

export function createWoodTexture(baseHex: string, grainHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = grainHex;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.24;
  for (let i = 0; i < 36; i += 1) {
    const y = (i / 36) * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      85,
      y + Math.sin(i * 0.7) * 6,
      170,
      y - Math.cos(i * 0.6) * 6,
      256,
      y,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return finalizeTexture(canvas, 2, 2);
}

export function createChipEdgeTexture(bodyHex: string, stripeHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, 256, 32);

  // 6 classic clay edge stripes
  ctx.fillStyle = stripeHex;
  const stripes = 6;
  const step = 256 / stripes;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillRect(i * step + 10, 0, 14, 32);
  }

  // Subtle top/bottom lip shade
  ctx.fillStyle = 'rgba(20, 14, 10, 0.16)';
  ctx.fillRect(0, 0, 256, 3);
  ctx.fillRect(0, 29, 256, 3);

  return finalizeTexture(canvas);
}

export function createChipTopTexture(
  bodyHex: string,
  stripeHex: string,
  accentHex: string,
  label: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  ctx.fillStyle = bodyHex;
  ctx.fillRect(0, 0, 128, 128);

  // Outer edge notches
  ctx.save();
  ctx.translate(64, 64);
  ctx.fillStyle = stripeHex;
  for (let i = 0; i < 6; i += 1) {
    ctx.rotate((Math.PI * 2) / 6);
    ctx.fillRect(-7, -62, 14, 15);
  }
  ctx.restore();

  // Inner dashed ring
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.setLineDash([7, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center clay inlay
  ctx.beginPath();
  ctx.arc(64, 64, 35, 0, Math.PI * 2);
  ctx.fillStyle = '#F8F1E4';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(83, 60, 49, 0.35)';
  ctx.stroke();

  ctx.fillStyle = '#33241D';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(label, 64, 66);

  return finalizeTexture(canvas);
}

export function createRiverSlotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  ctx.clearRect(0, 0, 256, 360);

  drawRoundedRectPath(ctx, 14, 14, 228, 332, 22);
  ctx.fillStyle = 'rgba(243, 232, 212, 0.08)';
  ctx.fill();

  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(243, 232, 212, 0.56)';
  ctx.setLineDash([18, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(243, 232, 212, 0.72)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 72px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('?', 128, 152);

  ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('RIVER', 128, 224);

  return finalizeTexture(canvas);
}

export function createWallArtTexture(suit: CardSuit, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return finalizeTexture(canvas);
  }

  ctx.fillStyle = '#F8F1E4';
  ctx.fillRect(0, 0, 192, 240);

  ctx.strokeStyle = 'rgba(83, 60, 49, 0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, 156, 204);

  drawSuitSymbol(ctx, suit, 96, 120, 74, accentHex);

  return finalizeTexture(canvas);
}
