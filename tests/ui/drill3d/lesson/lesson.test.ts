import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SPOT } from '../../../../src/ui/drill3d/contract';
import { BluffEquityNote, DrillLesson } from '../../../../src/ui/drill3d/lesson/DrillLesson';
import {
  correctAction,
  countdownCue,
  DURATION_MS,
  exactPercent,
  requiredPercent,
  secondsRemaining,
} from '../../../../src/ui/drill3d/lesson/model';

describe('3D lesson', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('compares unrounded one-card hit probability to the correct pot odds', () => {
    expect(DEMO_SPOT).toMatchObject({ pot: 150, call: 50, outs: 9 });
    expect(exactPercent(DEMO_SPOT)).toBeCloseTo(19.565, 2);
    expect(requiredPercent(DEMO_SPOT)).toBe(25);
    expect(correctAction(DEMO_SPOT)).toBe('Fold');
  });

  it('uses a 20 second deadline and reaches zero exactly at expiry', () => {
    expect(DURATION_MS).toBe(20_000);
    expect(secondsRemaining(21_000, 1_000)).toBe(20);
    expect(secondsRemaining(21_000, 20_999)).toBe(1);
    expect(secondsRemaining(21_000, 21_000)).toBe(0);
    expect(secondsRemaining(21_000, 25_000)).toBe(0);
  });

  it('emits one cue per observed final second and does not replay missed ticks', () => {
    expect(
      [20, 4, 3, 3, 2, 2, 1, 1, 0, 0]
        .slice(1)
        .map((n, i) => countdownCue([20, 4, 3, 3, 2, 2, 1, 1, 0][i]!, n))
        .filter(Boolean),
    ).toEqual(['tick', 'tick', 'tick', 'expired']);
    expect(countdownCue(4, 1)).toBe('tick');
    expect(countdownCue(3, 0)).toBe('expired');
  });

  it('renders accessible controls and states the educational assumptions', () => {
    const html = renderToStaticMarkup(
      createElement(DrillLesson, {
        spot: DEMO_SPOT,
        onPhaseChange: () => {},
        onHighlightChange: () => {},
      }),
    );
    expect(html).toContain('aria-label="Chọn cấp độ"');
    expect(html).not.toContain('Chọn tình huống');
    expect(html).not.toContain('Cơ bản');
    expect(html).not.toContain('Sát ngưỡng');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('không xét blocker');
    expect(html).toContain('Không trả thêm để xem River');
    expect(html).toContain('Có bao nhiêu outs?');
    expect(html).not.toContain('9/46');
    expect(html).not.toContain('range cược');
  });

  it('explains the conditional role of bluffs in showdown equity', () => {
    const html = renderToStaticMarkup(createElement(BluffEquityNote));
    expect(html).toContain('equity showdown trước range cược ở tình huống đó đạt ít nhất 20%');
    expect(html).toContain('thắng được bluff dù không trúng thùng');
    expect(html).toContain('đối thủ thường bluff chưa');
    expect(html).toContain('range cược cụ thể');
  });
});
