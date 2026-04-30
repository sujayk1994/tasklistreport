import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
//
// We keep the most recent email-send attempt in module memory so the
// frontend can pull it back via /api/diagnostics/email and show the user
// exactly *why* a send failed (auth, recipients, timeout, etc.) without
// needing access to server logs. This is intentionally process-local and
// not persisted — it's a temporary diagnostic aid the user asked for.
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
};

let lastAttempt: EmailAttempt | null = null;

export function getLastEmailAttempt(): EmailAttempt | null {
  return lastAttempt;
}

export function getEmailEnvStatus() {
  const cfg = getTransportConfig();
  return {
    gmailUserSet: !!process.env.GMAIL_USER,
    gmailPassSet: !!process.env.GMAIL_APP_PASSWORD,
    gmailUserMasked: process.env.GMAIL_USER
      ? maskEmail(process.env.GMAIL_USER)
      : null,
    smtpHost: cfg.host,
    smtpPort: cfg.port,
    smtpSecure: cfg.secure,
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

// ---------------------------------------------------------------------------
// Transport (with timeouts so a stuck SMTP socket can never hang a request)
// ---------------------------------------------------------------------------

function getTransportConfig() {
  // Allow overriding host/port via env so we can flip between Gmail's two
  // SMTP endpoints without a code change. Defaults match nodemailer's
  // service:"gmail" behaviour (smtp.gmail.com:465 SSL).
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  // 465 = implicit TLS (secure: true); 587 = STARTTLS (secure: false)
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  return { host, port, secure };
}

function createTransport(): Transporter | null {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return null;

  const { host, port, secure } = getTransportConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: gmailUser, pass: gmailPass },
    // Force IPv4 — many container hosts (Render included) advertise IPv6
    // via DNS but have no working IPv6 route, so without this Node may
    // pick an AAAA record and fail with ENETUNREACH.
    family: 4,
    // Hard timeouts — if SMTP is unreachable for any reason the send
    // fails fast with a clear error instead of holding the HTTP request
    // open until the client gives up.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
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
};

export type SendDailyReportOptions = {
  /** Marks the email subject + body as a TEST so recipients can tell it
   *  apart from the real end-of-day report. */
  test?: boolean;
};

function renderHtml(
  date: string,
  tasks: DailyReportTask[],
  userName: string,
  options: SendDailyReportOptions,
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

  const renderRow = (
    t: DailyReportTask,
    icon: string,
    iconColor: string,
    textStyle: string,
    noteColor: string,
  ) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">` +
    `<span style="color:${iconColor};margin-right:10px;">${icon}</span>` +
    `<span style="${textStyle}">${escapeHtml(t.text)}</span>` +
    (t.note
      ? `<div style="margin:4px 0 0 22px;font-size:12px;color:${noteColor};">${escapeHtml(t.note)}</div>`
      : "") +
    `</td></tr>`;

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
        { kind, recipients: recipientsParsed, durationMs: lastAttempt.durationMs },
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

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    return finish({
      success: false,
      message:
        "Email is not configured on the server. Set GMAIL_USER and GMAIL_APP_PASSWORD env vars.",
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

  const transport = createTransport();
  if (!transport) {
    return finish({
      success: false,
      message: "Failed to initialise the SMTP transport.",
    });
  }

  let html: string;
  let subject: string;
  try {
    const rendered = renderHtml(date, tasks, userName, options);
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
    await transport.sendMail({
      from: `"Daily Tasks" <${gmailUser}>`,
      to: recipientsParsed.join(", "),
      subject,
      html,
    });
    return finish({
      success: true,
      message: `Report sent to ${recipientsParsed.join(", ")}`,
    });
  } catch (err: any) {
    return finish(
      {
        success: false,
        message: `Email transport rejected the send: ${err?.message ?? "Unknown error"}`,
      },
      {
        errorName: err?.name,
        errorCode: err?.code,
        errorMessage: err?.message,
      },
    );
  } finally {
    // nodemailer transports are short-lived per request; release the pool
    // so we don't accumulate sockets between sends.
    try {
      transport.close();
    } catch {
      /* ignore */
    }
  }
}
