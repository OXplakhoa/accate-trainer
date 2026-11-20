import {
  calculatePotOdds,
  exactHitProbability,
  unseenCardCountForStreet,
  type DecisionSnapshot,
  type PotOddsResult,
} from '../calculator';
import { formatCard, type Card, type Suit } from '../cards';
import { BET_STEP, type AmountRange } from '../handTypes';
import type { RivalId } from '../rivals';
import type {
  BoardTextureAnalysis,
  BoardTextureClass,
  DrawChaseCapAnalysis,
  DrillSizingAnalysis,
} from './types';

function formatPercentVi(ratio: number, decimals = 2): string {
  const pct = ratio * 100;
  const fixed = pct.toFixed(decimals).replace(/\.00$/, '');
  return `${fixed.replace('.', ',')}%`;
}

function enumerateAmountRange(range: AmountRange | null): readonly number[] {
  if (range === null) {
    return Object.freeze([]);
  }
  const amounts: number[] = [];
  for (let amt = range.min; amt <= range.max; amt += range.step) {
    amounts.push(amt);
  }
  return Object.freeze(amounts);
}

/**
 * Classifies a revealed board (0, 3, 4, or 5 cards) into `'dry' | 'wet' | 'draw-heavy'`
 * and describes what a bet/raise represents across all 9 rival profiles
 * (spec §6.1, §10 #7, Hopkins L5 slide 23–25, L8 slide 18).
 */
