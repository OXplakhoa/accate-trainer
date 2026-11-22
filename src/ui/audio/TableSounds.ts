import { DENOMINATIONS, type ChipCounts, type Denomination } from '../../engine/chips';
import { createRng, type Rng } from '../../engine/rng';
import { AudioCore, type SoundLayer } from './AudioCore';

const MAX_CHIP_TICKS = 12;
const CHIP_RESONANCES = {
  5: { modes: [1950, 3060, 4890], brightness: 4800, decay: 0.041 },
  10: { modes: [1580, 2460, 3890], brightness: 3900, decay: 0.052 },
  50: { modes: [1110, 1790, 2770], brightness: 2950, decay: 0.068 },
  100: { modes: [790, 1270, 2110], brightness: 2250, decay: 0.083 },
} satisfies Record<Denomination, { modes: number[]; brightness: number; decay: number }>;

interface ChipOptions {
  readonly pan?: number;
  readonly delay?: number;
}

interface Pile {
  readonly chips: ChipCounts;
  readonly pan: number;
}

function paper(frequency: number, duration: number, volume: number, delay = 0): SoundLayer {
  return { wave: 'noise', filter: 'bandpass', frequency, duration, volume, delay, attack: 0.009 };
}

function note(frequency: number, duration: number, volume: number, delay = 0): SoundLayer {
  return { wave: 'sine', frequency, duration, volume, delay, attack: 0.014 };
}

function chipLayers(denomination: Denomination, delay: number, pan: number): SoundLayer[] {
  const { modes, brightness, decay } = CHIP_RESONANCES[denomination];
  return [
    {
      wave: 'noise',
      filter: 'bandpass',
      frequency: brightness,
      q: 0.8,
      duration: 0.015,
      attack: 0.0015,
      volume: 0.33,
      delay,
      pan,
    },
    ...modes.map((frequency, index): SoundLayer => ({
      wave: 'sine',
      frequency,
      duration: decay * (1 - index * 0.22),
      attack: 0.002,
      volume: 0.2 * 0.48 ** index,
      delay,
      pan,
    })),
  ];
}

function chipCount(chips: ChipCounts): number {
  return DENOMINATIONS.reduce((total, denomination) => total + (chips[denomination] ?? 0), 0);
}

/** Recipes shared by the Sandbox, Tournament and both Drill adapters. */
export class TableSounds {
  private readonly timing: Rng;
  private readonly order: Rng;

  constructor(
    private readonly audio: AudioCore,
    rng: Rng = createRng('accate-table-sounds'),
  ) {
    this.timing = rng.fork('cascade-timing');
    this.order = rng.fork('cascade-order');
  }

  playChip(denomination: Denomination): void {
    this.audio.play('chips', chipLayers(denomination, 0, 0));
  }

  playChips(chips: ChipCounts, { pan = 0, delay = 0 }: ChipOptions = {}): void {
    this.audio.play('chips', this.clatter([{ chips, pan }], delay));
  }

  playAllIn(chips: ChipCounts, pan = 0): void {
    this.audio.play(
      'chips',
      [
        { ...note(142, 0.15, 0.19), endFrequency: 66, attack: 0.008 },
        { ...paper(1320, 0.22, 0.19), endFrequency: 580, attack: 0.05 },
        ...this.clatter([{ chips, pan }], 0.045),
      ],
      pan,
    );
  }

  playPotPush(piles: readonly Pile[], fallback?: { amount: number; pan: number }): void {
    const count = piles.reduce((total, pile) => total + chipCount(pile.chips), 0);
    const size = count || Math.max(1, (fallback?.amount ?? 40) / 20);
    const pan =
      count > 0
        ? piles.reduce((sum, pile) => sum + chipCount(pile.chips) * pile.pan, 0) / count
        : (fallback?.pan ?? 0);
    const duration = Math.min(0.72, 0.27 + 0.044 * Math.sqrt(size));
    this.audio.play(
      'chips',
      [
        { ...paper(1240, duration, count ? 0.24 : 0.16), endFrequency: 610, attack: 0.11 },
        { ...paper(540, duration * 0.8, 0.14, 0.025), filter: 'lowpass', attack: 0.09 },
        ...this.clatter(piles, duration * 0.33, 1.12),
      ],
      pan,
    );
  }

  playCardDeal(count = 1, pan = 0): void {
    const layers: SoundLayer[] = [];
    for (let i = 0; i < count; i++) {
      const delay = i * 0.09;
      layers.push(
        { ...paper(2250, 0.078, 0.21, delay), endFrequency: 4000, attack: 0.022 },
        { ...paper(1250, 0.026, 0.28, delay + 0.048), attack: 0.0025 },
      );
    }
    this.audio.play('cards', layers, pan);
  }

