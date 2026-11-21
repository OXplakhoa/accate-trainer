import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SPOTS } from '../../../../src/ui/drill3d/contract';
import { DrillLesson } from '../../../../src/ui/drill3d/lesson/DrillLesson';
import { correctAction, DURATION_MS, exactPercent, requiredPercent, secondsRemaining } from '../../../../src/ui/drill3d/lesson/model';

describe('3D lesson', () => {
  beforeEach(() => { vi.spyOn(globalThis.performance, 'now').mockReturnValue(0); });
  afterEach(() => { vi.restoreAllMocks(); });
  it('compares unrounded one-card hit probability to the correct pot odds', () => {
    const [clear, close] = DEMO_SPOTS;
    expect(exactPercent(clear)).toBeCloseTo(19.565, 2);
    expect(requiredPercent(clear)).toBe(25);
    expect(requiredPercent(close)).toBe(20);
    expect(correctAction(clear)).toBe('Fold');
    expect(correctAction(close)).toBe('Fold');
    expect(correctAction({ ...close, pot: 170 })).toBe('Call');
  });

  it('uses a 20 second deadline and reaches zero exactly at expiry', () => {
    expect(DURATION_MS).toBe(20_000);
    expect(secondsRemaining(21_000, 1_000)).toBe(20);
    expect(secondsRemaining(21_000, 20_999)).toBe(1);
    expect(secondsRemaining(21_000, 21_000)).toBe(0);
    expect(secondsRemaining(21_000, 25_000)).toBe(0);
  });

  it('renders accessible controls and states the educational assumptions', () => {
    const html = renderToStaticMarkup(createElement(DrillLesson, {
      spot: DEMO_SPOTS[0], onSpotChange: () => {}, onPhaseChange: () => {}, onHighlightChange: () => {},
    }));
    expect(html).toContain('aria-label="Chọn cấp độ"');
    expect(html).toContain('aria-label="Chọn tình huống"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('không xét blocker');
    expect(html).toContain('Không trả thêm để xem River');
    expect(html).toContain('Có bao nhiêu outs?');
    expect(html).not.toContain('9/46');
  });
});
