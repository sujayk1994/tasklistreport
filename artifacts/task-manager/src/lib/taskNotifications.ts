const STORAGE_KEY = "task-notifications-v1";
const LAST_FIRED_KEY = "task-notifications-last-fired";
const REMINDER_START_KEY = "reminder-start-time";
const REMINDER_INTERVAL_KEY = "reminder-interval-minutes";

// IST is UTC+5:30
function getCurrentISTTime(): { hour: number; minute: number } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const istMs = utcMs + 5.5 * 60 * 60_000;
  const ist = new Date(istMs);
  return { hour: ist.getHours(), minute: ist.getMinutes() };
}

export function getReminderStart(): { hour: number; minute: number } {
  try {
    const raw = window.localStorage.getItem(REMINDER_START_KEY);
    if (raw) {
      const [h, m] = raw.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) return { hour: h, minute: m };
    }
  } catch {}
  return { hour: 20, minute: 30 }; // default 8:30 PM IST
}

export function setReminderStart(hour: number, minute: number): void {
  try {
    window.localStorage.setItem(
      REMINDER_START_KEY,
      `${hour}:${String(minute).padStart(2, "0")}`,
    );
  } catch {}
}

export function getReminderIntervalMinutes(): number {
  try {
    const raw = window.localStorage.getItem(REMINDER_INTERVAL_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch {}
  return 30; // default 30 min
}

export function setReminderIntervalMinutes(min: number): void {
  try {
    window.localStorage.setItem(REMINDER_INTERVAL_KEY, String(min));
  } catch {}
}

export function getNotifiedIds(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function setNotifiedIds(ids: Set<number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

export async function requestPermissionIfNeeded(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function playNotificationSound(): void {
  try {
    const CtxClass =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!CtxClass) return;
    const ctx = new CtxClass() as AudioContext;

    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch {}
}

export function shouldFireNow(): boolean {
  const { hour, minute } = getCurrentISTTime();
  const start = getReminderStart();
  const currentTotalMinutes = hour * 60 + minute;
  const startTotalMinutes = start.hour * 60 + start.minute;
  if (currentTotalMinutes < startTotalMinutes) return false;

  const intervalMs = getReminderIntervalMinutes() * 60 * 1000;
  const raw = window.localStorage.getItem(LAST_FIRED_KEY);
  const lastFired = raw ? parseInt(raw, 10) : 0;
  return Date.now() - lastFired >= intervalMs;
}

export function markFired(): void {
  try {
    window.localStorage.setItem(LAST_FIRED_KEY, String(Date.now()));
  } catch {}
}

export function fireNotificationsForTasks(
  tasks: { id: number; text: string }[],
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (tasks.length === 0) return;

  playNotificationSound();
  markFired();

  if (tasks.length === 1) {
    new Notification("⏰ Pending task reminder", {
      body: tasks[0].text,
      icon: "/favicon.ico",
      tag: "task-reminder",
    });
  } else {
    new Notification(`⏰ ${tasks.length} pending tasks`, {
      body: tasks.map((t) => `• ${t.text}`).join("\n"),
      icon: "/favicon.ico",
      tag: "task-reminder",
    });
  }
}
