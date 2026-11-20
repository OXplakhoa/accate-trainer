/** Fixed attempt timestamps are supplied by the UI clock. */
export function readAttemptClock(startMs: number, durationSeconds: number, nowMs: number) {
  const elapsedMs = Math.max(0, nowMs - startMs);
  return { elapsedMs, remainingSeconds: Math.max(0, Math.ceil(durationSeconds - elapsedMs / 1000)) };
}
