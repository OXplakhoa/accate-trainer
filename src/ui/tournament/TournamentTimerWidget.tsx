import type { TournamentClockState, TournamentTimerWidgetProps } from './types';

function getTimerStatusLabel(clockState: TournamentClockState): string {
  const { status, remainingSeconds, hasBindingOutOfTurn } = clockState;
  if (status === 'running') {
    return remainingSeconds <= 3 ? 'Sắp hết giờ!' : 'Đang đếm giờ';
  }
  if (status === 'waiting-animation') {
    return 'Chờ lật bài…';
  }
  if (status === 'paused') {
    return 'Tạm dừng';
  }
  if (status === 'timed-out') {
    return 'Hết giờ';
  }
  if (hasBindingOutOfTurn) {
    return 'Đã hô trước';
  }
  return 'Đồng hồ lượt';
}

function getScreenReaderAnnouncement(clockState: TournamentClockState): string {
  const { status, remainingSeconds, activeTurn } = clockState;
  if (status === 'timed-out') {
    return 'Hết giờ, hệ thống tự động xử lý lượt.';
  }
  if (status === 'running' && activeTurn !== null) {
    if (remainingSeconds <= 3 && remainingSeconds >= 1) {
      return `Còn ${remainingSeconds} giây.`;
    }
    if (remainingSeconds === activeTurn.durationSeconds) {
      return activeTurn.hadCancelledDeclaration
        ? `Lời hô trước đã bị hủy. Bắt đầu đếm ngược ${activeTurn.durationSeconds} giây cho lượt của bạn.`
        : `Bắt đầu đếm ngược ${activeTurn.durationSeconds} giây cho lượt của bạn.`;
    }
  }
  return '';
}

export function TournamentTimerWidget({ clockState }: TournamentTimerWidgetProps) {
  const {
    status,
    activeTurn,
    remainingMs,
    remainingSeconds,
    configuredDurationSeconds,
    pendingTimerSeconds,
    hasBindingOutOfTurn,
    reducedMotion,
  } = clockState;

  const totalSeconds = activeTurn?.durationSeconds ?? configuredDurationSeconds;
  const displaySeconds =
    status === 'idle' ? configuredDurationSeconds : remainingSeconds;
  const progressPercent =
    status === 'idle'
      ? 100
      : status === 'timed-out'
        ? 0
        : Math.max(0, Math.min(100, (remainingMs / (totalSeconds * 1000)) * 100));

  const isUrgent = status === 'running' && remainingSeconds <= 3;
  const statusLabel = getTimerStatusLabel(clockState);
  const announcement = getScreenReaderAnnouncement(clockState);

  const subLabel =
    activeTurn?.hadCancelledDeclaration &&
    (status === 'running' || status === 'waiting-animation')
      ? 'Lời hô hủy · đủ giờ chọn lại'
      : pendingTimerSeconds !== null
        ? `Áp dụng ván sau: ${pendingTimerSeconds}s`
        : hasBindingOutOfTurn && status === 'idle'
          ? 'Tự chạy nếu cược giữ nguyên'
          : `Mỗi lượt ${configuredDurationSeconds}s`;

  const ariaLabel = `Đồng hồ Tournament: ${statusLabel}, còn ${displaySeconds} giây trên ${totalSeconds} giây. ${subLabel}`;

  return (
    <div
      className={`tm-timer tm-timer--${status}${isUrgent ? ' tm-timer--urgent' : ''}${reducedMotion ? ' tm-timer--reduced' : ''}`}
      role="timer"
      tabIndex={0}
      aria-label={ariaLabel}
      data-timer-status={status}
      data-remaining-seconds={displaySeconds}
      data-duration-seconds={totalSeconds}
      data-urgent={isUrgent ? 'true' : 'false'}
    >
      <div className="tm-timer__row">
        <div className="tm-timer__meta">
          <span className="tm-timer__badge">
            {isUrgent && <span aria-hidden="true">! </span>}
            {statusLabel}
          </span>
          <span className="tm-timer__sub">{subLabel}</span>
        </div>
        <strong className="tm-timer__seconds sb-num">{displaySeconds}s</strong>
      </div>

      <div className="tm-timer__track" aria-hidden="true">
        <div className="tm-timer__fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <span className="tm-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