export function analyzeBoardTexture(board: readonly Card[]): BoardTextureAnalysis {
  if (board.length === 0) {
    const preflopRivalRep: Record<RivalId, string> = {
      da: 'Đá: chỉ bet/raise với đôi lớn (AA–QQ) hoặc AK.',
      ca: 'Cá: call rộng hầu hết hai lá bất kỳ, hiếm khi raise.',
      cao: 'Cáo: mở cược với nhóm bài chọn lọc (đôi, broadway, suited connectors).',
      soi: 'Sói: gây áp lực rộng ngay từ trước flop.',
      dien: 'Điên: đẩy lên cap với range rất rộng gồm cả bài rác.',
      'dai-gia': 'Đại gia: theo cược với mọi bài đồng chất hoặc có liên kết.',
      tho: 'Thỏ: thận trọng, dễ fold nếu bị raise.',
      bay: 'Bẫy: có thể limp/check đôi lớn để gài bẫy.',
      nong: 'Nóng: chắc tay khi bình thường; đẩy cap liên tục khi đang tilt.',
    };
    return Object.freeze({
      classification: 'dry',
      labelVi: 'Trước flop (chưa có lá chung)',
      paired: false,
      maxSuitCount: 0,
      connectivityScore: 0,
      flushDrawPossible: false,
      straightDrawPossible: false,
      explanationVi: 'Chưa lật flop nên chưa có kết cấu mặt bài chung.',
      rivalRepresentationVi: Object.freeze(preflopRivalRep),
    });
  }

  const suitCounts: Record<Suit, number> = { s: 0, h: 0, d: 0, c: 0 };
  const rankCounts = new Map<number, number>();
  let rankMask = 0;

  for (const card of board) {
    suitCounts[card.suit] += 1;
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
    rankMask |= 1 << card.rank;
    if (card.rank === 14) {
      rankMask |= 1 << 1;
    }
  }

  const maxSuitCount = Math.max(suitCounts.s, suitCounts.h, suitCounts.d, suitCounts.c);
  const paired = Array.from(rankCounts.values()).some((c) => c >= 2);
  const flushDrawPossible = maxSuitCount >= 2;

  // Measure straight connectivity: count maximum cards inside any 5-rank straight window
  let maxCardsInWindow = 0;
  let windowsWith3OrMore = 0;
  let windowsWith2Close = 0;

  for (let high = 14; high >= 5; high--) {
    let countInWindow = 0;
    for (let r = high - 4; r <= high; r++) {
      if ((rankMask & (1 << r)) !== 0) {
        countInWindow += 1;
      }
    }
    if (countInWindow > maxCardsInWindow) {
      maxCardsInWindow = countInWindow;
    }
    if (countInWindow >= 3) {
      windowsWith3OrMore += 1;
    } else if (countInWindow === 2) {
      windowsWith2Close += 1;
    }
  }

  // Also check minimum rank gap between distinct ranks
  const distinctRanks = Array.from(rankCounts.keys()).sort((a, b) => a - b);
  let closeGapCount = 0;
  for (let i = 1; i < distinctRanks.length; i++) {
    const gap = distinctRanks[i]! - distinctRanks[i - 1]!;
    if (gap <= 2) {
      closeGapCount += 1;
    }
  }

  const straightDrawPossible = maxCardsInWindow >= 2 && (closeGapCount >= 1 || windowsWith3OrMore >= 1);
  const connectivityScore =
    windowsWith3OrMore * 3 + closeGapCount * 2 + (maxSuitCount >= 3 ? 4 : maxSuitCount === 2 ? 2 : 0);

  let classification: BoardTextureClass;
  let labelVi: string;

  if (
    maxSuitCount >= 3 ||
    (maxSuitCount >= 2 && (maxCardsInWindow >= 3 || closeGapCount >= 2)) ||
    windowsWith3OrMore >= 3
  ) {
    classification = 'draw-heavy';
    labelVi = 'Nhiều draw (Draw-heavy)';
  } else if (maxSuitCount === 2 || maxCardsInWindow >= 3 || closeGapCount >= 1 || windowsWith2Close >= 3) {
    classification = 'wet';
    labelVi = 'Mặt bài ướt (Wet)';
  } else {
    classification = 'dry';
    labelVi = 'Mặt bài khô (Dry)';
  }

  const boardStr = board.map(formatCard).join(' ');
  const suitNote =
    maxSuitCount >= 3
      ? `có ${maxSuitCount} lá đồng chất (thùng hoặc mua thùng 1 lá đã hiện hữu)`
      : maxSuitCount === 2
        ? 'có 2 lá đồng chất (mở ra flush draw 9 outs)'
        : 'rainbow (khác chất, không có flush draw)';
  const straightNote =
    maxCardsInWindow >= 3
      ? 'các lá kết nối sát nhau tạo nhiều sảnh / combo draw'
      : straightDrawPossible
        ? 'có khe nối sảnh (open-ended / gutshot)'
        : 'các lá rời rạc, rất ít sảnh';
  const pairNote = paired ? ', mặt bài có đôi' : '';

  const explanationVi = `Board [${boardStr}] thuộc nhóm ${labelVi}: ${suitNote}, ${straightNote}${pairNote} (Hopkins L5 slide 23–25).`;

  const rivalRepresentationVi: Record<RivalId, string> = {
    da:
      classification === 'dry'
        ? 'Đá (Nit) bet/raise trên mặt khô = bài value rất mạnh (set, hai đôi, overpair lớn), gần như 0% bluff.'
        : 'Đá (Nit) bet/raise trên mặt ướt/nhiều draw = bài made hand cực mạnh muốn bảo vệ, hiếm khi semi-bluff.',
    ca: 'Cá (Calling station) call với mọi đôi nhỏ, gutshot hoặc overcard; nếu Cá chủ động raise thì coi chừng bài hai đôi/set trở lên.',
    cao:
      classification === 'dry'
        ? 'Cáo (TAG) bet chọn lọc: top pair kicker tốt trở lên và một phần nhỏ bluff có chọn lọc.'
        : 'Cáo (TAG) bet/raise gồm bài value mạnh (top pair+, hai đôi, set) kết hợp semi-bluff bằng flush draw / open-ended.',
    soi:
      classification === 'dry'
        ? 'Sói (LAG) tận dụng mặt khô để bluff tần suất cao cùng các bài đôi trung bình–mạnh.'
        : 'Sói (LAG) gây áp lực mạnh bằng mọi draw (flush draw, gutshot, combo draw) lẫn bài value.',
    dien: 'Điên (Maniac) đẩy mức cược gần cap 50 bất kể mặt bài khô hay ướt: range rất rộng gồm bài mạnh, mọi draw và rất nhiều bluff.',
    'dai-gia':
      classification === 'dry'
        ? 'Đại gia (Whale) vẫn theo cược bằng đôi yếu hoặc bài cao.'
        : 'Đại gia (Whale) không bỏ bất kỳ flush draw, gutshot hay đôi nhỏ nào trên mặt bài có draw.',
    tho: 'Thỏ (Weak-tight) chỉ dám bet khi cầm bài khá chắc và sẽ fold phần lớn bài một đôi nếu bị raise trên mặt bài nguy hiểm.',
    bay:
      classification === 'dry'
        ? 'Bẫy (Slowplay) hay check gài set/hai đôi trên mặt khô rồi check-raise ở cuối vòng hoặc turn.'
        : 'Bẫy (Slowplay) khi check-raise trên mặt ướt đại diện cho nhóm bài cực mạnh (set, hai đôi, sảnh/thùng hoặc combo draw lớn).',
    nong: 'Nóng (Tilter): khi bình thường đại diện bài value chắc tay như Cáo; khi đang tilt thì bet/raise cap 50 với cả draw yếu và bluff ngẫu nhiên.',
  };

  return Object.freeze({
    classification,
    labelVi,
    paired,
    maxSuitCount,
    connectivityScore,
    flushDrawPossible,
    straightDrawPossible,
    explanationVi,
    rivalRepresentationVi: Object.freeze(rivalRepresentationVi),
  });
}

