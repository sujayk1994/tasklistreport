/**
 * Inbox task arrival alerts
 *
 * When tasks arrive automatically via the email poller (source === "inbox"),
 * fire a browser notification + a distinct "incoming" chime — even when the
 * tab is minimised.  Seen IDs are persisted to localStorage keyed by today's
 * date so the set resets automatically the next day.
 */

const storageKey = (): string =>
  `inbox-task-alert-seen-${new Date().toISOString().slice(0, 10)}`;

function loadSeenIds(): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<number>): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...ids]));
  } catch {}
}

/** Plays a bright two-note "ding-dong" chime distinct from the bell reminder. */
function playInboxChime(): void {
  try {
    const CtxClass =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!CtxClass) return;
    const ctx = new CtxClass() as AudioContext;

    const notes = [
      { freq: 880, start: 0, dur: 0.35 },
      { freq: 1108.73, start: 0.22, dur: 0.5 },
    ];
    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + start;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    });
  } catch {}
}

/**
 * On first page load, silently mark all current inbox tasks as "seen" so
 * we only notify about tasks that arrive AFTER the page was opened.
 */
export function initInboxAlertBaseline(
  tasks: Array<{ id: number; source: string }>,
): void {
  const seen = loadSeenIds();
  tasks.filter((t) => t.source === "inbox").forEach((t) => seen.add(t.id));
  saveSeenIds(seen);
}

export async function ensureInboxAlertPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Checks a freshly-fetched task list for new inbox-sourced tasks and fires
 * a notification + chime for any that haven't been alerted yet today.
 * Returns the count of newly alerted tasks (0 if nothing new).
 */
export async function alertNewInboxTasks(
  tasks: Array<{ id: number; text: string; source: string }>,
): Promise<number> {
  if (typeof window === "undefined" || !("Notification" in window)) return 0;

  const inboxTasks = tasks.filter((t) => t.source === "inbox");
  if (inboxTasks.length === 0) return 0;

  const seen = loadSeenIds();
  const newTasks = inboxTasks.filter((t) => !seen.has(t.id));
  if (newTasks.length === 0) return 0;

  const granted = await ensureInboxAlertPermission();

  newTasks.forEach((t) => seen.add(t.id));
  saveSeenIds(seen);

  if (!granted) return 0;

  playInboxChime();

  if (newTasks.length === 1) {
    new Notification("📬 New task from email", {
      body: newTasks[0].text,
      icon: "/favicon.ico",
      tag: `inbox-task-${newTasks[0].id}`,
    });
  } else {
    new Notification(`📬 ${newTasks.length} new tasks from email`, {
      body: newTasks.map((t) => `• ${t.text}`).join("\n"),
      icon: "/favicon.ico",
      tag: "inbox-tasks-batch",
    });
  }

  return newTasks.length;
}
