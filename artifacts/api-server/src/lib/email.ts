import nodemailer from "nodemailer";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createTransport() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });
}

export type DailyReportTask = {
  text: string;
  completed: boolean;
  note: string;
  postedForFuture?: boolean;
};

export type SendDailyReportOptions = {
  /**
   * When true, the email subject is prefixed with "[TEST]" so recipients can
   * tell preview sends apart from the real end-of-day report. The caller is
   * still responsible for not flipping the submitted flag in this mode.
   */
  test?: boolean;
};

export async function sendDailyReport(
  recipientEmails: string,
  date: string,
  tasks: DailyReportTask[],
  userName: string,
  options: SendDailyReportOptions = {},
): Promise<{ success: boolean; message: string }> {
  const gmailUser = process.env.GMAIL_USER;
  const transport = createTransport();

  if (!transport || !gmailUser) {
    return {
      success: false,
      message: "Email not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD.",
    };
  }

  const recipients = recipientEmails
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (recipients.length === 0) {
    return {
      success: false,
      message: "No valid recipient emails configured. Please update your settings.",
    };
  }

  // Posted-for-future tasks live in their own section and are excluded from
  // the active "completed / not completed" totals at the top of the report.
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

  const completedRows = completedTasks
    .map(
      (t) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">` +
        `<span style="color:#22c55e;margin-right:10px;">&#10003;</span>` +
        `<span style="text-decoration:line-through;color:#9ca3af;">${escapeHtml(t.text)}</span>` +
        (t.note ? `<div style="margin:4px 0 0 22px;font-size:12px;color:#94a3b8;">${escapeHtml(t.note)}</div>` : "") +
        `</td></tr>`
    )
    .join("\n");

  const incompleteRows = incompleteTasks
    .map(
      (t) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">` +
        `<span style="color:#d1d5db;margin-right:10px;">&#9744;</span>` +
        `<span style="color:#1f2937;">${escapeHtml(t.text)}</span>` +
        (t.note ? `<div style="margin:4px 0 0 22px;font-size:12px;color:#64748b;">${escapeHtml(t.note)}</div>` : "") +
        `</td></tr>`
    )
    .join("\n");

  const postedForFutureRows = postedForFutureTasks
    .map(
      (t) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">` +
        `<span style="color:#6366f1;margin-right:10px;">&#10148;</span>` +
        `<span style="color:#1f2937;">${escapeHtml(t.text)}</span>` +
        (t.note ? `<div style="margin:4px 0 0 22px;font-size:12px;color:#64748b;">${escapeHtml(t.note)}</div>` : "") +
        `</td></tr>`
    )
    .join("\n");

  const testBanner = options.test
    ? `<div style="background:#fef3c7;color:#92400e;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:13px;font-weight:600;text-align:center;">
        TEST EMAIL — this report was sent from Settings &gt; Test Submit and was not recorded as today's submission.
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

      ${completedTasks.length > 0 ? `
      <h2 style="font-size:14px;font-weight:600;color:#22c55e;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Completed (${completedTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${completedRows}
      </table>` : ""}

      ${incompleteTasks.length > 0 ? `
      <h2 style="font-size:14px;font-weight:600;color:#f59e0b;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Not Completed (${incompleteTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${incompleteRows}
      </table>` : ""}

      ${postedForFutureTasks.length > 0 ? `
      <h2 style="font-size:14px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Posted for Future (${postedForFutureTasks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        ${postedForFutureRows}
      </table>` : ""}
    </div>
  </div>
</body>
</html>`;

  try {
    const subjectPrefix = options.test ? "[TEST] " : "";
    await transport.sendMail({
      from: `"Daily Tasks" <${gmailUser}>`,
      to: recipients.join(", "),
      subject: `${subjectPrefix}Daily Task Report — ${safeDate} (${completedTasks.length}/${activeTasks.length} completed)`,
      html,
    });
    return { success: true, message: `Report sent to ${recipients.join(", ")}` };
  } catch (err: any) {
    return { success: false, message: `Failed to send email: ${err?.message ?? "Unknown error"}` };
  }
}
