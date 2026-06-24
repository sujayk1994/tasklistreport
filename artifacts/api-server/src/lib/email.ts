import { Resend } from "resend";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
//
// We keep the most recent email-send attempt in module memory so the
// frontend can pull it back via /api/diagnostics/email and show the user
// exactly *why* a send failed (auth, recipients, API error, etc.) without
// needing access to server logs. Process-local, not persisted — this is a
// temporary diagnostic aid the user asked for.
// ---------------------------------------------------------------------------

export type EmailAttempt = {
  attemptedAt: string;
  kind: "submit" | "test";
  success: boolean;
  message: string;
  recipientsRaw: string;
  recipientsParsed: string[];
  taskCount: number;
  durationMs: number;
  errorName?: string;
  errorCode?: string;
  errorMessage?: string;
  providerMessageId?: string;
};

let lastAttempt: EmailAttempt | null = null;

export function getLastEmailAttempt(): EmailAttempt | null {
  return lastAttempt;
}

const DEFAULT_FROM = "Daily Tasks <onboarding@resend.dev>";

function getFromAddress(): string {
  // EMAIL_FROM should be a full RFC822 from header, e.g.
  //   "Daily Tasks <reports@vellichormedia.com>"
  // or just an address: "reports@vellichormedia.com"
  // Falls back to Resend's sandbox sender so a missing env var never
  // bricks the send entirely.
  const raw = process.env.EMAIL_FROM?.trim();
  if (!raw) return DEFAULT_FROM;
  return raw;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function getEmailEnvStatus() {
  const apiKey = process.env.RESEND_API_KEY;
  return {
    provider: "resend" as const,
    apiKeySet: !!apiKey,
    apiKeyMasked: apiKey ? maskApiKey(apiKey) : null,
    fromAddress: getFromAddress(),
    fromAddressFromEnv: !!process.env.EMAIL_FROM,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let cachedClient: Resend | null = null;
let cachedClientKey: string | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (cachedClient && cachedClientKey === apiKey) return cachedClient;
  cachedClient = new Resend(apiKey);
  cachedClientKey = apiKey;
  return cachedClient;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type DailyReportTask = {
  text: string;
  completed: boolean;
  note: string;
  postedForFuture?: boolean;
  elapsedSeconds?: number;
};

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export type SendDailyReportOptions = {
  /** Marks the email subject + body as a TEST so recipients can tell it
   *  apart from the real end-of-day report. */
  test?: boolean;
};

export function renderDailyReportHtml(
  date: string,
  tasks: DailyReportTask[],
  userName: string,
  options: SendDailyReportOptions = {},
): { html: string; subject: string; counts: { completed: number; total: number } } {
  const postedForFutureTasks = tasks.filter((t) => t.postedForFuture);
  const activeTasks = tasks.filter((t) => !t.postedForFuture);
  const completedTasks = activeTasks.filter((t) => t.completed);
  const incompleteTasks = activeTasks.filter((t) => !t.completed);
  const completedPercent =
    activeTasks.length > 0
      ? Math.round((completedTasks.length / activeTasks.length) * 100)
      : 0;

  const safeDate = escapeHtml(date);
  const safeUserName = escapeHtml(userName);

  const isPriority = (text: string) => /\b(urgent|priority)\b/i.test(text);

  const renderRow = (
    t: DailyReportTask,
    icon: string,
    iconColor: string,
    textStyle: string,
    noteColor: string,
  ) => {
    const dur = formatDuration(t.elapsedSeconds ?? 0);
    const priorityTask = isPriority(t.text);
    const rowBg = priorityTask ? "background:#fff8f0;" : "";
    const textFinal = priorityTask
      ? `font-weight:700;color:#b91c1c;${textStyle.includes("line-through") ? "text-decoration:line-through;" : ""}`
      : textStyle;
    return (
      `<tr style="${rowBg}"><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;${priorityTask ? "border-left:3px solid #DC2626;" : ""}">` +
      `<span style="color:${iconColor};margin-right:10px;">${icon}</span>` +
      (priorityTask ? `<span style="margin-right:6px;font-size:13px;">&#9889;</span>` : "") +
      `<span style="${textFinal}">${escapeHtml(t.text)}</span>` +
      (dur
        ? `<span style="margin-left:8px;font-size:11px;color:#64748b;background:#f1f5f9;border-radius:4px;padding:1px 6px;">&#9201; ${escapeHtml(dur)}</span>`
        : "") +
      (t.note
        ? `<div style="margin:4px 0 0 22px;font-size:12px;color:${noteColor};">${escapeHtml(t.note)}</div>`
        : "") +
      `</td></tr>`
    );
  };

  const completedRows = completedTasks
    .map((t) =>
      renderRow(
        t,
        "&#10003;",
        "#22c55e",
        "text-decoration:line-through;color:#9ca3af;",
        "#94a3b8",
      ),
    )
    .join("\n");

  const incompleteRows = incompleteTasks
    .map((t) => renderRow(t, "&#9744;", "#d1d5db", "color:#1f2937;", "#64748b"))
    .join("\n");

  const postedForFutureRows = postedForFutureTasks
    .map((t) => renderRow(t, "&#10148;", "#6366f1", "color:#1f2937;", "#64748b"))
    .join("\n");

  const testBanner = options.test
    ? `<div style="background:#fef3c7;color:#92400e;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:13px;font-weight:600;text-align:center;">
        TEST EMAIL — sent from Settings &gt; Test Submit. The day was NOT marked submitted.
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1e293b;padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">Daily Task Report${options.test ? " (Test)" : ""}</h1>
      <p style="color:#94a3b8;margin:6px 0 0;font-size:14px;">${safeDate} &mdash; ${safeUserName}</p>
    </div>
    <div style="padding:32px 40px;">
      ${testBanner}
      <div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:28px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="text-align:center;padding:0 20px 0 0;">
              <div style="font-size:32px;font-weight:700;color:#1e293b;">${completedTasks.length}/${activeTasks.length}</div>
              <div style="font-size:13px;color:#64748b;margin-top:4px;">Tasks Completed</div>
            </td>
            <td style="text-align:center;">
              <div style="font-size:32px;font-weight:700;color:${completedPercent === 100 ? "#22c55e" : "#f59e0b"};">${completedPercent}%</div>
              <div style="font-size:13px;color:#64748b;margin-top:4px;">Completion Rate</div>
            </td>
          </tr>
        </table>
      </div>

      ${
        completedTasks.length > 0
          ? `<h2 style="font-size:14px;font-weight:600;color:#22c55e;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Completed (${completedTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${completedRows}
      </table>`
          : ""
      }

      ${
        incompleteTasks.length > 0
          ? `<h2 style="font-size:14px;font-weight:600;color:#f59e0b;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Not Completed (${incompleteTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${incompleteRows}
      </table>`
          : ""
      }

      ${
        postedForFutureTasks.length > 0
          ? `<h2 style="font-size:14px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Posted for Future (${postedForFutureTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${postedForFutureRows}
      </table>`
          : ""
      }
    </div>
  </div>
</body>
</html>`;

  const subjectPrefix = options.test ? "[TEST] " : "";
  const subject = `${subjectPrefix}Daily Task Report — ${safeDate} (${completedTasks.length}/${activeTasks.length} completed)`;

  return {
    html,
    subject,
    counts: { completed: completedTasks.length, total: activeTasks.length },
  };
}

// ---------------------------------------------------------------------------
// Pending tasks email (on-demand, not a day-end report)
// ---------------------------------------------------------------------------

export type PendingTask = {
  text: string;
  note: string;
};

export function renderPendingTasksHtml(
  date: string,
  tasks: PendingTask[],
  userName: string,
): { html: string; subject: string } {
  const safeDate = escapeHtml(date);
  const safeUserName = escapeHtml(userName);

  const rows = tasks
    .map(
      (t) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">` +
        `<span style="color:#d1d5db;margin-right:10px;">&#9744;</span>` +
        `<span style="color:#1f2937;">${escapeHtml(t.text)}</span>` +
        (t.note
          ? `<div style="margin:4px 0 0 22px;font-size:12px;color:#64748b;">${escapeHtml(t.note)}</div>`
          : "") +
        `</td></tr>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1e293b;padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">Pending Tasks</h1>
      <p style="color:#94a3b8;margin:6px 0 0;font-size:14px;">${safeDate} &mdash; ${safeUserName}</p>
    </div>
    <div style="padding:32px 40px;">
      <div style="background:#fef3c7;color:#92400e;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:13px;">
        <strong>${tasks.length} pending task${tasks.length !== 1 ? "s" : ""}</strong> as of now — this is a snapshot, not an end-of-day report.
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${rows}
      </table>
    </div>
  </div>
</body>
</html>`;

  const subject = `Pending Tasks — ${safeDate} (${tasks.length} remaining)`;
  return { html, subject };
}

export async function sendPendingTasksEmail(
  recipientEmails: string,
  date: string,
  tasks: PendingTask[],
  userName: string,
): Promise<{ success: boolean; message: string }> {
  const client = getClient();
  if (!client) {
    return {
      success: false,
      message: "Email is not configured on the server. Set RESEND_API_KEY env var.",
    };
  }

  const recipientsParsed = parseRecipients(recipientEmails);
  if (recipientsParsed.length === 0) {
    return {
      success: false,
      message:
        recipientEmails.trim() === ""
          ? "No recipient emails configured. Add at least one address in Settings."
          : `No valid recipient emails after parsing "${recipientEmails}".`,
    };
  }

  const { html, subject } = renderPendingTasksHtml(date, tasks, userName);

  try {
    const { data, error } = await client.emails.send({
      from: getFromAddress(),
      to: recipientsParsed,
      subject,
      html,
    });

    if (error) {
      return {
        success: false,
        message: `Resend rejected the send: ${error.message ?? "Unknown error"}`,
      };
    }

    return {
      success: true,
      message: `Pending tasks sent to ${recipientsParsed.join(", ")}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Resend request failed: ${err?.message ?? "Unknown error"}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public send function
// ---------------------------------------------------------------------------

function parseRecipients(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

export async function sendDailyReport(
  recipientEmails: string,
  date: string,
  tasks: DailyReportTask[],
  userName: string,
  options: SendDailyReportOptions = {},
): Promise<{ success: boolean; message: string }> {
  const startedAt = Date.now();
  const kind: EmailAttempt["kind"] = options.test ? "test" : "submit";
  const recipientsParsed = parseRecipients(recipientEmails);

  const baseAttempt: Omit<EmailAttempt, "success" | "message" | "durationMs"> = {
    attemptedAt: new Date().toISOString(),
    kind,
    recipientsRaw: recipientEmails,
    recipientsParsed,
    taskCount: tasks.length,
  };

  const finish = (
    result: { success: boolean; message: string },
    extra: Partial<EmailAttempt> = {},
  ) => {
    lastAttempt = {
      ...baseAttempt,
      ...extra,
      success: result.success,
      message: result.message,
      durationMs: Date.now() - startedAt,
    };
    if (result.success) {
      logger.info(
        {
          kind,
          recipients: recipientsParsed,
          durationMs: lastAttempt.durationMs,
          providerMessageId: extra.providerMessageId,
        },
        "email: sent",
      );
    } else {
      logger.error(
        {
          kind,
          recipients: recipientsParsed,
          message: result.message,
          errorName: extra.errorName,
          errorCode: extra.errorCode,
          durationMs: lastAttempt.durationMs,
        },
        "email: send failed",
      );
    }
    return result;
  };

  const client = getClient();
  if (!client) {
    return finish({
      success: false,
      message:
        "Email is not configured on the server. Set RESEND_API_KEY env var.",
    });
  }

  if (recipientsParsed.length === 0) {
    return finish({
      success: false,
      message:
        recipientEmails.trim() === ""
          ? "No recipient emails configured. Add at least one address in Settings."
          : `No valid recipient emails after parsing "${recipientEmails}". Check for typos / commas.`,
    });
  }

  let html: string;
  let subject: string;
  try {
    const rendered = renderDailyReportHtml(date, tasks, userName, options);
    html = rendered.html;
    subject = rendered.subject;
  } catch (err: any) {
    return finish(
      {
        success: false,
        message: `Failed to render the report HTML: ${err?.message ?? "Unknown error"}`,
      },
      { errorName: err?.name, errorMessage: err?.message },
    );
  }

  try {
    const { data, error } = await client.emails.send({
      from: getFromAddress(),
      to: recipientsParsed,
      subject,
      html,
    });

    if (error) {
      // Resend SDK returns errors as a structured object instead of throwing.
      return finish(
        {
          success: false,
          message: `Resend rejected the send: ${error.message ?? "Unknown error"}`,
        },
        {
          errorName: error.name ?? "ResendError",
          errorMessage: error.message,
        },
      );
    }

    return finish(
      {
        success: true,
        message: `Report sent to ${recipientsParsed.join(", ")}`,
      },
      { providerMessageId: data?.id },
    );
  } catch (err: any) {
    return finish(
      {
        success: false,
        message: `Resend request failed: ${err?.message ?? "Unknown error"}`,
      },
      {
        errorName: err?.name,
        errorCode: err?.code,
        errorMessage: err?.message,
      },
    );
  }
}