/**
 * Analyzes legal Accate sizing vs tactical sizing and evaluates whether the street cap (50)
 * can price out a 9-out flush draw (AC D8, Spec §6.1, Hopkins L2 slide 18–20).
 */
export function analyzeBetSizing(
  snapshot: DecisionSnapshot,
  equity: number,
  potOdds: PotOddsResult,
): DrillSizingAnalysis {
  const legal = snapshot.legalActions;
  const canBet = legal?.canBet ?? false;
  const canRaise = legal?.canRaise ?? false;
  const legalBetAmounts = enumerateAmountRange(legal?.betRange ?? null);
  const legalRaiseToAmounts = enumerateAmountRange(legal?.raiseRange ?? null);

  // Compute maximum aggressive contribution hero could put in on this street under cap & stack
  const maxHeroBetOrRaiseTo = canBet
    ? (legal?.betRange?.max ?? Math.min(snapshot.streetCap, snapshot.heroStack))
    : canRaise
      ? (legal?.raiseRange?.max ??
        Math.min(snapshot.streetCap, snapshot.heroStreetContribution + snapshot.heroStack))
      : 0;

  const maxHeroAddedAmount = canBet || canRaise ? Math.max(0, maxHeroBetOrRaiseTo - snapshot.heroStreetContribution) : 0;

  // Base pot before hero's hypothetical bet/raise
  const potBeforeHeroBet = snapshot.potBeforeCall;
  const potSeenByOpponent = potBeforeHeroBet + maxHeroAddedAmount;
  const opponentCallAmount =
    !canBet && !canRaise ? 0 : snapshot.currentBet === 0
      ? maxHeroBetOrRaiseTo
      : Math.max(BET_STEP, maxHeroBetOrRaiseTo - snapshot.currentBet);
  const opponentPotAfterCall = potSeenByOpponent + opponentCallAmount;
  const opponentPotOdds = calculatePotOdds({
    potBeforeCall: potSeenByOpponent,
    callAmount: opponentCallAmount,
  });

  const postflopStreet = snapshot.street === 'preflop' ? 'flop' : snapshot.street;
  const flushDrawOuts = 9;
  const flushDrawUnseenCards = unseenCardCountForStreet(postflopStreet);
  const flushDrawExactEquity =
    snapshot.street === 'river'
      ? 0
      : exactHitProbability(flushDrawOuts, flushDrawUnseenCards, 1);
  const flushDrawExactEquityPercent = flushDrawExactEquity * 100;
  const opponentRequiredEquity = opponentPotOdds.requiredEquity;
  const opponentRequiredEquityPercent = opponentPotOdds.requiredEquityPercent;

  const canPriceOutFlushDrawWithCap =
    (canBet || canRaise) && snapshot.street !== 'river' && opponentRequiredEquity > flushDrawExactEquity;

  const reqPctVi = formatPercentVi(opponentRequiredEquity, 1);
  const fdPctVi = formatPercentVi(flushDrawExactEquity, 2);

  const drawChaseExplanationVi =
    !canBet && !canRaise
      ? 'Không có Bet hoặc Raise hợp lệ; không tính giá theo cược giả định.'
      : snapshot.street === 'river'
      ? `Ở river không còn lá chưa lật (0 outs mua bài); kích thước cược tối đa dưới cap ${snapshot.streetCap} chỉ nhằm lấy value hoặc bluff.`
      : canPriceOutFlushDrawWithCap
        ? `Với pot ${potBeforeHeroBet}, nếu đặt mức tối đa ${maxHeroBetOrRaiseTo} (cap ${snapshot.streetCap}), đối thủ thấy pot/call = ${potSeenByOpponent}/${opponentCallAmount} (${opponentPotOdds.potToCallLabel}) và cần ${reqPctVi} equity > ${fdPctVi} (${flushDrawOuts}/${flushDrawUnseenCards}) của flush draw 1 lá → đủ giá để buộc flush draw mua sai pot odds.`
        : `Pot hiện tại là ${potBeforeHeroBet} trước khi cược; dù hero bet/raise tối đa ${maxHeroBetOrRaiseTo} (chạm cap ${snapshot.streetCap}), đối thủ thấy ${potSeenByOpponent}/${opponentCallAmount} (${opponentPotOdds.potToCallLabel}) và chỉ cần equity = ${opponentCallAmount}/${opponentPotAfterCall} = ${reqPctVi} < ${fdPctVi} (~${(flushDrawExactEquityPercent).toFixed(1).replace('.', ',')}%, tức ${flushDrawOuts}/${flushDrawUnseenCards}) của flush draw → không thể đuổi draw bằng cap ${snapshot.streetCap}; khác với Hopkins L2 slide 18–20 (No-Limit có thể bet > 1/3–1/2 pot). Cú bet ${maxHeroBetOrRaiseTo} ở đây có ý nghĩa lấy tối đa value từ draw, không phải để ép draw fold.`;

  const drawChaseAnalysis: DrawChaseCapAnalysis = Object.freeze({
    potBeforeHeroBet,
    maxHeroBetOrRaiseTo,
    maxHeroAddedAmount,
    potSeenByOpponent,
    opponentCallAmount,
    opponentPotAfterCall,
    opponentPotToCallLabel: `${potSeenByOpponent}/${opponentCallAmount}`,
    opponentRequiredEquity,
    opponentRequiredEquityPercent,
    flushDrawOuts,
    flushDrawUnseenCards,
    flushDrawExactEquity,
    flushDrawExactEquityPercent,
    canPriceOutFlushDrawWithCap,
    explanationVi: drawChaseExplanationVi,
    lectureContrastRef: 'Hopkins L2 slide 18–20',
  });

  // Legal sizing description (strictly separating rule legality from tactical choice)
  let legalBoundsDetailVi: string;
  if (canBet && legal?.betRange) {
    legalBoundsDetailVi = `Được Bet bội số của ${BET_STEP} từ ${legal.betRange.min} đến ${legal.betRange.max} (cap street = ${snapshot.streetCap}, đã góp ${snapshot.heroStreetContribution}, còn được bỏ tối đa ${snapshot.remainingCapAllowance}, stack hiện có ${snapshot.heroStack}).`;
  } else if (canRaise && legal?.raiseRange) {
    legalBoundsDetailVi = `Đang đối mặt mức cược ${snapshot.currentBet} (cần thêm ${snapshot.callAmount} để Call); được Raise lên bội số của ${BET_STEP} từ ${legal.raiseRange.min} đến ${legal.raiseRange.max} (cap street = ${snapshot.streetCap}, còn được bỏ thêm tối đa ${snapshot.remainingCapAllowance}).`;
  } else if (snapshot.toCall > 0) {
    legalBoundsDetailVi = `Mức cược hiện hành đã chạm ${snapshot.currentBet} (cap street = ${snapshot.streetCap}); theo luật Accate chỉ còn Call ${snapshot.callAmount} hoặc Fold, không được Raise vượt cap.`;
  } else {
    legalBoundsDetailVi = `Chỉ có thể Check hoặc Fold (stack còn ${snapshot.heroStack}, cap street = ${snapshot.streetCap}).`;
  }

  const legalSizingVi = `Kích thước hợp lệ theo luật: ${legalBoundsDetailVi} Mọi khoản bỏ vào pot phải ghép đúng từ 4 mệnh giá chip vật lý (5, 10, 50, 100).`;

  // Tactical sizing recommendation & description
  let recommendedSizingTarget: number | null = null;
  let tacticalSizingVi: string;

  if (canBet && legal?.betRange) {
    if (equity >= 0.58) {
      recommendedSizingTarget = legal.betRange.max;
      tacticalSizingVi = `Ý nghĩa chiến thuật: Bài có equity cao (${formatPercentVi(equity, 1)}) → ưu tiên Value Bet mức lớn (${recommendedSizingTarget} điểm, tối đa dưới cap ${snapshot.streetCap}) để thu tối đa chip từ bài yếu hơn và thu phí các bài mua (draw). ${!canPriceOutFlushDrawWithCap ? 'Lưu ý vì pot đã lớn so với cap 50 nên mục tiêu là thu value chứ không thể đuổi flush draw.' : ''}`.trim();
    } else if (equity >= 0.42) {
      const mid = Math.round(((legal.betRange.min + legal.betRange.max) / 2) / BET_STEP) * BET_STEP;
      recommendedSizingTarget = Math.min(legal.betRange.max, Math.max(legal.betRange.min, mid));
      tacticalSizingVi = `Ý nghĩa chiến thuật: Bài trung bình–khá / semi-bluff (equity ${formatPercentVi(equity, 1)}) → chọn cỡ cược vừa (${recommendedSizingTarget} điểm) để vừa lấy value từ bài yếu/draw vừa kiểm soát rủi ro dưới cap ${snapshot.streetCap}.`;
    } else {
      recommendedSizingTarget = null;
      tacticalSizingVi = `Ý nghĩa chiến thuật: Equity hiện tại thấp (${formatPercentVi(equity, 1)}) → ưu tiên Check kiểm soát pot thay vì tự bỏ thêm chip vào pot không cần thiết.`;
    }
  } else if (canRaise && legal?.raiseRange) {
    if (equity >= 0.64) {
      recommendedSizingTarget = legal.raiseRange.max;
      tacticalSizingVi = `Ý nghĩa chiến thuật: Equity vượt trội (${formatPercentVi(equity, 1)} so với pot odds ${formatPercentVi(potOdds.requiredEquity, 1)}) → có thể Raise value lên ${recommendedSizingTarget} (sát cap ${snapshot.streetCap}) để tối đa hóa pot ngay trên street này.`;
    } else if (equity >= potOdds.requiredEquity) {
      recommendedSizingTarget = null;
      tacticalSizingVi = `Ý nghĩa chiến thuật: Equity (${formatPercentVi(equity, 1)}) đủ tốt để Call ${snapshot.callAmount} (cần ${formatPercentVi(potOdds.requiredEquity, 1)}), nhưng chưa đủ áp đảo để Raise phóng đại pot — ưu tiên Call giữ lại phần bluff/bài yếu trong range đối thủ.`;
    } else {
      recommendedSizingTarget = null;
      tacticalSizingVi = `Ý nghĩa chiến thuật: Equity (${formatPercentVi(equity, 1)}) thấp hơn pot odds cần thiết (${formatPercentVi(potOdds.requiredEquity, 1)}) → ưu tiên Fold bảo toàn chip, không nên Raise tốn thêm chi phí.`;
    }
  } else {
    tacticalSizingVi =
      snapshot.toCall > 0
        ? `Ý nghĩa chiến thuật: Đã chạm cap ${snapshot.streetCap} nên bài toán thuần túy là so sánh Equity (${formatPercentVi(equity, 1)}) với Pot Odds (${formatPercentVi(potOdds.requiredEquity, 1)} = ${potOdds.potToCallLabel}) để chọn Call hay Fold.`
        : 'Ý nghĩa chiến thuật: Không có chi phí call → Check miễn phí để xem lá tiếp theo hoặc đi tới showdown.';
  }

  return Object.freeze({
    street: snapshot.street,
    streetCap: snapshot.streetCap,
    currentBet: snapshot.currentBet,
    heroStreetContribution: snapshot.heroStreetContribution,
    remainingCapAllowance: snapshot.remainingCapAllowance,
    heroStack: snapshot.heroStack,
    canBet,
    legalBetAmounts,
    canRaise,
    legalRaiseToAmounts,
    recommendedSizingTarget,
    legalSizingVi,
    tacticalSizingVi,
    drawChaseAnalysis,
  });
}