  playCardFlip(pan = 0): void {
    this.audio.play(
      'cards',
      [
        { ...paper(3850, 0.063, 0.21), endFrequency: 1860, attack: 0.012 },
        { ...paper(1750, 0.04, 0.22, 0.034), attack: 0.002 },
      ],
      pan,
    );
  }

  playShowdown(): void {
    this.playCardFlip(-0.16);
    this.audio.play(
      'cards',
      [
        { ...paper(4040, 0.081, 0.21, 0.094), endFrequency: 1690, attack: 0.012 },
        { ...paper(1580, 0.046, 0.23, 0.13), attack: 0.002 },
      ],
      0.16,
    );
  }

  playMuck(pan = 0): void {
    this.audio.play(
      'cards',
      [
        { ...paper(1600, 0.2, 0.17), endFrequency: 670, attack: 0.028, q: 0.46 },
        { ...paper(840, 0.075, 0.12, 0.108), attack: 0.018 },
      ],
      pan,
    );
  }

  playCheck(pan = 0): void {
    this.audio.play(
      'ui',
      [
        { ...note(191, 0.068, 0.19), endFrequency: 106, attack: 0.004 },
        { ...paper(410, 0.032, 0.2), attack: 0.002 },
        { ...note(168, 0.06, 0.145, 0.081), endFrequency: 105, attack: 0.004 },
        { ...paper(375, 0.028, 0.15, 0.081), attack: 0.002 },
      ],
      pan,
    );
  }

  playHeroTurn(): void {
    this.audio.play('ui', [note(392, 0.13, 0.12), note(523.25, 0.19, 0.1, 0.095)]);
  }

  playOutOfTurn(pan = 0): void {
    this.audio.play(
      'ui',
      [{ ...note(520, 0.085, 0.17), endFrequency: 460 }, note(693, 0.12, 0.13, 0.064)],
      pan,
    );
  }

  playTimerTick(urgent: boolean): void {
    this.audio.play('timer', [
      {
        ...note(urgent ? 1050 : 780, urgent ? 0.062 : 0.042, urgent ? 0.24 : 0.15),
        attack: 0.0025,
        endFrequency: urgent ? 790 : 560,
        wave: urgent ? 'triangle' : 'sine',
      },
    ]);
  }

  playExpired(): void {
    this.audio.play('timer', [
      { ...note(440, 0.14, 0.16), endFrequency: 355 },
      { ...note(330, 0.18, 0.13, 0.105), endFrequency: 273 },
    ]);
  }

  playFeedback(correct: boolean): void {
    this.audio.play(
      'ui',
      correct
        ? [note(523.25, 0.16, 0.2), note(659.25, 0.22, 0.17, 0.079)]
        : [note(392, 0.14, 0.18), note(329.63, 0.2, 0.15, 0.09)],
    );
  }

  playPayoutFanfare(): void {
    this.audio.play('chips', [
      note(523.25, 0.14, 0.16),
      note(659.25, 0.16, 0.15, 0.065),
      note(783.99, 0.21, 0.14, 0.13),
    ]);
  }

  private clatter(piles: readonly Pile[], delay: number, pace = 1): SoundLayer[] {
    const total = piles.reduce((sum, pile) => sum + chipCount(pile.chips), 0);
    if (total <= 0) return [];
    const available = piles.map(({ chips, pan }) => ({ chips: { ...chips }, pan }));
    const counts = DENOMINATIONS.map((denomination) => ({
      denomination,
      count: piles.reduce((sum, pile) => sum + (pile.chips[denomination] ?? 0), 0),
    })).filter(({ count }) => count > 0);

    // Keep each denomination audible, then sample the remainder in proportion to its count.
    const ticks = counts.map(({ denomination }) => denomination);
    const extra = Math.min(total, MAX_CHIP_TICKS) - ticks.length;
    let cumulative = 0;
    let sample = 0;
    for (const { denomination, count } of counts) {
      cumulative += count - 1;
      while (sample < extra && ((sample + 0.5) * (total - counts.length)) / extra < cumulative) {
        ticks.push(denomination);
        sample++;
      }
    }

    const span =
      pace * Math.min(0.58, 0.046 * (ticks.length - 1) ** 0.78 + 0.003 * (total - ticks.length));
    const acceleration = 1.22 + Math.min(0.95, (total - ticks.length) * 0.012);
    return this.order.shuffle(ticks).flatMap((denomination, index) => {
      const remaining = available.reduce((sum, pile) => sum + (pile.chips[denomination] ?? 0), 0);
      let pick = this.order.int(remaining);
      const pile = available.find((pile) => {
        pick -= pile.chips[denomination] ?? 0;
        return pick < 0;
      })!;
      pile.chips[denomination]--;
      const position =
        index === 0 ? 0 : (index + (this.timing.next() - 0.5) * 0.4) / (ticks.length - 1);
      return chipLayers(denomination, delay + span * position ** acceleration, pile.pan);
    });
  }
}
