import { useEffect, useState } from "react";

export type ReportMode = "email" | "download";

const STORAGE_KEY = "settings:reportMode";
const DEFAULT_MODE: ReportMode = "email";

function readStoredMode(): ReportMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "download" ? "download" : "email";
}

export function getReportMode(): ReportMode {
  return readStoredMode();
}

export function setReportMode(mode: ReportMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  // Notify other components in the same tab (storage event only fires
  // across tabs, so we dispatch a synthetic event here).
  window.dispatchEvent(new CustomEvent("reportModeChange", { detail: mode }));
}

/** React hook that returns the current report mode and a setter. */
export function useReportMode(): [ReportMode, (mode: ReportMode) => void] {
  const [mode, setModeState] = useState<ReportMode>(readStoredMode);

  useEffect(() => {
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<ReportMode>).detail;
      if (detail === "email" || detail === "download") setModeState(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setModeState(readStoredMode());
    };
    window.addEventListener("reportModeChange", onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("reportModeChange", onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = (m: ReportMode) => {
    setReportMode(m);
    setModeState(m);
  };

  return [mode, set];
}

/**
 * Triggers a browser download of the given HTML string with the given
 * filename. Used by the "Download" report mode after the server returns
 * the rendered report.
 */
export function downloadHtmlFile(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to consume the URL before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Calls the submit-and-download endpoint and triggers an HTML download.
 * Returns the parsed server response so the caller can show a toast.
 */
export async function submitDayAndDownload(): Promise<{
  success: boolean;
  message: string;
}> {
  const res = await fetch("/api/tasks/today/submit-and-download", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok || !body?.success) {
    return {
      success: false,
      message: body?.message || `Download failed (HTTP ${res.status}).`,
    };
  }
  if (body.html && body.filename) {
    downloadHtmlFile(body.html, body.filename);
  }
  return {
    success: true,
    message: body.message || "Report downloaded.",
  };
}
