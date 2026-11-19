import { describe, expect, it } from 'vitest';
import { initialDistribution, takeExactLargeFirst } from '../../src/engine/bank';
import {
  addChips,
  CHIP_SET,
  checkInv1,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine/chips';
import { profitLoss, summarizeLedger, type LedgerEvent } from '../../src/engine/ledger';

describe('ledger', () => {
  it('C7: tracks buy-in, 2 rebuys, and cash-out with accurate summarizeLedger and profitLoss', () => {
    const init = initialDistribution(4);
    let bank = init.bank;
    let heroStack = init.perPlayer;
    let rival1Stack = init.perPlayer;
    let rival2Stack = init.perPlayer;
    const rival3Stack = init.perPlayer;
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    const events: LedgerEvent[] = [
      { type: 'buy-in', playerId: 'hero', chips: init.perPlayer },
      { type: 'buy-in', playerId: 'rival-1', chips: init.perPlayer },
      { type: 'buy-in', playerId: 'rival-2', chips: init.perPlayer },
      { type: 'buy-in', playerId: 'rival-3', chips: init.perPlayer },
    ];

    // Hero loses initial 500 to rival-1, then rebuys 500 from bank
    rival1Stack = addChips(rival1Stack, heroStack);
    heroStack = emptyChips();
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    const rebuy1: ChipCounts = { 5: 0, 10: 0, 50: 0, 100: 5 };
    bank = subtractChips(bank, rebuy1);
    heroStack = addChips(heroStack, rebuy1);
    events.push({ type: 'rebuy', playerId: 'hero', chips: rebuy1 });
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    // Hero loses second 500 to rival-2, then rebuys another 500 from bank
    rival2Stack = addChips(rival2Stack, heroStack);
    heroStack = emptyChips();
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    const rebuy2: ChipCounts = { 5: 0, 10: 0, 50: 0, 100: 5 };
    bank = subtractChips(bank, rebuy2);
    heroStack = addChips(heroStack, rebuy2);
    events.push({ type: 'rebuy', playerId: 'hero', chips: rebuy2 });
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    // Hero wins 800 back from rival-1 (stack becomes 1300), then cashes out 500 to bank
    const wonFromRival1 = takeExactLargeFirst(rival1Stack, 800)!;
    rival1Stack = subtractChips(rival1Stack, wonFromRival1);
    heroStack = addChips(heroStack, wonFromRival1);
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    const cashOutChips = takeExactLargeFirst(heroStack, 500)!;
    heroStack = subtractChips(heroStack, cashOutChips);
    bank = addChips(bank, cashOutChips);
    events.push({ type: 'cash-out', playerId: 'hero', chips: cashOutChips });
    expect(checkInv1([bank, heroStack, rival1Stack, rival2Stack, rival3Stack])).toEqual({
      ok: true,
    });

    const summary = summarizeLedger(events);
    const heroLedger = summary['hero'];
    expect(heroLedger).toEqual({
      buyIns: 1,
      rebuys: 2,
      cashOuts: 1,
      invested: 1500,
      cashedOut: 500,
    });

    // Hero has 500 cashedOut + 800 in current stack - 1500 invested = -200
    expect(profitLoss(heroLedger!, heroStack)).toBe(-200);
    // Rival-1: 500 buy-in, 200 current stack (500 + 500 - 800) => -300
    expect(profitLoss(summary['rival-1']!, rival1Stack)).toBe(-300);
    // Rival-2: 500 buy-in, 1000 current stack => +500
    expect(profitLoss(summary['rival-2']!, rival2Stack)).toBe(500);
    // Rival-3: 500 buy-in, 500 current stack => 0
    expect(profitLoss(summary['rival-3']!, rival3Stack)).toBe(0);
  });

  it('C7: records "__proto__" as an own enumerable and JSON-serializable key', () => {
    const buyInChips: ChipCounts = { 5: 0, 10: 0, 50: 0, 100: 5 };
    const bank = subtractChips(CHIP_SET, buyInChips);
    expect(checkInv1([bank, buyInChips])).toEqual({ ok: true });

    const summary = summarizeLedger([
      { type: 'buy-in', playerId: '__proto__', chips: buyInChips },
    ]);

    expect(Object.hasOwn(summary, '__proto__')).toBe(true);
    expect(Object.keys(summary)).toEqual(['__proto__']);

    const entry = summary['__proto__'];
    expect(entry).toEqual({
      buyIns: 1,
      rebuys: 0,
      cashOuts: 0,
      invested: 500,
      cashedOut: 0,
    });
    expect(entry?.buyIns).toBe(1);
    expect(entry?.invested).toBe(500);
    expect(profitLoss(entry!, buyInChips)).toBe(0);
    expect(JSON.stringify(summary)).toBe(
      '{"__proto__":{"buyIns":1,"rebuys":0,"cashOuts":0,"invested":500,"cashedOut":0}}',
    );
    expect(checkInv1([bank, buyInChips])).toEqual({ ok: true });
  });

  it('handles empty event list and rejects invalid chip counts', () => {
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
    expect(summarizeLedger([])).toEqual({});

    const badEvent: LedgerEvent = {
      type: 'buy-in',
      playerId: 'hero',
      chips: { 5: -1, 10: 0, 50: 0, 100: 0 },
    };
    expect(() => summarizeLedger([badEvent])).toThrow(RangeError);
    expect(() =>
      profitLoss(
        { buyIns: 1, rebuys: 0, cashOuts: 0, invested: 500, cashedOut: 0 },
        { 5: 0.5, 10: 0, 50: 0, 100: 0 },
      ),
    ).toThrow(RangeError);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });
});
