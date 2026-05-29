/**
 * Task timer utilities
 *
 * Tracks which task's stopwatch is currently running in localStorage so the
 * timer survives page refreshes. Elapsed time is persisted to the DB when the
 * timer is paused / stopped.
 */

const RUNNING_TIMER_KEY = "task-timer-running";

type RunningTimer = { taskId: number; startedAt: number };

export function getRunningTimer(): RunningTimer | null {
  try {
    const raw = localStorage.getItem(RUNNING_TIMER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RunningTimer;
  } catch {
    return null;
  }
}

export function startTimer(taskId: number): void {
  try {
    localStorage.setItem(
      RUNNING_TIMER_KEY,
      JSON.stringify({ taskId, startedAt: Date.now() }),
    );
  } catch {}
}

export function clearRunningTimer(): void {
  try {
    localStorage.removeItem(RUNNING_TIMER_KEY);
  } catch {}
}

/**
 * Returns total elapsed seconds for a task, including any currently-running
 * time that hasn't been saved to the DB yet.
 */
export function liveElapsedSeconds(taskId: number, savedSeconds: number): number {
  const running = getRunningTimer();
  if (!running || running.taskId !== taskId) return savedSeconds;
  return savedSeconds + Math.floor((Date.now() - running.startedAt) / 1000);
}

/**
 * Formats a duration in seconds as M:SS (or H:MM:SS for ≥ 1 hour).
 * Returns "" for 0 seconds.
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
