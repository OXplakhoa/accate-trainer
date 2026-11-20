import { RIVAL_IDS } from '../../engine';
import {
  DRILL_CONCEPT_IDS,
  type ActiveDrillLevel,
  type DrillConceptId,
  type DrillLevel,
  type DrillProgressReport,
} from '../../engine/drill';
import { RivalAvatar } from './VisualComponents';

function formatMetricPct(value: number | null, decimals = 1): string {
  if (value === null) {
    return 'Chưa đo';
  }
  return `${value.toFixed(decimals).replace(/\.0$/, '').replace('.', ',')}%`;
}

function formatMetricPp(value: number | null, decimals = 2): string {
  if (value === null) {
    return 'Chưa đo';
  }
  return `±${value.toFixed(decimals).replace(/\.00$/, '').replace('.', ',')} điểm %`;
}

function formatChipEv(value: number | null): string {
  if (value === null) {
    return 'Chưa đo';
  }
  return `${value.toFixed(1).replace('.', ',')} chip`;
}

export function ProgressView(props: {
  readonly report: DrillProgressReport;
  readonly storageAvailable: boolean;
  readonly storageWarningVi: string | null;
  readonly onStartPractice: (level: DrillLevel, conceptId?: DrillConceptId) => void;
  readonly onResetProgress: () => void;
}) {
  const { report, storageAvailable, storageWarningVi, onStartPractice, onResetProgress } = props;
  const { metrics } = report;

  const rivalWithMostData = RIVAL_IDS.map((id) => metrics.byRival[id]).sort(
    (a, b) => b.measuredCount - a.measuredCount,
  )[0]!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!storageAvailable || storageWarningVi !== null ? (
        <div className="drill-banner drill-banner-warn" role="status">
          <span>
            ⚠️{' '}
            {storageWarningVi ??
              'Trình duyệt đang chặn lưu trữ cục bộ (localStorage); tiến bộ vẫn được giữ trong phiên hiện tại.'}
          </span>
        </div>
      ) : null}

      {report.overallLevelUpSuggestion.shouldSuggestLevelUp &&
      report.overallLevelUpSuggestion.messageVi !== null ? (
        <div className="drill-banner drill-banner-good" role="status">
          <span>🏆 {report.overallLevelUpSuggestion.messageVi}</span>
          {report.overallLevelUpSuggestion.suggestedNextLevel !== null ? (
            <button
              type="button"
              className="drill-btn drill-btn-primary"
              onClick={() =>
                onStartPractice(report.overallLevelUpSuggestion.suggestedNextLevel!)
              }
            >
              Chuyển sang Cấp {report.overallLevelUpSuggestion.suggestedNextLevel} →
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Header & Empty State */}
      <div className="drill-controls-bar">
        <div>
          <h2 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.15rem' }}>
            Màn Tiến bộ — 8 Chỉ số Theo dõi (Spec §10)
          </h2>
          <div style={{ fontSize: '0.84rem', color: 'var(--drill-text-muted)' }}>
            Tổng số lượt submit hợp lệ đã ghi nhận: <strong>{report.totalAttempts}</strong> · Bài học
            Cấp 0 đã hoàn thành: <strong>{report.completedLessons.length}/7</strong>
          </div>
        </div>
        <div className="drill-nav-group">
          <button
            type="button"
            className="drill-btn drill-btn-primary"
            onClick={() => onStartPractice(1)}
          >
            Luyện tiếp ở Bàn Drill
          </button>
          {!report.isEmpty ? (
            <button
              type="button"
              className="drill-btn drill-btn-danger"
              onClick={onResetProgress}
            >
              Xoá lịch sử luyện tập
            </button>
          ) : null}
        </div>
      </div>

      {report.isEmpty ? (
        <div className="drill-action-panel" role="status" aria-label="Trạng thái trống màn Tiến bộ">
          <h3 style={{ margin: 0, color: 'var(--drill-accent)' }}>
            Chưa có lượt luyện tập nào được ghi nhận
          </h3>
          <p style={{ margin: '4px 0 10px', color: 'var(--drill-text-muted)', fontSize: '0.9rem' }}>
            Chỉ số chỉ được cập nhật khi bạn xác nhận một hành động hợp lệ với đúng mệnh giá chip vật
            lý ở Cấp 1, Cấp 2 hoặc Cấp 3. Hãy bắt đầu từ bài học Cấp 0 hoặc giải thử một spot trên bàn
            Accate!
          </p>
          <div className="drill-nav-group">
            <button
              type="button"
              className="drill-btn drill-btn-primary"
              onClick={() => onStartPractice(1, 'outs')}
            >
              Bắt đầu Cấp 1 (Tính từng bước)
            </button>
            <button
              type="button"
              className="drill-btn"
              onClick={() => onStartPractice(0, 'outs')}
            >
              Xem bài học Cấp 0 (2–3 phút)
            </button>
          </div>
        </div>
      ) : null}

      {/* 8 Core Metrics Grid (Spec §10) */}
      <section aria-label="8 chỉ số cốt lõi theo khóa Johns Hopkins">
        <div className="drill-progress-grid">
          {/* #1: Đếm outs đúng */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#1 · Đếm outs đúng</span>
              <span className="drill-badge">Mục tiêu ≥ 90%</span>
            </div>
            <div className="drill-metric-value">
              {formatMetricPct(metrics.outsAccuracy.accuracyPercent)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Đo trên {metrics.outsAccuracy.measuredCount} câu có đếm outs (đúng{' '}
              {metrics.outsAccuracy.correctCount}/{metrics.outsAccuracy.measuredCount} · sai số TB:{' '}
              {metrics.outsAccuracy.meanAbsoluteError !== null
                ? `${metrics.outsAccuracy.meanAbsoluteError.toFixed(2).replace('.', ',')} lá`
                : '—'}
              ).
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.outsAccuracy.sourceRef}
            </div>
          </div>

          {/* #2: Sai số outs -> % */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#2 · Sai số quy outs → %</span>
              <span className="drill-badge">Mục tiêu ≤ 3 điểm %</span>
            </div>
            <div className="drill-metric-value">
              {formatMetricPp(metrics.outsPercentError.meanAbsoluteErrorPp)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Đo trên {metrics.outsPercentError.measuredCount} câu (đạt mục tiêu ≤ 3%:{' '}
              {metrics.outsPercentError.withinTargetCount}/{metrics.outsPercentError.measuredCount}).
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.outsPercentError.sourceRef}
            </div>
          </div>

          {/* #3: Sai số pot odds */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#3 · Sai số Pot Odds</span>
              <span className="drill-badge">Mục tiêu ≤ 3 điểm %</span>
            </div>
            <div className="drill-metric-value">
              {formatMetricPp(metrics.potOddsError.meanAbsoluteErrorPp)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Đo trên {metrics.potOddsError.measuredCount} câu (đạt mục tiêu ≤ 3%:{' '}
              {metrics.potOddsError.withinTargetCount}/{metrics.potOddsError.measuredCount}).
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.potOddsError.sourceRef}
            </div>
          </div>

          {/* #4: Quyết định đúng ở spot rõ */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#4 · Quyết định đúng ở Spot rõ</span>
              <span className="drill-badge">Mục tiêu ≥ 90%</span>
            </div>
            <div className="drill-metric-value">
              {formatMetricPct(metrics.clearSpotAccuracy.accuracyPercent)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Ngưỡng chặt &gt; {metrics.clearSpotAccuracy.thresholdPp} điểm %: đo trên{' '}
              {metrics.clearSpotAccuracy.measuredCount} spot rõ (đã loại trừ{' '}
              {metrics.clearSpotAccuracy.excludedMarginalCount} spot sát nút ≤ 5%).
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.clearSpotAccuracy.sourceRef}
            </div>
          </div>

          {/* #5: EV mất / quyết định */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#5 · EV mất / quyết định</span>
              <span className="drill-badge">Mục tiêu: giảm dần</span>
            </div>
            <div className="drill-metric-value">
              {formatChipEv(metrics.evLossPerDecision.meanEvLoss)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Đo trên {metrics.evLossPerDecision.measuredCount} quyết định · Xu hướng:{' '}
              {metrics.evLossPerDecision.isDecreasingTrend === null
                ? 'Cần ≥ 2 lượt để so xu hướng'
                : metrics.evLossPerDecision.isDecreasingTrend
                  ? '✓ Đang giảm dần'
                  : '⚠️ Cần giảm EV mất'}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.evLossPerDecision.sourceRef}
            </div>
          </div>

          {/* #6: Tốc độ trung vị câu đúng */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#6 · Tốc độ trung vị câu đúng</span>
              <span className="drill-badge">
                Mục tiêu &lt; {metrics.medianSpeedCorrect.targetClockSeconds}s
              </span>
            </div>
            <div className="drill-metric-value">
              {metrics.medianSpeedCorrect.medianSeconds !== null
                ? `${metrics.medianSpeedCorrect.medianSeconds.toFixed(1).replace('.', ',')}s`
                : 'Chưa đo'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Chỉ tính trên câu đúng: đo được {metrics.medianSpeedCorrect.measuredCount} câu đúng có
              ghi thời gian.
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.medianSpeedCorrect.sourceRef}
            </div>
          </div>

          {/* #7: Đọc board texture */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#7 · Đọc Board Texture</span>
              <span className="drill-badge">Mục tiêu ≥ 85%</span>
            </div>
            <div className="drill-metric-value">
              {formatMetricPct(metrics.boardTextureAccuracy.accuracyPercent)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              Đo trên {metrics.boardTextureAccuracy.measuredCount} câu có phân loại Dry / Wet / Nhiều
              draw ({metrics.boardTextureAccuracy.correctCount}/
              {metrics.boardTextureAccuracy.measuredCount}).
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 {metrics.boardTextureAccuracy.sourceRef}
            </div>
          </div>

          {/* #8: Đọc theo kiểu rival */}
          <div className="drill-metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--drill-text-muted)' }}>#8 · Đọc theo kiểu Rival</span>
              <span className="drill-badge">9 nhân vật</span>
            </div>
            <div className="drill-metric-value" style={{ fontSize: '1.1rem' }}>
              {rivalWithMostData.measuredCount > 0
                ? `${rivalWithMostData.name}: ${formatMetricPct(rivalWithMostData.accuracyPercent)}`
                : 'Chưa đo'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
              {rivalWithMostData.insightVi}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--drill-accent)' }}>
              📖 L5 slide 25, 41, 65
            </div>
          </div>
        </div>
      </section>

      {/* Breakdown 1: Theo Cấp độ (Level 1, 2, 3) */}
      <section className="drill-action-panel" aria-label="Tiến bộ theo cấp độ">
        <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.02rem' }}>
          1. Tiến bộ theo Cấp độ (Cấp 1 · Cấp 2 · Cấp 3)
        </h3>
        <div className="drill-progress-grid">
          {([1, 2, 3] as const).map((lvl: ActiveDrillLevel) => {
            const item = report.byLevel[lvl];
            return (
              <div key={lvl} className="drill-feedback-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{item.titleVi}</strong>
                  <span className="drill-badge">{item.measuredCount} lượt</span>
                </div>
                <div>
                  Độ chính xác: <strong>{formatMetricPct(item.accuracyPercent)}</strong> ({item.correctDecisions}/{item.measuredCount})
                </div>
                <div>
                  EV mất TB: <strong>{formatChipEv(item.meanEvLoss)}</strong> · Dùng hint:{' '}
                  <strong>{item.hintUsedCount}</strong>
                </div>
                <div>
                  Tốc độ trung vị (câu đúng):{' '}
                  <strong>
                    {item.medianCorrectTimeMs !== null
                      ? `${(item.medianCorrectTimeMs / 1000).toFixed(1).replace('.', ',')}s`
                      : 'Chưa đo'}
                  </strong>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--drill-text-muted)' }}>
                  Cửa sổ 20 lần gần nhất: {item.levelUpSuggestion.recentCorrectCount}/
                  {item.levelUpSuggestion.recentAttemptCount} (cần ≥ 16/20 = 80% để gợi ý lên cấp)
                </div>
                <button
                  type="button"
                  className="drill-btn"
                  onClick={() => onStartPractice(lvl)}
                >
                  Luyện ở {item.titleVi}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Breakdown 2: Theo Khái niệm (7 concepts) */}
      <section className="drill-action-panel" aria-label="Tiến bộ theo khái niệm">
        <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.02rem' }}>
          2. Tiến bộ theo Khái niệm (Spec §6)
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="drill-table">
            <thead>
              <tr>
                <th>Khái niệm</th>
                <th>Bài Cấp 0</th>
                <th>Số lượt</th>
                <th>Quyết định đúng</th>
                <th>EV mất TB</th>
                <th>Đếm Outs đúng</th>
                <th>Sai số Pot Odds</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {DRILL_CONCEPT_IDS.map((cid) => {
                const c = report.byConcept[cid];
                return (
                  <tr key={cid}>
                    <td>
                      <strong>{c.titleVi}</strong>
                    </td>
                    <td>{c.lessonCompleted ? '✓ Đã học' : 'Chưa học'}</td>
                    <td>{c.measuredCount}</td>
                    <td>{formatMetricPct(c.accuracyPercent)}</td>
                    <td>{formatChipEv(c.meanEvLoss)}</td>
                    <td>{formatMetricPct(c.outsAccuracyPercent)}</td>
                    <td>{formatMetricPp(c.potOddsMeanErrorPp)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="drill-btn"
                          style={{ padding: '4px 8px', minHeight: 30, fontSize: '0.78rem' }}
                          onClick={() => onStartPractice(0, cid)}
                        >
                          Học Cấp 0
                        </button>
                        <button
                          type="button"
                          className="drill-btn drill-btn-primary"
                          style={{ padding: '4px 8px', minHeight: 30, fontSize: '0.78rem' }}
                          onClick={() => onStartPractice(1, cid)}
                        >
                          Luyện
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Breakdown 3: Theo từng Rival (9 characters) */}
      <section className="drill-action-panel" aria-label="Tiến bộ theo từng nhân vật Rival">
        <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.02rem' }}>
          3. Tiến bộ theo từng Nhân vật Rival (9 tính cách)
        </h3>
        <div className="drill-progress-grid">
          {RIVAL_IDS.map((rid) => {
            const r = report.byRival[rid];
            return (
              <div key={rid} className="drill-feedback-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RivalAvatar
                    rivalId={rid}
                    isTilted={rid === 'nong' && r.tiltedEncounterCount > 0}
                    size={34}
                  />
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {r.name}{' '}
                      <span style={{ fontSize: '0.76rem', color: 'var(--drill-accent)' }}>
                        ({r.styleLabel})
                      </span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--drill-text-muted)' }}>
                      Số lần đối đầu: {r.measuredCount}
                      {rid === 'nong' ? ` (khi tilt: ${r.tiltedEncounterCount})` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span>Chính xác: <strong>{formatMetricPct(r.accuracyPercent)}</strong></span>
                  <span>Spot rõ: <strong>{formatMetricPct(r.clearSpotAccuracyPercent)}</strong></span>
                  <span>EV mất: <strong>{formatChipEv(r.meanEvLoss)}</strong></span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--drill-text-muted)' }}>
                  Call sai: {r.wrongCallCount} · Fold sai: {r.wrongFoldCount}
                </div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color:
                      r.wrongCallCount > 0 || r.wrongFoldCount > 0
                        ? 'var(--drill-warn)'
                        : 'var(--drill-good)',
                  }}
                >
                  {r.insightVi}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Breakdown 4: Xu hướng theo Thời gian (byTime) */}
      <section className="drill-action-panel" aria-label="Xu hướng theo thời gian">
        <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.02rem' }}>
          4. Xu hướng theo Thời gian (Các lần thử gần nhất)
        </h3>
        {report.byTime.length === 0 ? (
          <div style={{ color: 'var(--drill-text-muted)', fontSize: '0.86rem' }}>
            Chưa có dữ liệu theo thời gian.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="drill-table">
              <thead>
                <tr>
                  <th>Lần</th>
                  <th>Cấp</th>
                  <th>Khái niệm</th>
                  <th>Rival chính</th>
                  <th>Kết quả quyết định</th>
                  <th>Chính xác trượt (5 lần)</th>
                  <th>EV mất</th>
                  <th>EV mất trượt</th>
                  <th>Tốc độ</th>
                </tr>
              </thead>
              <tbody>
                {[...report.byTime]
                  .slice(-15)
                  .reverse()
                  .map((pt) => (
                    <tr key={pt.sequenceIndex}>
                      <td>{pt.labelVi}</td>
                      <td>Cấp {pt.level}</td>
                      <td>{ report.byConcept[pt.conceptId].titleVi }</td>
                      <td>{report.byRival[pt.primaryRivalId].name}</td>
                      <td
                        style={{
                          color: pt.isDecisionCorrect ? 'var(--drill-good)' : 'var(--drill-bad)',
                          fontWeight: 700,
                        }}
                      >
                        {pt.isDecisionCorrect ? '✓ Đúng (+EV)' : '✗ Chưa tối ưu'}
                      </td>
                      <td>{formatMetricPct(pt.rollingAccuracyPercent)}</td>
                      <td>{formatChipEv(pt.evLoss)}</td>
                      <td>{formatChipEv(pt.rollingMeanEvLoss)}</td>
                      <td>
                        {pt.responseTimeMs !== null
                          ? `${(pt.responseTimeMs / 1000).toFixed(1).replace('.', ',')}s`
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
