const STORAGE_KEY = "task-notifications-v1";
const LAST_FIRED_KEY = "task-notifications-last-fired";
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const START_HOUR_IST = 20; // 8 PM IST

// IST is UTC+5:30
function getCurrentISTHour(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const istMs = utcMs + 5.5 * 60 * 60_000;
  return new Date(istMs).getHours();
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
  const hour = getCurrentISTHour();
  if (hour < START_HOUR_IST) return false;

  const raw = window.localStorage.getItem(LAST_FIRED_KEY);
  const lastFired = raw ? parseInt(raw, 10) : 0;
  return Date.now() - lastFired >= INTERVAL_MS;
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
