import {
  chipValue,
  DENOMINATIONS,
  type BettingAction,
  type BoundaryErrorCode,
  type Card,
  type ChipCounts,
  type HandCategory,
  type HandErrorCode,
  type HandTimelineEvent,
  type Street,
} from '../../engine';
import type { SeatProfileInfo, TerminologyLanguage } from './types';

const RANK_LABELS: Readonly<Record<number, string>> = Object.freeze({
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
});

const SUIT_SYMBOLS: Readonly<Record<Card['suit'], string>> = Object.freeze({
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
});

const SUIT_NAMES_VI: Readonly<Record<Card['suit'], string>> = Object.freeze({
  s: 'Bích',
  h: 'Cơ',
  d: 'Rô',
  c: 'Chuồn',
});

export function formatCardRank(rank: Card['rank']): string {
  return RANK_LABELS[rank] ?? String(rank);
}

export function suitSymbol(suit: Card['suit']): string {
  return SUIT_SYMBOLS[suit];
}

export function suitNameVi(suit: Card['suit']): string {
  return SUIT_NAMES_VI[suit];
}

export function isRedSuit(suit: Card['suit']): boolean {
  return suit === 'h' || suit === 'd';
}

export function formatCardShort(card: Card): string {
  return `${formatCardRank(card.rank)}${suitSymbol(card.suit)}`;
}

export function formatCardAriaVi(card: Card): string {
  return `Lá ${formatCardRank(card.rank)} ${suitNameVi(card.suit)}`;
}

export function formatNumberVi(value: number): string {
  return value.toLocaleString('vi-VN');
}

export function formatPercentVi(ratio: number, digits = 1): string {
  const pct = ratio * 100;
  return `${pct.toFixed(digits).replace('.', ',')}%`;
}

export function formatEvVi(ev: number): string {
  const sign = ev > 0.05 ? '+' : ev < -0.05 ? '−' : '';
  const abs = Math.abs(ev).toFixed(1).replace('.', ',');
  return `${sign}${abs} điểm`;
}

