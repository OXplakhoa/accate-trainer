import { parseCard, parseCards } from '../cards';
import { DRILL_CONCEPT_IDS, type DrillConceptId, type DrillLesson } from './types';

export const DRILL_CONCEPT_TITLES_VI: Readonly<Record<DrillConceptId, string>> = Object.freeze({
  outs: 'Đếm Outs & Outs bẩn',
  'hit-percent': 'Quy Outs ra % trúng (Rule of 2 & 4)',
  'pot-odds': 'Pot Odds & Equity cần',
  'ev-comparison': 'So sánh Equity vs Pot Odds & EV',
  'rival-range': 'Equity theo Range Rival & Tilt',
  'board-texture': 'Đọc Board Texture & Vị trí',
  'bet-sizing': 'Bet Sizing & Giá để đuổi Draw (Cap 50)',
});

export const DRILL_LESSONS: Readonly<Record<DrillConceptId, DrillLesson>> = Object.freeze({
  outs: Object.freeze({
    conceptId: 'outs',
    orderIndex: 1,
    titleVi: 'Bài 1: Đếm Outs sạch, Outs bẩn và Lá cải thiện bài',
    subtitleVi:
      'Phân biệt lá chỉ nâng hạng bài 5 lá với lá thật sự giúp bạn thắng trước range đối thủ trên bàn Accate.',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze(['Hopkins L2 slide 24–27', 'L9 slide 13–22']),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Lá cải thiện bài khác với Outs thắng như thế nào?',
        paragraphsVi: Object.freeze([
          'Lá cải thiện bài (improving card) là lá làm hạng bài 5 lá mạnh nhất của bạn tăng lên (ví dụ từ một đôi lên bộ ba / set, hoặc từ bài cao lên một đôi).',
          'Trong khi đó, Outs (Hopkins L2 slide 24–27) là những lá chưa lật giúp bạn LẬT THẾ từ đang thua/hòa thành THẮNG trước bài hoặc range giả định của đối thủ.',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Clean Outs, Mixed/Dirty Outs (Outs bẩn) và Chop Outs',
        paragraphsVi: Object.freeze([
          '• Clean outs (Outs sạch): Lá giúp bạn thắng 100% trước toàn bộ các combo hợp lệ trong range đối thủ.',
          '• Mixed / Dirty outs (Outs bẩn): Lá giúp bài bạn mạnh lên nhưng đồng thời hoàn thành bài còn mạnh hơn cho một phần range đối thủ. Ví dụ: bạn mua thùng cơ trên flop K♥ 7♥ Q♣ thì lá Q♥ ghép đôi bàn, giúp đối thủ cầm K-Q hoặc K-K lên Cù lũ (Full House); hoặc bạn cầm J♠ J♦ trên flop 9♥ 7♥ 2♣ thì lá J♥ giúp bạn lên set J nhưng lại hoàn thành thùng cơ cho đối thủ cầm 8♥ 6♥.',
          '• Chop outs: Lá giúp bạn san bằng bài với đối thủ để chia pot. Lưu ý trên bàn Accate, khi hòa ở showdown mặc định hai bên sẽ rút Bài cào 3 lá để phân thắng bại (hoặc chia đều tuỳ cài đặt).',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate: Mua Thùng có lá ghép đôi bàn (Flop K♥ 7♥ Q♣)',
      setupVi:
        'Bàn 4 người đóng ante 5 (pot 20). Trên flop K♥ 7♥ Q♣, Đá (Tight-passive — bet là có bài thật như KQ, AK, KK, 77) bet 30 đưa pot lên 50. Bạn cầm A♥ 9♥.',
      heroCards: Object.freeze([parseCard('Ah'), parseCard('9h')] as const),
      board: Object.freeze(parseCards('Kh 7h Qc')),
      potBeforeCall: 50,
      callAmount: 30,
      streetCap: 50,
      rivalId: 'da',
      calculationStepsVi: Object.freeze([
        'Bộ bài có 13 lá cơ (♥); bạn giữ 2 lá (A♥, 9♥) và bàn có 2 lá (K♥, 7♥) → còn 9 lá cơ chưa lật.',
        'Tuy nhiên lá Q♥ sẽ ghép đôi với Q♣ trên bàn, giúp các combo K-Q, K-K, 7-7 của Đá tạo thành Cù lũ (Full House) thắng cả Thùng A của bạn → Q♥ là mixed/dirty out!',
        '8 lá cơ còn lại (J♥, T♥, 8♥, 6♥, 5♥, 4♥, 3♥, 2♥) tạo Thùng A trên mặt bài không đôi → đúng 8 clean outs thắng sạch 100% range của Đá.',
      ]),
      takeawayVi:
        'Khi đếm outs để thắng trước range đối thủ, luôn trừ các lá ghép đôi bàn hoặc hoàn thành thùng/sảnh cao hơn cho đối thủ (Hopkins L2 slide 24–27).',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Bạn cầm A♥ 9♥ trên flop K♥ 7♥ Q♣ trước Đá (range hẹp gồm KQ, KK, 77, AK). Số clean outs thắng sạch 100% của bạn ở lá tiếp theo là bao nhiêu?',
      optionsVi: Object.freeze([
        '8 clean outs (9 lá cơ trừ lá Q♥ vì Q♥ ghép đôi bàn cho Đá lên Cù lũ)',
        '9 clean outs (mọi lá cơ còn lại trong bộ bài đều thắng sạch)',
        '12 clean outs (9 lá cơ cộng thêm 3 lá A khác chất)',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Trong 9 lá cơ chưa lật, lá Q♥ ghép đôi Q♣ trên bàn khiến bạn vẫn thua K-Q/K-K/77 (Full House), nên chỉ có 8 clean outs thật sự thắng sạch.',
    }),
  }),

  'hit-percent': Object.freeze({
    conceptId: 'hit-percent',
    orderIndex: 2,
    titleVi: 'Bài 2: Quy Outs ra % trúng (1 lá, tới River & Rule of 2 & 4)',
    subtitleVi:
      'Tính xác suất chính xác và nhẩm nhanh trên bàn bằng Rule of 2 & 4 (kèm bản chỉnh khi > 8 outs).',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze(['Hopkins L7 slide 6', 'L7 slide 8–9', 'L2 slide 24–27']),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Công thức chính xác ở Flop (47 lá) và Turn (46 lá)',
        paragraphsVi: Object.freeze([
          'Tại Flop bạn biết 5 lá (2 lá riêng + 3 lá flop) nên còn đúng 47 lá chưa biết. Tại Turn bạn biết 6 lá nên còn đúng 46 lá chưa biết.',
          '• Xác suất trúng ở 1 lá tiếp theo: outs / 47 (từ flop lên turn) hoặc outs / 46 (từ turn lên river).',
          '• Xác suất trúng ít nhất 1 lá từ Flop tới River (2 lá rút không hoàn lại): 1 − C(47 − outs, 2) / C(47, 2) = 1 − ((47 − outs) × (46 − outs)) / (47 × 46).',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Nhẩm nhanh bằng Rule of 2 & 4 và bản chỉnh > 8 outs',
        paragraphsVi: Object.freeze([
          '• Rule of 2 (1 lá sắp ra): Xác suất ≈ 2 × outs (%). Ví dụ 2 outs → 4% (chính xác 2/47 = 4,26%); 9 outs ở turn → 18% (chính xác 9/46 = 19,57%).',
          '• Rule of 4 (2 lá từ flop tới river, Hopkins L7 slide 6): Với outs ≤ 8, xác suất ≈ 4 × outs (%). Khi outs > 8, trừ đi (outs − 8)%: Xác suất ≈ 4 × outs − (outs − 8) (%). Ví dụ combo draw 14 outs: 4×14 − (14−8) = 50% (chính xác 51,25%).',
          '• Nguyên tắc sống còn: % gặp thêm lá cải thiện KHÔNG phải là xác suất thắng ván (equity)! Đôi lớn có thể chỉ có 2 outs lên set (8,42% tới river) nhưng vẫn có equity thắng > 60% trước range bluff/draw của đối thủ.',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate (H1 #7): Đôi J♠J♦ trên Flop 9♥7♥2♣',
      setupVi:
        'Bàn 6 người đóng ante 5 (pot 30). Flop lật 9♥ 7♥ 2♣. A (Cá) bet 10, B (Điên) raise lên 30 (+20) đưa pot lên 70. Bạn (Hero C) cầm J♠ J♦.',
      heroCards: Object.freeze([parseCard('Js'), parseCard('Jd')] as const),
      board: Object.freeze(parseCards('9h 7h 2c')),
      potBeforeCall: 70,
      callAmount: 30,
      streetCap: 50,
      rivalId: 'dien',
      calculationStepsVi: Object.freeze([
        'Số lá giúp J♠ J♦ cải thiện lên bộ ba (set J): 2 lá (J♥, J♣) trong 47 lá chưa biết.',
        '% trúng thêm J ở Turn: 2 / 47 = 4,26% (Rule of 2: 2 × 2% = 4%).',
        '% trúng thêm J tới River: 1 − (45 × 44) / (47 × 46) = 182 / 2162 = 8,42% (Rule of 4: 2 × 4% = 8%).',
        'Lưu ý: 8,42% chỉ là xác suất gặp thêm lá J để lên set, KHÔNG phải xác suất thắng! Vì J-J đã là overpair trên 9-7-2 nên equity thắng trước range rất rộng của Điên cao hơn nhiều.',
      ]),
      takeawayVi:
        'Luôn tách bạch xác suất gặp lá cải thiện (8,42% lên set J) khỏi equity thắng thực tế trước range của đối thủ (AC H1 #7).',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Trong ván H1 #7 (cầm J♠ J♦ trên flop 9♥ 7♥ 2♣), xác suất chính xác gặp thêm lá J ở Turn và tới River lần lượt là bao nhiêu?',
      optionsVi: Object.freeze([
        'Turn: 2/47 ≈ 4,26% · Tới River: 1 − (45·44)/(47·46) ≈ 8,42% (Rule of 4 = 8%)',
        'Turn: 2/52 ≈ 3,85% · Tới River: 4/52 ≈ 7,69%',
        'Turn: 4/47 ≈ 8,51% · Tới River: 16%',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Còn 47 lá chưa biết ở flop và 2 lá J (J♥, J♣), nên turn là 2/47 ≈ 4,26% và tới river là 1 − (45·44)/(47·46) ≈ 8,42% (Rule of 4 cho 8%).',
    }),
  }),

  'pot-odds': Object.freeze({
    conceptId: 'pot-odds',
    orderIndex: 3,
    titleVi: 'Bài 3: Pot Odds (Equity cần để Call) & Side Pot trên bàn Accate',
    subtitleVi:
      'Tính nhanh % equity hòa vốn và tỷ lệ x-to-1 trong cấu trúc pot có ante 5 và cap 50 mỗi street.',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze(['Hopkins L2 slide 12–15', 'L7 slide 7–9']),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Công thức Pot Odds (% chính và tỷ lệ x-to-1)',
        paragraphsVi: Object.freeze([
          'Khi đối mặt một khoản cần gọi (Call), tổng pot mới sau khi bạn call sẽ là: Pot sau call = Pot hiện tại (đã gồm tiền đối thủ vừa bet/raise) + Khoản bạn phải call.',
          '• Equity cần để hòa vốn (%): Call / (Pot hiện tại + Call).',
          '• Tỷ lệ Pot-to-Call (x-to-1): Pot hiện tại / Call. Đổi từ x-to-1 sang %: 1 / (x + 1) (Hopkins L2 slide 12–13; L7 slide 7).',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Đặc thù Pot Odds trên bàn Accate & Khi có Side Pot',
        paragraphsVi: Object.freeze([
          '• Ante của cả bàn (5 điểm/người) tạo sẵn 20–50 điểm trong pot ngay từ đầu ván, trong khi mỗi street bị chặn ở cap 50. Vì vậy càng về Turn và River, tỷ lệ Call / Tổng pot càng nhỏ (ví dụ H1: Flop cần 30,0%, Turn cần 22,7%, River chỉ cần 15,6%).',
          '• Khi có người All-in tạo Side Pot (Hopkins L2 slide 14–15, D18): Bạn chỉ được tính phần pot mà bạn ĐỦ ĐIỀU KIỆN tranh, và chia equity riêng cho từng pot (Main Pot nhiều người vs Side Pot ít người).',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate (H1 #7, #13, #16): Ba điểm quyết định của Hero C',
      setupVi:
        'Ván H1 (6 người, ante 5 → pot đầu 30): Theo dõi pot odds tại 3 lượt quyết định liên tiếp của Hero C trước B (Điên).',
      heroCards: Object.freeze([parseCard('Js'), parseCard('Jd')] as const),
      board: Object.freeze(parseCards('9h 7h 2c 5s')),
      potBeforeCall: 170,
      callAmount: 50,
      streetCap: 50,
      rivalId: 'dien',
      calculationStepsVi: Object.freeze([
        '• Flop (#7): Pot hiện tại 70, cần Call 30 → Tỷ lệ 70/30 (2.33-to-1), Equity cần = 30 / (70 + 30) = 30,0%.',
        '• Turn (#13): Pot đầu turn 120, Điên bet cap 50 đưa pot lên 170, cần Call 50 → Tỷ lệ 170/50 (3.4-to-1), Equity cần = 50 / (170 + 50) = 50/220 ≈ 22,7%.',
        '• River (#16): Pot đầu river 220, Điên bet cap 50 đưa pot lên 270, cần Call 50 → Tỷ lệ 270/50 (5.4-to-1), Equity cần = 50 / (270 + 50) = 50/320 ≈ 15,6%.',
      ]),
      takeawayVi:
        'Nhờ cap 50 mỗi street, ở Turn và River bạn thường chỉ cần 15%–23% equity để call hòa vốn.',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Ở Turn (H1 #13), pot trước lượt Điên là 120. Điên bet kịch cap 50 làm pot trên bàn thành 170. Bạn cần bỏ 50 để Call. Equity cần (pot odds) của bạn là bao nhiêu?',
      optionsVi: Object.freeze([
        '50 / (170 + 50) = 50 / 220 ≈ 22,7% (tỷ lệ 170/50 = 3.4-to-1)',
        '50 / 170 ≈ 29,4%',
        '50 / 120 ≈ 41,7%',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Pot sau khi bạn call là 170 + 50 = 220, nên equity cần để hòa vốn là 50 / 220 ≈ 22,7%.',
    }),
  }),

  'ev-comparison': Object.freeze({
    conceptId: 'ev-comparison',
    orderIndex: 4,
    titleVi: 'Bài 4: So sánh Equity vs Pot Odds, EV Quyết định & Implied Odds dưới Cap 50',
    subtitleVi:
      'Tính giá trị kỳ vọng (EV) bằng điểm chip, nhận diện Spot rõ ràng (> 5%) và đánh giá quyết định độc lập với kết quả river.',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze(['Hopkins L2 slide 7–8', 'L2 slide 10–11', 'L2 slide 28–32']),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Công thức EV bằng chip và Ngưỡng Spot rõ ràng (> 5 điểm %)',
        paragraphsVi: Object.freeze([
          '• EV(Fold) luôn bằng 0 tại thời điểm quyết định (chip bạn đã bỏ vào pot trước đó là chi phí chìm — Hopkins L2 slide 7–8).',
          '• EV(Call) = Equity × (Pot hiện tại + Call) − Call. Khi Equity > Equity cần (Pot odds) thì EV(Call) > 0 (+EV); ngược lại EV(Call) < 0 (-EV).',
          '• Spot "rõ ràng" (Clear spot): Khi |Equity − Equity cần| > 5 điểm % (ngưỡng chặt > 5%). Các spot có chênh lệch ≤ 5 điểm % là spot sát nút (marginal), không bị tính phạt vào chỉ số Quyết định đúng ở spot rõ (AC M3).',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Implied Odds bị giới hạn bởi Cap 50 & Tách quyết định khỏi kết quả',
        paragraphsVi: Object.freeze([
          '• Implied odds có cap (Hopkins L2 slide 28–32 điều chỉnh cho Accate): Trong No-Limit, bạn có thể call thiếu một chút pot odds ở turn vì kỳ vọng thắng thêm hàng trăm điểm ở river. Nhưng ở Accate, mỗi street sau chỉ thắng thêm tối đa 50 điểm mỗi đối thủ!',
          '• Tách quyết định khỏi kết quả (AC D6): Một quyết định +EV ở flop/turn vẫn có thể thua khi river ra lá thuận lợi cho đối thủ. Nhãn đánh giá sẽ luôn ghi nhận: "Quyết định: Tốt — thua do river".',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate: Mua Thùng 9 Clean Outs ở Turn (Hopkins L2 slide 10–11)',
      setupVi:
        'Turn K♥ 7♥ 4♣ A♣, pot trước khi đối thủ bet là 70. Đá bet 20 đưa pot lên 90. Bạn cầm A♥ 4♥ có 9 clean outs lên Nut Flush trong 46 lá chưa biết.',
      heroCards: Object.freeze([parseCard('Ah'), parseCard('4h')] as const),
      board: Object.freeze(parseCards('Kh 7h 4c Ac')),
      potBeforeCall: 90,
      callAmount: 20,
      streetCap: 50,
      rivalId: 'da',
      calculationStepsVi: Object.freeze([
        'Xác suất trúng Nut Flush ở River = 9 / 46 ≈ 19,57% (cộng thêm khả năng thắng khi bàn ra A hoặc 4).',
        'Pot odds (Equity cần) để Call 20 vào pot 90 = 20 / (90 + 20) = 20 / 110 ≈ 18,18% (4.5-to-1).',
        'Ngay cả khi chỉ tính riêng 9 clean outs thùng (19,57% > 18,18%), EV(Call 20) = 0,1957 × 110 − 20 = +1,52 chip > 0 (+EV). Ngoài ra ở river bạn có thể thắng thêm tối đa 50 điểm nếu Đá tiếp tục trả.',
      ]),
      takeawayVi:
        'Luôn chấm quyết định dựa trên EV tại thời điểm chọn hành động; thắng hay thua ở river không làm thay đổi chất lượng quyết định.',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Giả sử Equity của bạn là 35,0% và Equity cần (pot odds) là 30,0% (chênh lệch đúng bằng 5,0 điểm %). Tình huống này có được tính vào chỉ số "Quyết định đúng ở spot rõ" không?',
      optionsVi: Object.freeze([
        'Không — Spot rõ yêu cầu chênh lệch lớn hơn chặt 5 điểm % (|Equity − Equity cần| > 5%)',
        'Có — Từ 5,0 điểm % trở lên đều là spot rõ',
        'Tùy thuộc vào kết quả thắng hay thua ở river',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Theo Spec §5 và AC M3, spot rõ yêu cầu |Equity − Equity cần| > 5 điểm % (ngưỡng chặt). Chênh lệch ≤ 5 điểm % được xếp vào nhóm sát nút (marginal) và không tính vào chỉ số spot rõ.',
    }),
  }),

  'rival-range': Object.freeze({
    conceptId: 'rival-range',
    orderIndex: 5,
    titleVi: 'Bài 5: Equity theo Range của 9 Rival, Trạng thái Tilt & Lời hô sớm',
    subtitleVi:
      'Đọc hành động công khai theo kiểu người chơi, điều chỉnh range khi Nóng đang Tilt và đọc tell từ lời hô trước lượt.',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze(['Hopkins L5 slide 25, 41, 65', 'L8 slide 6', 'L8 slide 8']),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Chín nhân vật Rival và độ rộng Range khi Bet / Raise',
        paragraphsVi: Object.freeze([
          '• Nhóm Chặt (Đá — Nit, Thỏ — Weak-tight): Khi Đá chủ động bet/raise, range cực hẹp và thiên hẳn về bài value mạnh. Thỏ rất dễ fold khi bị raise.',
          '• Nhóm Thoáng thụ động (Cá — Calling station, Đại gia — Whale): Call rất rộng (Đại gia giữ mọi draw yếu), nhưng hiếm khi tự raise nếu không cầm bài rất mạnh.',
          '• Nhóm Chủ động (Cáo — TAG, Sói — LAG, Điên — Maniac): Cáo cân bằng giữa value và semi-bluff; Sói bluff nhiều; Điên đẩy gần cap 50 ở hầu hết các street với range rất rộng.',
          '• Bẫy (Slowplay / Check-raise): Hay check gài bài mạnh rồi tung cú check-raise.',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Nóng khi Tilt (L8 slide 6) và Lời hô sớm trước lượt (L8 slide 8)',
        paragraphsVi: Object.freeze([
          '• Nhân vật thứ 9 — Nóng (Tilter, D45): Bình thường chơi chắc tay gần Cáo. Nhưng vừa thua pot ≥ 150 ở showdown hoặc thua khi đang dẫn ở turn (bad beat), Nóng chuyển sang TILT trong 3–5 ván: chơi cực rộng, đẩy cap 50 liên tục, hô sớm nhiều và call bằng draw yếu → Equity của bạn trước Nóng khi tilt cao hơn hẳn lúc bình thường!',
          '• Lời hô sớm trước lượt (D39, Hopkins L8 slide 8): Trên bàn Accate lời hô sớm có hiệu lực bắt buộc nếu chưa ai đổi mức cược trước đó. Điên, Sói và Nóng (khi tilt) rất hay hô sớm để gây áp lực.',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate: Đối mặt Nóng đang Tilt Bet Kịch Cap 50 trên Flop Q♥ 8♣ 3♠',
      setupVi:
        'Nóng đang ở trạng thái Tilt (còn 3 ván sau khi vừa thua pot lớn). Trên flop Q♥ 8♣ 3♠, Nóng lập tức bet 50 (chạm cap). Bạn cầm A♠ Q♦ (Top Pair Top Kicker).',
      heroCards: Object.freeze([parseCard('As'), parseCard('Qd')] as const),
      board: Object.freeze(parseCards('Qh 8c 3s')),
      potBeforeCall: 70,
      callAmount: 50,
      streetCap: 50,
      rivalId: 'nong',
      calculationStepsVi: Object.freeze([
        'Nếu đối thủ là Đá (Nit) bet kịch cap 50, bạn phải dè chừng set 88/33 hoặc hai đôi Q8.',
        'Nhưng đây là Nóng đang Tilt: range bet 50 phình rộng gồm mọi đôi Q yếu hơn, đôi 8, đôi 3, gutshot và rất nhiều bluff thuần.',
        'Equity của A♠ Q♦ trước range tilt của Nóng vượt 75%, cao hơn xa mức pot odds cần thiết (50 / 120 = 41,7%) → Call 50 có EV dương rất lớn.',
      ]),
      takeawayVi:
        'Luôn quan sát nhãn kiểu chơi và trạng thái Tilt công khai trên ghế rival trước khi ước lượng range và equity (Hopkins L5 slide 25, L8 slide 6).',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Khi nhân vật Nóng vừa thua một pot 160 điểm ở showdown và chuyển sang trạng thái Tilt ở ván kế tiếp, bạn nên điều chỉnh cách đọc range của Nóng như thế nào?',
      optionsVi: Object.freeze([
        'Nới rộng range của Nóng (thêm nhiều bluff, draw yếu và bài trung bình đẩy cap 50), từ đó equity của bài value bên bạn tăng lên',
        'Thu hẹp range của Nóng vì Nóng sẽ chơi nhát hơn sau khi thua',
        'Giữ nguyên range như lúc bình thường vì trạng thái tilt chỉ là hiệu ứng hình ảnh',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Khi Nóng đang tilt (kéo dài 3–5 ván sau khi thua pot ≥ 150 hoặc bị bad beat ở turn), tần suất bet/raise cap 50 và bluff tăng vọt nên range của Nóng rộng hơn hẳn lúc bình thường.',
    }),
  }),

  'board-texture': Object.freeze({
    conceptId: 'board-texture',
    orderIndex: 6,
    titleVi: 'Bài 6: Đọc Board Texture (Dry / Wet / Nhiều Draw) & Thứ tự nói trước/sau',
    subtitleVi:
      'Phân loại mặt bài chung và đọc ý nghĩa của check-raise cũng như lợi thế nói sau khi bàn Accate random người mở lời.',
    estimatedMinutes: 2,
    lectureRefs: Object.freeze([
      'Hopkins L5 slide 5',
      'L5 slide 6–12',
      'L5 slide 23–25',
      'L8 slide 18–23',
    ]),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Ba nhóm Board Texture: Dry, Wet và Nhiều Draw',
        paragraphsVi: Object.freeze([
          '• Dry (Mặt bài khô, vd K♠ 7♦ 2♣): Các lá khác chất (rainbow) và cách xa nhau. Rất ít bài mua sảnh/thùng; cú bet thường đại diện cho bài made hand thật hoặc bluff thuần.',
          '• Wet (Mặt bài ướt, vd 9♥ 7♥ 2♣): Có 2 lá đồng chất hoặc 2 lá gần nhau, mở ra cả flush draw 9 outs và straight draw (semi-bluff theo Hopkins L5 slide 5).',
          '• Nhiều draw (Draw-heavy, vd T♥ 9♥ 8♣): 3 lá liên tiếp hoặc 3 lá đồng chất. Rất nhiều bài sảnh/thùng đã hoàn thành hoặc combo draw 12–15 outs.',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Điều chỉnh cho luật Accate: Không có C-bet mặc định, giữ Check-Raise & Lợi thế nói sau',
        paragraphsVi: Object.freeze([
          '• Vì biến thể mặc định của Accate lật flop trước rồi random người mở lời của ván (không có người raise preflop), khái niệm c-bet hay donk bet ít ý nghĩa (Hopkins L5 slide 6–12 điều chỉnh).',
          '• Tuy nhiên đòn Check-Raise (đặc trưng của rival Bẫy) và lợi thế Nói sau (được nhìn hành động của những người nói trước trong street) vẫn giữ nguyên giá trị chiến thuật!',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate: Check-Raise của Bẫy trên Flop Nhiều Draw (T♥ 9♥ 8♣)',
      setupVi:
        'Trên flop T♥ 9♥ 8♣, Bẫy (A) là người mở lời và chọn Check. Sói (B) bet 15, bạn (Hero C, cầm A♥ Q♥) call 15, sau đó Bẫy tung cú Check-Raise lên 45!',
      heroCards: Object.freeze([parseCard('Ah'), parseCard('Qh')] as const),
      board: Object.freeze(parseCards('Th 9h 8c')),
      potBeforeCall: 95,
      callAmount: 30,
      streetCap: 50,
      rivalId: 'bay',
      calculationStepsVi: Object.freeze([
        'Kết cấu board T♥ 9♥ 8♣ là Nhiều draw (Draw-heavy): đã có sảnh Q-J, J-7, 7-6 cùng vô số combo mua thùng/sảnh.',
        'Cú check-raise lên 45 của Bẫy đại diện cho nhóm bài cực mạnh (sảnh đã hoàn thành, set T/9/8 hoặc hai đôi lớn).',
        'Dù vậy, A♥ Q♥ của bạn có Nut Flush Draw (9 lá cơ) + Gutshot sảnh J → đủ equity để gọi thêm 30 vào pot 95 (equity cần 30/125 = 24,0%).',
      ]),
      takeawayVi:
        'Kết hợp phân loại Board Texture với kiểu chơi của Rival (như đòn check-raise của Bẫy) giúp bạn xác định chính xác những nhóm bài đối thủ đang đại diện.',
    }),
    miniCheck: Object.freeze({
      questionVi: 'Mặt bài Flop T♥ 9♥ 8♣ được phân loại vào nhóm Board Texture nào?',
      optionsVi: Object.freeze([
        'Nhiều draw (Draw-heavy) — 3 lá liên tiếp kèm 2 lá đồng chất cơ, mở ra cả sảnh đã hoàn thành lẫn combo draw lớn',
        'Dry (Mặt bài khô) — vì chưa có đôi trên bàn',
        'Khô trung bình — vì chưa có đủ 3 lá đồng chất',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! T♥ 9♥ 8♣ có 3 lá liên tiếp kết hợp 2 lá cơ nên thuộc nhóm Nhiều draw (Draw-heavy).',
    }),
  }),

  'bet-sizing': Object.freeze({
    conceptId: 'bet-sizing',
    orderIndex: 7,
    titleVi: 'Bài 7: Bet Sizing Hợp lệ vs Chiến thuật & "Giá để đuổi Draw" dưới Cap 50 (Mốc D8)',
    subtitleVi:
      'Tách biệt quy tắc đặt chip hợp lệ với mục tiêu chiến thuật, và hiểu vì sao Cap 50 không thể đuổi Flush Draw khi pot đã lớn.',
    estimatedMinutes: 3,
    lectureRefs: Object.freeze([
      'Hopkins L2 slide 18–20',
      'L8 slide 18–23',
      'L9 slide 13–22',
      'L9 slide 29–36',
    ]),
    sections: Object.freeze([
      Object.freeze({
        headingVi: '1. Kích thước hợp lệ theo luật (Legal Sizing) vs Lựa chọn chiến thuật',
        paragraphsVi: Object.freeze([
          '• Hợp lệ theo luật Accate: Khoản bet hoặc mức raise lên phải là bội số của 5, tăng thêm ít nhất +5 so với mức cược hiện hành, tổng góp của mỗi người trong street không vượt quá Cap 50, và phải bấm đúng từ 4 mệnh giá chip vật lý (5, 10, 50, 100) đang có trong stack (dùng nút "Đổi chip" với pot hoặc người chơi khác khi thiếu chip lẻ).',
          '• Ý nghĩa chiến thuật: Value bet (thu tối đa giá trị từ bài yếu hơn / bài mua), Bluff (ép bài mạnh hơn fold) và Semi-bluff (chủ động bet bằng bài draw).',
        ]),
      }),
      Object.freeze({
        headingVi: '2. Mốc D8 — Tại sao Cap 50 không thể đuổi Flush Draw khi Pot ở Turn là 300?',
        paragraphsVi: Object.freeze([
          '• Trong No-Limit Hold’em (Hopkins L2 slide 18–20), để đuổi một đối thủ mua thùng ở Turn (9 outs / 46 lá ≈ 19,57%), bạn cần bet > 1/3 pot (ví dụ bet 150 vào pot 300) để đối thủ phải cần > 20% equity.',
          '• Nhưng trên bàn Accate, khi Pot ở Turn đã là 300 điểm, mức bet tối đa luật cho phép chỉ là Cap 50!',
          '• Khi bạn bet tối đa 50 vào pot 300: pot trên bàn thành 350. Đối thủ nhìn thấy 350/50 (7-to-1) và chỉ cần equity = 50 / (350 + 50) = 50 / 400 = 12,5%!',
          '• Vì 12,5% < 19,57% (~19,6% của flush draw 9/46), đối thủ cầm flush draw VẪN DƯ POT ODDS ĐỂ CALL! Do đó ở pot lớn trên bàn Accate, bạn bet kịch cap 50 là để LẤY TỐI ĐA VALUE (thu phí), chứ không thể dùng cap 50 để ép một flush draw bỏ bài!',
        ]),
      }),
    ]),
    accateExample: Object.freeze({
      titleVi: 'Ví dụ bàn Accate (Mốc D8): Pot 300 trên Turn A♥ 9♥ 2♣ 4♦, Hero Bet Tối đa 50',
      setupVi:
        'Bàn 6 người đóng ante 30, ở flop cả 6 người cùng góp 45 nên pot vào Turn là 300. Trên turn A♥ 9♥ 2♣ 4♦, bạn cầm A♠ K♦ (Top Pair Top Kicker) và bet mức tối đa hợp lệ là 50 trước Đại gia (cầm Q♥ T♥ mua thùng cơ).',
      heroCards: Object.freeze([parseCard('As'), parseCard('Kd')] as const),
      board: Object.freeze(parseCards('Ah 9h 2c 4d')),
      potBeforeCall: 300,
      callAmount: 0,
      streetCap: 50,
      rivalId: 'dai-gia',
      calculationStepsVi: Object.freeze([
        'Pot trước khi bạn bet ở Turn = 300. Bạn bet tối đa hợp lệ dưới cap street = 50 (1 chip mệnh giá 50).',
        'Pot sau cú bet của bạn = 300 + 50 = 350. Đối thủ thấy 350/50 (tỷ lệ 7-to-1).',
        'Equity cần của đối thủ = 50 / (350 + 50) = 50 / 400 = 12,5%.',
        'Trong khi đó Flush Draw (9 lá cơ còn lại trong 46 lá chưa biết) có xác suất trúng ở River = 9 / 46 ≈ 19,57% (~19,6%) > 12,5%.',
        'Kết luận: Không thể đuổi flush draw bằng cap 50 khi pot đã là 300 (khác Hopkins L2 slide 18–20); bạn vẫn bet 50 để lấy tối đa value từ bài mua của đối thủ!',
      ]),
      takeawayVi:
        'Hiểu rõ giới hạn của Cap 50 giúp bạn không ảo tưởng "đuổi được draw" ở pot lớn mà tập trung đặt mức 50 để tối đa hóa EV value (AC D8).',
    }),
    miniCheck: Object.freeze({
      questionVi:
        'Mốc D8: Trên Turn, pot hiện tại là 300. Bạn cầm bài mạnh và bet tối đa 50 (chạm cap). Đối thủ cầm Flush Draw (9 outs / 46 lá ≈ 19,57%) cần bao nhiêu % equity để call và bạn có đuổi được draw không?',
      optionsVi: Object.freeze([
        'Đối thủ thấy 350/50, chỉ cần 50/400 = 12,5% < 19,57% → Không thể đuổi flush draw bằng cap 50 (khác Hopkins L2 slide 18–20); cú bet 50 nhằm lấy tối đa value',
        'Đối thủ cần 50/300 = 16,7% < 19,57% → Vẫn đuổi được draw',
        'Đối thủ cần 50/350 = 14,3% và bắt buộc phải fold flush draw',
      ]),
      correctIndex: 0,
      explanationVi:
        'Chính xác! Sau khi bạn bet 50 vào pot 300, đối thủ thấy 350/50 và cần 50 / (350 + 50) = 50/400 = 12,5% < 19,57% (9/46), nên không thể đuổi flush draw bằng cap 50.',
    }),
  }),
});

export function getDrillLesson(conceptId: DrillConceptId): DrillLesson {
  return DRILL_LESSONS[conceptId];
}

export function getAllDrillLessons(): readonly DrillLesson[] {
  return Object.freeze(DRILL_CONCEPT_IDS.map((id) => DRILL_LESSONS[id]));
}

export function evaluateLessonMiniCheck(
  conceptId: DrillConceptId,
  selectedIndex: number,
): {
  readonly isCorrect: boolean;
  readonly selectedIndex: number;
  readonly correctIndex: number;
  readonly explanationVi: string;
} {
  const lesson = getDrillLesson(conceptId);
  const isCorrect = selectedIndex === lesson.miniCheck.correctIndex;
  return Object.freeze({
    isCorrect,
    selectedIndex,
    correctIndex: lesson.miniCheck.correctIndex,
    explanationVi: lesson.miniCheck.explanationVi,
  });
}