export function formatChipBreakdown(chips: ChipCounts): string {
  const parts: string[] = [];
  for (const denom of DENOMINATIONS) {
    if (chips[denom] > 0) {
      parts.push(`${chips[denom]}×${denom}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '0 chip';
}

export function formatStreetLabel(street: Street, lang: TerminologyLanguage): string {
  if (lang === 'vi-bilingual') {
    switch (street) {
      case 'preflop':
        return 'Trước Flop (Preflop)';
      case 'flop':
        return 'Vòng Flop';
      case 'turn':
        return 'Vòng Turn';
      case 'river':
        return 'Vòng River';
    }
  }
  switch (street) {
    case 'preflop':
      return 'Preflop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
  }
}

export type TermKey =
  | 'fold'
  | 'check'
  | 'bet'
  | 'call'
  | 'raise'
  | 'allIn'
  | 'pot'
  | 'potOdds'
  | 'equity'
  | 'ev'
  | 'cap'
  | 'showdown'
  | 'declareEarly';

const EN_STANDARD_TERMS: Readonly<Record<TermKey, string>> = Object.freeze({
  fold: 'Fold',
  check: 'Check',
  bet: 'Bet',
  call: 'Call',
  raise: 'Raise',
  allIn: 'All-in',
  pot: 'Pot',
  potOdds: 'Pot odds',
  equity: 'Equity',
  ev: 'EV',
  cap: 'Cap',
  showdown: 'Showdown',
  declareEarly: 'Hô trước',
});

const VI_BILINGUAL_TERMS: Readonly<Record<TermKey, string>> = Object.freeze({
  fold: 'Bỏ bài (Fold)',
  check: 'Xem (Check)',
  bet: 'Cược (Bet)',
  call: 'Theo (Call)',
  raise: 'Tố (Raise)',
  allIn: 'Tất tay (All-in)',
  pot: 'Gà (Pot)',
  potOdds: 'Tỷ lệ Pot (Pot odds)',
  equity: 'Xác suất thắng (Equity)',
  ev: 'Giá trị kỳ vọng (EV)',
  cap: 'Trần cược (Cap)',
  showdown: 'Ngửa bài (Showdown)',
  declareEarly: 'Hô trước lượt',
});

export function tTerm(key: TermKey, lang: TerminologyLanguage): string {
  return lang === 'vi-bilingual' ? VI_BILINGUAL_TERMS[key] : EN_STANDARD_TERMS[key];
}

export function formatRaiseLabel(raiseTo: number, addedAmount: number, lang: TerminologyLanguage): string {
  const base = lang === 'vi-bilingual' ? 'Tố (Raise)' : 'Raise';
  return `${base} lên ${raiseTo} (+${addedAmount})`;
}

export function handCategoryVi(category: HandCategory): string {
  switch (category) {
    case 'high-card':
      return 'Mậu thầu (High card)';
    case 'pair':
      return 'Một đôi (Pair)';
    case 'two-pair':
      return 'Thú / Hai đôi (Two pair)';
    case 'three-of-a-kind':
      return 'Sám cô (Three of a kind)';
    case 'straight':
      return 'Sảnh (Straight)';
    case 'flush':
      return 'Thùng (Flush)';
    case 'full-house':
      return 'Cù lũ (Full house)';
    case 'four-of-a-kind':
      return 'Tứ quý (Four of a kind)';
    case 'straight-flush':
      return 'Thùng phá sảnh (Straight flush)';
  }
}

export function getPlayerName(
  playerId: string,
  seatProfiles: Readonly<Record<string, SeatProfileInfo>>,
): string {
  return seatProfiles[playerId]?.displayName ?? playerId;
}

export function formatBettingActionShort(
  action: BettingAction,
  lang: TerminologyLanguage,
  addedAmount?: number,
): string {
  switch (action.type) {
    case 'fold':
      return tTerm('fold', lang);
    case 'check':
      return tTerm('check', lang);
    case 'bet':
      return `${tTerm('bet', lang)} ${action.amount}`;
    case 'call':
      return `${tTerm('call', lang)} ${addedAmount ?? chipValue(action.chips)}`;
    case 'raise': {
      const added = addedAmount ?? chipValue(action.chips);
      return formatRaiseLabel(action.raiseTo, added, lang);
    }
  }
}

export function formatTimelineEventVi(
  event: HandTimelineEvent,
  seatProfiles: Readonly<Record<string, SeatProfileInfo>>,
  lang: TerminologyLanguage,
): string {
  const nameOf = (id: string): string => getPlayerName(id, seatProfiles);

  switch (event.type) {
    case 'ante-collected': {
      const allInNote =
        event.allInPlayerIds.length > 0
          ? ` (${event.allInPlayerIds.map(nameOf).join(', ')} all-in ngay sau ante)`
          : '';
      return `Thu ante ${event.antePerPlayer} điểm từ ${event.playerIds.length} người${allInNote}.`;
    }
    case 'cards-dealt':
      return `Chia 2 lá riêng. Dealer: ${nameOf(event.dealerPlayerId)} · Mở lời ván: ${nameOf(event.openerPlayerId)}.`;
    case 'street-dealt':
      return `Lật ${formatStreetLabel(event.street, lang)}: ${event.cards.map(formatCardShort).join(' ')}.`;
    case 'out-of-turn-declared':
      return `[Hô sớm · ${formatStreetLabel(event.street, lang)}] ${nameOf(event.playerId)} hô trước: ${formatBettingActionShort(event.action, lang)} (giữ ${chipValue(event.reservedChips)} điểm trước mặt, chưa vào pot).`;
    case 'out-of-turn-cancelled': {
      const reasonText =
        event.reason === 'bet-changed'
          ? `mức cược thay đổi${event.triggeredByPlayerId ? ` bởi ${nameOf(event.triggeredByPlayerId)}` : ''}`
          : event.reason === 'action-no-longer-legal'
            ? 'hành động không còn hợp lệ khi tới lượt'
            : event.reason === 'street-ended'
              ? 'vòng cược đã đóng'
              : 'ván đã kết thúc';
      const returned = chipValue(event.returnedChips);
      const returnNote = returned > 0 ? `, trả ${returned} điểm về stack` : '';
      return `[Hủy hô sớm · ${formatStreetLabel(event.street, lang)}] Lời hô ${formatBettingActionShort(event.action, lang)} của ${nameOf(event.playerId)} bị hủy (${reasonText}${returnNote}).`;
    }
    case 'player-action': {
      const prefix = event.fromOutOfTurn ? '[Hiệu lực hô sớm] ' : '';
      const allInSuffix = event.isAllIn ? ' (ALL-IN)' : '';
      const actionDesc = formatBettingActionShort(event.action, lang, event.addedAmount);
      return `${prefix}${nameOf(event.playerId)} ${actionDesc}${allInSuffix} · ${formatStreetLabel(event.street, lang)}.`;
    }
    case 'chip-exchange': {
      const targetName =
        event.target.kind === 'pot' ? 'Pot' : nameOf(event.target.playerId);
      return `Đổi chip: ${nameOf(event.fromPlayerId)} đưa ${formatChipBreakdown(event.give)} lấy ${formatChipBreakdown(event.receive)} từ ${targetName}.`;
    }
    case 'uncalled-refund':
      return `Hoàn cược không ai theo: trả ${event.amount} điểm cho ${nameOf(event.playerId)}.`;
    case 'fold-win':
      return `${nameOf(event.winnerId)} thắng pot ${event.amount} điểm vì mọi người đã fold (không phải show bài).`;
    case 'showdown': {
      const winners = event.resolution.totalPayouts
        .map((p) => `${nameOf(p.playerId)} (+${p.amount})`)
        .join(', ');
      return `Showdown hoàn tất. Phân chia pot: ${winners || 'không có'}.`;
    }
    case 'payout-pending':
      return `Chờ thanh toán pot: Pot đang thiếu mệnh giá chip lẻ để chia chính xác (${event.requiredPayouts.map((p) => `${nameOf(p.playerId)}: ${p.amount}`).join(', ')}).`;
    case 'payout-settled':
      return `Đã trả pot: ${event.transfers.map((t) => `${nameOf(t.playerId)} nhận ${t.amount} (${formatChipBreakdown(t.chips)})`).join(' · ')}.`;
  }
}

export function translateHandError(
  code: HandErrorCode,
  rawMessage: string,
): { readonly message: string; readonly guidance: string } {
  switch (code) {
    case 'chips-mismatch-amount':
      return {
        message: `Số chip đã chọn chưa khớp mức cược yêu cầu (${rawMessage}).`,
        guidance: 'Bấm thêm hoặc bỏ bớt chip trong khay cược sao cho tổng khớp đúng số cần bỏ.',
      };
    case 'insufficient-chips':
      return {
        message: `Stack hiện không đủ mệnh giá chip phù hợp (${rawMessage}).`,
        guidance: 'Mở nút "Đổi chip" để đổi chip lớn (50/100) lấy chip nhỏ (5/10) từ người chơi khác hoặc từ Pot.',
      };
    case 'insufficient-ante-denomination':
      return {
        message: `Có ghế thiếu chip mệnh giá 5 để đóng ante (${rawMessage}).`,
        guidance: 'Dùng nút "Đổi chip" ở ranh giới ván để đổi chip lớn lấy chip 5 trước khi chia ván mới.',
      };
    case 'insufficient-pot-denominations':
      return {
        message: `Pot chưa có đủ mệnh giá chip lẻ để trả chính xác (${rawMessage}).`,
        guidance: 'Mở "Đổi chip với Pot" để đổi chip lớn trong Pot lấy chip nhỏ từ stack người chơi, sau đó bấm "Thanh toán Pot".',
      };
    case 'cap-reached':
      return {
        message: 'Đã chạm trần cược (cap) của street này.',
        guidance: 'Không thể raise thêm ở street hiện tại — bạn chỉ có thể Call hoặc Fold.',
      };
    case 'cannot-check-facing-bet':
      return {
        message: 'Không thể Check khi đã có người bet/raise.',
        guidance: 'Hãy chọn Call đúng mức cược, Raise trong phạm vi cap, hoặc Fold.',
      };
    case 'cannot-bet-when-bet-exists':
      return {
        message: 'Đã có mức cược hiện hành trên street này.',
        guidance: 'Dùng Call hoặc Raise thay vì Bet.',
      };
    case 'cannot-bet-without-active-opponent':
    case 'cannot-raise-without-active-opponent':
      return {
        message: 'Không thể bet/raise thêm vì các đối thủ còn lại đều đã All-in.',
        guidance: 'Hãy chọn Check hoặc Call để mở hết bài chung tới showdown.',
      };
    case 'cannot-call-without-bet':
      return {
        message: 'Chưa có ai đặt cược nên không cần Call.',
        guidance: 'Hãy chọn Check hoặc Bet.',
      };
    case 'cannot-raise-without-bet':
      return {
        message: 'Chưa có mức cược trước đó để Raise.',
        guidance: 'Hãy chọn Bet thay vì Raise.',
      };
    case 'invalid-amount':
      return {
        message: `Số điểm cược không hợp lệ (${rawMessage}).`,
        guidance: 'Khoản cược phải là bội số của 5 và nằm trong giới hạn cap street hiện hành.',
      };
    case 'declaration-binding':
      return {
        message: 'Không thể rút lời hô trước khi mức cược chưa thay đổi (luật X6).',
        guidance: 'Lời hô sẽ tự thực hiện khi tới lượt, hoặc tự hủy và trả chip về stack nếu có đối thủ bet/raise.',
      };
    case 'declaration-already-active':
      return {
        message: 'Bạn đã có một lời hô trước đang chờ hiệu lực.',
        guidance: 'Chờ tới lượt hoặc chờ mức cược thay đổi.',
      };
    case 'no-upcoming-turn':
      return {
        message: 'Bạn đã khớp mức cược hiện tại nên chưa có lượt tiếp theo để hô trước.',
        guidance: 'Chỉ có thể hô trước khi bạn vẫn còn lượt hành động trên street này.',
      };
    case 'out-of-turn-disabled':
      return {
        message: 'Tính năng hô trước lượt đang tắt trong Cài đặt.',
        guidance: 'Bật "Hô sớm trước lượt" trong Cài đặt để áp dụng ở ván tiếp theo.',
      };
    case 'zero-stack-seat':
      return {
        message: `Có ghế còn 0 chip nên chưa thể thu ante (${rawMessage}).`,
        guidance: 'Cho ghế hết chip Rebuy 500 hoặc Rời bàn ở ranh giới trước khi chia ván mới.',
      };
    case 'invalid-exchange':
      return {
        message: `Phép đổi chip không hợp lệ (${rawMessage}).`,
        guidance: 'Tổng giá trị chip đưa ra và chip nhận về phải lớn hơn 0 và bằng nhau chính xác.',
      };
    case 'not-players-turn':
      return {
        message: 'Chưa tới lượt hành động của bạn.',
        guidance: 'Chờ đối thủ hành động hoặc dùng "Hô trước" nếu được phép.',
      };
    case 'is-players-turn':
      return {
        message: 'Đang là lượt trực tiếp của bạn.',
        guidance: 'Hãy xác nhận hành động trực tiếp thay vì hô trước.',
      };
    default:
      return {
        message: `Engine từ chối thao tác (${code}): ${rawMessage}`,
        guidance: 'Kiểm tra lại trạng thái bàn, số chip hiện có hoặc thử đổi chip trước khi tiếp tục.',
      };
  }
}

export function translateBoundaryError(
  code: BoundaryErrorCode,
  rawMessage: string,
): { readonly message: string; readonly guidance: string } {
  switch (code) {
    case 'hand-not-complete':
      return {
        message: 'Ván hiện tại chưa hoàn tất thanh toán pot.',
        guidance: 'Hoàn tất ván hoặc đổi chip với Pot để thanh toán xong trước khi rebuy/rời bàn.',
      };
    case 'stack-not-empty':
      return {
        message: 'Chỉ người chơi còn 0 chip mới được rebuy 500 theo luật hiện hành.',
        guidance: 'Tiếp tục chơi bằng stack hiện có hoặc cash out giữa hai ván.',
      };
    case 'plan-failed':
      return {
        message: `Kho chip và bàn hiện không tạo được đúng 500 điểm (${rawMessage}).`,
        guidance: 'Kiểm tra kho chip 6.500 điểm hoặc đổi mệnh giá chip ở người có stack lớn nhất trước khi thử lại.',
      };
    case 'table-full':
      return {
        message: 'Bàn đã đủ tối đa 10 người chơi.',
        guidance: 'Cash out một rival trước nếu muốn mời người khác vào bàn.',
      };
    case 'duplicate-player':
      return {
        message: 'Người chơi này đã ngồi sẵn trên bàn.',
        guidance: 'Chọn một rival khác chưa ngồi bàn.',
      };
    default:
      return {
        message: `Lỗi ranh giới ván (${code}): ${rawMessage}`,
        guidance: 'Kiểm tra lại danh sách ghế và số chip trước khi bắt đầu ván mới.',
      };
  }
}
