import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { clerkClient } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import {
  db,
  printShipmentsTable,
  processedEmailsTable,
  inboxRulesTable,
  type PrintShipment,
  type InboxRule,
} from "@workspace/db";
import { logger } from "./logger";
import {
  ensureTodayList,
  appendTasksDeduped,
  appendTasksWithNotesDeduped,
  getLocalDateString,
} from "./carryover";

type ReminderKind = "twitter marketing" | "Reprints";

const SUBJECT_MAP: { match: RegExp; kind: ReminderKind }[] = [
  { match: /twitter\s+marketing\s+reminder/i, kind: "twitter marketing" },
  { match: /reprint\s+reminder/i, kind: "Reprints" },
];

const SHIPMENT_SUBJECT =
  /shipment\s+copies\s+summary|copies\s+required/i;

const PENDING_LIST_SUBJECT = /pending\s+list/i;

// Number of days between a Print task and its automatically-generated
// Shipment follow-up task.
const SHIPMENT_DELAY_DAYS = 3;
// Subtracted from print copies to compute the shipment copies count.
const SHIPMENT_COPIES_OFFSET = 2;

/**
 * subject_as_task — the email subject becomes the task title and the body
 * (trimmed) is stored as the task note. Returns null if subject is empty.
 */
export function parseSubjectAsTask(
  subject: string,
  body: string,
): { title: string; note: string } | null {
  const title = subject.trim();
  if (!title) return null;
  return { title, note: body.trim() };
}

/**
 * bullet_list — lines that begin with a bullet marker (-, *, •, –)
 * each become a separate task. Indented sub-bullets are ignored.
 */
export function parseBulletListBodyOnly(body: string): string[] {
  const cleaned = body.replace(/\u00a0/g, " ");
  const tasks: string[] = [];
  for (const raw of cleaned.split(/\r?\n/)) {
    const m = raw.match(/^[\s]*[-*•–]\s+(.+)$/);
    if (m) {
      const text = m[1].trim();
      if (text) tasks.push(text);
    }
  }
  return tasks;
}

/**
 * plain_lines — every non-empty line in the body becomes a separate task.
 * Greeting lines ("Hi …,"), separator lines ("--", "---"), and common
 * signature patterns ("Thanks", "Regards", "Best") are stripped.
 */
export function parsePlainLinesBodyOnly(body: string): string[] {
  const cleaned = body.replace(/\u00a0/g, " ");
  const SKIP = /^(hi\b|hello\b|hey\b|dear\b|thanks|thank you|regards|best|cheers|sincerely|--+)/i;
  return cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !SKIP.test(l));
}

// ---------------------------------------------------------------------------
// Urgency detection — applies to ALL parsers and both code paths
// ---------------------------------------------------------------------------

const URGENCY_RE = /\b(urgent|urgently|priority|asap|immediately|critical)\b/i;

/**
 * Returns true if "urgent", "priority", "asap", etc. appear anywhere in
 * the email subject or body (case-insensitive, whole-word match).
 */
export function detectUrgency(subject: string, body: string): boolean {
  return URGENCY_RE.test(subject) || URGENCY_RE.test(body);
}

/**
 * Appends " - urgent" to each task text when the email was detected as
 * urgent — but only if the text doesn't already contain an urgency word,
 * preventing redundant markers like "URGENT design - urgent".
 */
export function markUrgentTasks(tasks: string[], urgent: boolean): string[] {
  if (!urgent) return tasks;
  return tasks.map((t) => (URGENCY_RE.test(t) ? t : `${t} - urgent`));
}

/**
 * Same as markUrgentTasks but for tasks that also carry a note.
 */
export function markUrgentTasksWithNotes(
  tasks: { text: string; note?: string | null }[],
  urgent: boolean,
): { text: string; note?: string | null }[] {
  if (!urgent) return tasks;
  return tasks.map((t) => ({
    ...t,
    text: URGENCY_RE.test(t.text) ? t.text : `${t.text} - urgent`,
  }));
}

/**
 * Body-only reminder parser — extracts tasks from the "sent today:" section
 * without checking the subject. Exported so DB-driven rules can use it with
 * a custom taskSuffix.
 */
export function parseReminderBodyOnly(
  body: string,
  taskSuffix: string,
): string[] {
  const startMatch = body.match(/sent\s+today\s*:/i);
  if (!startMatch) return [];
  const startIdx = startMatch.index! + startMatch[0].length;

  const endMatch = body.slice(startIdx).match(/best\s+regards/i);
  const endIdx = endMatch ? startIdx + endMatch.index! : body.length;

  const section = body.slice(startIdx, endIdx);
  const lines = section
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").trimEnd());

  const tasks: string[] = [];
  let currentBrand = "";

  for (const raw of lines) {
    if (!raw.trim()) continue;

    const subItem = raw.match(/^\s+[-•*]\s+(.+)$/);
    if (subItem && currentBrand) {
      tasks.push(`${currentBrand} - ${subItem[1].trim()} - ${taskSuffix}`);
      continue;
    }

    const stripped = raw.trim();
    const dashIdx = stripped.indexOf(" - ");
    if (dashIdx > 0) {
      currentBrand = stripped.slice(0, dashIdx).trim();
      tasks.push(`${stripped} - ${taskSuffix}`);
    }
  }

  return tasks;
}

export function parseReminderEmail(
  subject: string,
  body: string,
): { kind: ReminderKind; tasks: string[] } | null {
  const sub = SUBJECT_MAP.find((s) => s.match.test(subject));
  if (!sub) return null;
  const tasks = parseReminderBodyOnly(body, sub.kind);
  return tasks.length > 0 ? { kind: sub.kind, tasks } : null;
}

/**
 * Parses a "Pending List" email body. Each numbered line ("1. ...", "2. ...")
 * becomes one task. Greetings, signatures, separators, and any unnumbered
 * lines are ignored.
 *
 * Example body:
 *   1. Need logos of Eclipse Automation_Digital Factory ...
 *   2. Additional Change_PDF_Shugarman Architecture ...
 *   --
 *   Vishnu Santhosh
 *   Managing Editor
 *
 * Returns the list of task strings (without the leading number), or null if
 * the subject doesn't look like a Pending List email.
 */
/**
 * Body-only pending-list parser. Exported for DB-driven rules.
 */
export function parsePendingListBodyOnly(body: string): string[] | null {
  const cleaned = body.replace(/\u00a0/g, " ");
  const lines = cleaned.split(/\r?\n/);

  const tasks: string[] = [];
  let currentTask = "";

  const flush = () => {
    const t = currentTask.trim();
    if (t) tasks.push(t);
    currentTask = "";
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^-{2,}\s*$/.test(line)) { flush(); break; }
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) { flush(); currentTask = numbered[2].trim(); continue; }
    if (currentTask && line) currentTask += ` ${line}`;
  }

  flush();
  return tasks.length > 0 ? tasks : null;
}

export function parsePendingListEmail(
  subject: string,
  body: string,
): string[] | null {
  if (!PENDING_LIST_SUBJECT.test(subject)) return null;
  return parsePendingListBodyOnly(body);
}

export type ShipmentEntry = {
  magazine: string;
  project: string;
  copies: number;
};

/**
 * Parses a "Shipment Copies Summary" email body. Each entry in the body
 * looks like:
 *
 *   Magazine: <name>
 *   Project: <name>
 *   <copies>
 *
 * Multiple entries can appear in a single email.
 */
/**
 * Parses an "Ad Request" email body.
 * Skips the opening "Hi [name]," greeting, then treats the very next
 * non-empty line as the task title. Everything after that (trimmed of
 * trailing whitespace/empty lines) becomes the task note / details.
 *
 * Example body:
 *   Hi Sujay,
 *
 *   Please design a full page ad for the below company.
 *
 *   Construction Business Outlook
 *   …
 *
 * Returns { title, details } or null if no title could be extracted.
 */
export function parseAdRequestBodyOnly(
  body: string,
): { title: string; details: string } | null {
  const lines = body.replace(/\u00a0/g, " ").split(/\r?\n/);

  let pastGreeting = false;
  let title = "";
  const detailLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (!pastGreeting) {
      // Skip leading blank lines and the "Hi …," greeting
      if (!line) continue;
      if (/^hi\b/i.test(line)) { pastGreeting = true; continue; }
      // No greeting found — treat first non-empty line as title directly
      pastGreeting = true;
      title = line;
      continue;
    }

    if (!title) {
      if (!line) continue; // skip blank lines between greeting and title
      title = line;
      continue;
    }

    detailLines.push(raw);
  }

  if (!title) return null;

  // Trim trailing blank lines from details
  while (detailLines.length > 0 && !detailLines[detailLines.length - 1].trim()) {
    detailLines.pop();
  }

  return { title, details: detailLines.join("\n").trim() };
}

/**
 * Body-only shipment parser. Exported for DB-driven rules.
 */
export function parseShipmentBodyOnly(body: string): ShipmentEntry[] | null {
  const cleaned = body.replace(/\u00a0/g, " ");
  const re =
    /Magazine\s*:\s*(.+?)\s*[\r\n]+\s*Project\s*:\s*(.+?)\s*[\r\n]+\s*(\d+)/gi;

  const entries: ShipmentEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const magazine = m[1].trim();
    const project = m[2].trim();
    const copies = Number.parseInt(m[3], 10);
    if (magazine && project && Number.isFinite(copies)) {
      entries.push({ magazine, project, copies });
    }
  }
  return entries.length > 0 ? entries : null;
}

export function parseShipmentEmail(
  subject: string,
  body: string,
): ShipmentEntry[] | null {
  if (!SHIPMENT_SUBJECT.test(subject)) return null;
  return parseShipmentBodyOnly(body);
}

export function formatPrintTask(entry: ShipmentEntry): string {
  return `Print: ${entry.magazine} - ${entry.project} - ${entry.copies} copies`;
}

export function formatShipmentTask(
  magazine: string,
  project: string,
  copies: number,
): string {
  return `Shipment: ${magazine} - ${project} - ${copies} copies`;
}

/**
 * Computes the shipment follow-up date from a print date, skipping weekends:
 *   1. If the print date is a Friday, Saturday, or Sunday, shift the start to
 *      the next Monday (counting begins on Monday).
 *   2. Add the shipment delay (3 calendar days).
 *   3. If the result lands on a Saturday or Sunday, shift it forward to the
 *      next Monday.
 *
 * Examples:
 *   Mon 23 → Thu 26
 *   Wed 25 → Sat → shift → Mon 30
 *   Fri 27 → start shifts to Mon 30, +3 → Thu 2 (next month)
 */
export function computeShipmentDate(printDateISO: string): string {
  const d = new Date(`${printDateISO}T00:00:00Z`);

  let dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  if (dow === 5) d.setUTCDate(d.getUTCDate() + 3); // Fri → Mon
  else if (dow === 6) d.setUTCDate(d.getUTCDate() + 2); // Sat → Mon
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → Mon

  d.setUTCDate(d.getUTCDate() + SHIPMENT_DELAY_DAYS);

  dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2); // Sat → Mon
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → Mon

  return d.toISOString().split("T")[0];
}

async function listAllUserIds(): Promise<string[]> {
  try {
    const res = await clerkClient.users.getUserList({ limit: 200 });
    return res.data.map((u) => u.id);
  } catch (err) {
    logger.warn({ err }, "inbox: could not list Clerk users");
    return [];
  }
}

async function ingestTasksForAllUsers(
  tasks: string[],
  date: string = getLocalDateString(),
): Promise<void> {
  if (tasks.length === 0) return;

  const userIds = await listAllUserIds();
  if (userIds.length === 0) {
    logger.info("inbox: no users yet — skipping ingestion");
    return;
  }

  for (const userId of userIds) {
    try {
      const list = await ensureTodayList(userId, date);
      const inserted = await appendTasksDeduped(list.id, tasks, "inbox");
      if (inserted > 0) {
        logger.info(
          { userId, inserted, total: tasks.length, date },
          "inbox: ingested tasks",
        );
      }
    } catch (err) {
      logger.error({ err, userId }, "inbox: failed to ingest for user");
    }
  }
}

async function ingestTasksWithNotesForAllUsers(
  tasks: Array<{ text: string; note: string }>,
  date: string = getLocalDateString(),
): Promise<void> {
  if (tasks.length === 0) return;

  const userIds = await listAllUserIds();
  if (userIds.length === 0) {
    logger.info("inbox: no users yet — skipping ingestion");
    return;
  }

  for (const userId of userIds) {
    try {
      const list = await ensureTodayList(userId, date);
      const inserted = await appendTasksWithNotesDeduped(list.id, tasks, "inbox");
      if (inserted > 0) {
        logger.info(
          { userId, inserted, total: tasks.length, date },
          "inbox: ingested tasks with notes",
        );
      }
    } catch (err) {
      logger.error({ err, userId }, "inbox: failed to ingest for user");
    }
  }
}

async function processMessage(message: FetchMessageObject): Promise<boolean> {
  const source = message.source;
  if (!source) return false;
  const parsed = await simpleParser(source);
  const subject = parsed.subject ?? "";
  const body = parsed.text ?? "";

  const urgent = detectUrgency(subject, body);

  // Twitter Marketing / Reprint reminders.
  const reminder = parseReminderEmail(subject, body);
  if (reminder) {
    logger.info(
      { subject, kind: reminder.kind, count: reminder.tasks.length, urgent },
      "inbox: parsed reminder email",
    );
    await ingestTasksForAllUsers(markUrgentTasks(reminder.tasks, urgent));
    return true;
  }

  // Pending List — each numbered item becomes a task on today's list.
  const pending = parsePendingListEmail(subject, body);
  if (pending) {
    logger.info(
      { subject, count: pending.length, urgent },
      "inbox: parsed pending list email",
    );
    await ingestTasksForAllUsers(markUrgentTasks(pending, urgent));
    return true;
  }

  // Shipment Copies Summary — creates a Print task today and schedules a
  // Shipment task 3 business days later (skipping weekends).
  const shipment = parseShipmentEmail(subject, body);
  if (shipment) {
    logger.info(
      { subject, count: shipment.length, urgent },
      "inbox: parsed shipment email",
    );
    await processShipmentEmail(shipment, urgent);
    return true;
  }

  return false;
}

// Today's local list must contain ONLY tasks generated from emails that
// arrived today. Yesterday's tasks (whether the user completed them,
// deleted them, or never touched them) must never re-enter today's list
// via the IMAP poller. Two layers protect this invariant:
//
//   1. IMAP `since` filter: only fetch messages from the start of today.
//   2. `isReceivedToday` hard guard: re-check the message's internalDate
//      after fetching, in case the IMAP server interprets `since` loosely
//      around the midnight boundary or returns borderline matches.
//
// The `processed_emails` dedup table on top of that gives idempotency
// across multiple polls within the same day.
function getStartOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function isReceivedToday(message: FetchMessageObject): boolean {
  const internal = message.internalDate;
  if (!internal) return false;
  const d = internal instanceof Date ? internal : new Date(internal);
  if (isNaN(d.getTime())) return false;
  return getLocalDateString(d) === getLocalDateString();
}

async function isAlreadyProcessed(messageId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(processedEmailsTable)
      .where(eq(processedEmailsTable.messageId, messageId))
      .limit(1);
    return Boolean(row);
  } catch (err) {
    logger.warn({ err, messageId }, "inbox: processed-email lookup failed");
    // Fail safe: treat as processed so we don't risk duplicate ingestion.
    return true;
  }
}

async function markProcessed(
  messageId: string,
  subject: string,
): Promise<void> {
  try {
    await db
      .insert(processedEmailsTable)
      .values({ messageId, subject })
      .onConflictDoNothing({ target: processedEmailsTable.messageId });
  } catch (err) {
    logger.warn({ err, messageId }, "inbox: failed to mark email processed");
  }
}

async function processShipmentEmail(entries: ShipmentEntry[], urgent = false): Promise<void> {
  const today = getLocalDateString();
  const shipmentDate = computeShipmentDate(today);

  const printTasks = markUrgentTasks(entries.map(formatPrintTask), urgent);
  await ingestTasksForAllUsers(printTasks, today);

  // Persist a schedule row per (magazine, project, today). Idempotent thanks
  // to the unique index, so re-polling the same email doesn't double-schedule.
  for (const entry of entries) {
    try {
      await db
        .insert(printShipmentsTable)
        .values({
          magazine: entry.magazine,
          project: entry.project,
          printCopies: entry.copies,
          printDate: today,
          shipmentDate,
          shipmentCreated: false,
        })
        .onConflictDoNothing({
          target: [
            printShipmentsTable.magazine,
            printShipmentsTable.project,
            printShipmentsTable.printDate,
          ],
        });
    } catch (err) {
      logger.error(
        { err, entry },
        "inbox: failed to persist print/shipment schedule",
      );
    }
  }
}

/**
 * Parses the text of a Print task created from a "Copies Required" email.
 * Format: "Print: <Magazine> - <Project> - <N> copies"
 */
export function parsePrintTaskText(
  text: string,
): { magazine: string; project: string } | null {
  const m = text.match(
    /^Print:\s*(.+?)\s*-\s*(.+?)\s*-\s*\d+\s*copies\s*$/i,
  );
  if (!m) return null;
  return { magazine: m[1].trim(), project: m[2].trim() };
}

/**
 * Called when a user marks a Print task complete. Looks up any pending
 * shipment row(s) for the same magazine/project and, if found, creates the
 * Shipment follow-up task on every user's today list. Idempotent: marks the
 * row as fulfilled so it never fires twice.
 */
export async function triggerShipmentForCompletedPrint(
  taskText: string,
): Promise<void> {
  const parsed = parsePrintTaskText(taskText);
  if (!parsed) return;

  let rows: PrintShipment[] = [];
  try {
    rows = await db
      .select()
      .from(printShipmentsTable)
      .where(
        and(
          eq(printShipmentsTable.magazine, parsed.magazine),
          eq(printShipmentsTable.project, parsed.project),
          eq(printShipmentsTable.shipmentCreated, false),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, parsed },
      "inbox: could not query pending shipments on print completion",
    );
    return;
  }

  if (rows.length === 0) return;

  const today = getLocalDateString();
  for (const row of rows) {
    const copies = row.printCopies - SHIPMENT_COPIES_OFFSET;
    const text = formatShipmentTask(row.magazine, row.project, copies);

    try {
      await ingestTasksForAllUsers([text], today);
      await db
        .update(printShipmentsTable)
        .set({ shipmentCreated: true })
        .where(eq(printShipmentsTable.id, row.id));
      logger.info(
        {
          magazine: row.magazine,
          project: row.project,
          copies,
          printDate: row.printDate,
        },
        "inbox: created shipment task triggered by print completion",
      );
    } catch (err) {
      logger.error(
        { err, scheduleId: row.id },
        "inbox: failed to create shipment on print completion",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// DB-driven rule loading and processing
// ---------------------------------------------------------------------------

async function loadEnabledDbRules(): Promise<InboxRule[]> {
  try {
    return await db
      .select()
      .from(inboxRulesTable)
      .where(eq(inboxRulesTable.enabled, true));
  } catch (err) {
    logger.warn({ err }, "inbox: could not load DB rules — falling back to hardcoded");
    return [];
  }
}

async function processMessageWithDbRules(
  message: FetchMessageObject,
  rules: InboxRule[],
): Promise<boolean> {
  const source = message.source;
  if (!source) return false;
  const parsed = await simpleParser(source);
  const subject = parsed.subject ?? "";
  const body = parsed.text ?? "";

  const urgent = detectUrgency(subject, body);

  let handled = false;
  for (const rule of rules) {
    let re: RegExp;
    try { re = new RegExp(rule.subjectPattern, "i"); } catch { continue; }
    if (!re.test(subject)) continue;

    if (rule.parserType === "reminder") {
      const suffix = rule.taskSuffix ?? rule.label;
      const tasks = markUrgentTasks(parseReminderBodyOnly(body, suffix), urgent);
      if (tasks.length > 0) {
        logger.info({ subject, rule: rule.label, count: tasks.length, urgent }, "inbox: DB rule matched (reminder)");
        await ingestTasksForAllUsers(tasks);
        handled = true;
      }
    } else if (rule.parserType === "pending_list") {
      const raw = parsePendingListBodyOnly(body);
      const tasks = markUrgentTasks(raw ?? [], urgent);
      if (tasks.length > 0) {
        logger.info({ subject, rule: rule.label, count: tasks.length, urgent }, "inbox: DB rule matched (pending_list)");
        await ingestTasksForAllUsers(tasks);
        handled = true;
      }
    } else if (rule.parserType === "shipment") {
      const entries = parseShipmentBodyOnly(body);
      if (entries && entries.length > 0) {
        logger.info({ subject, rule: rule.label, count: entries.length, urgent }, "inbox: DB rule matched (shipment)");
        await processShipmentEmail(entries, urgent);
        handled = true;
      }
    } else if (rule.parserType === "ad_request") {
      const result = parseAdRequestBodyOnly(body);
      if (result) {
        logger.info({ subject, rule: rule.label, title: result.title, urgent }, "inbox: DB rule matched (ad_request)");
        const [marked] = markUrgentTasksWithNotes([{ text: result.title, note: result.details }], urgent);
        await ingestTasksWithNotesForAllUsers([marked]);
        handled = true;
      }
    } else if (rule.parserType === "subject_as_task") {
      const result = parseSubjectAsTask(subject, body);
      if (result) {
        logger.info({ subject, rule: rule.label, urgent }, "inbox: DB rule matched (subject_as_task)");
        const [marked] = markUrgentTasksWithNotes([{ text: result.title, note: result.note }], urgent);
        await ingestTasksWithNotesForAllUsers([marked]);
        handled = true;
      }
    } else if (rule.parserType === "bullet_list") {
      const tasks = markUrgentTasks(parseBulletListBodyOnly(body), urgent);
      if (tasks.length > 0) {
        logger.info({ subject, rule: rule.label, count: tasks.length, urgent }, "inbox: DB rule matched (bullet_list)");
        await ingestTasksForAllUsers(tasks);
        handled = true;
      }
    } else if (rule.parserType === "plain_lines") {
      const tasks = markUrgentTasks(parsePlainLinesBodyOnly(body), urgent);
      if (tasks.length > 0) {
        logger.info({ subject, rule: rule.label, count: tasks.length, urgent }, "inbox: DB rule matched (plain_lines)");
        await ingestTasksForAllUsers(tasks);
        handled = true;
      }
    }
  }
  return handled;
}

let pollTimer: NodeJS.Timeout | null = null;
let polling = false;

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    polling = false;
    return;
  }

  // Load DB rules once per poll. If DB has any enabled rules, they take
  // over from the hardcoded patterns. If the table is empty (or on DB
  // error), we fall back to the original hardcoded behaviour.
  const dbRules = await loadEnabledDbRules();
  const useDbRules = dbRules.length > 0;

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Scan ONLY emails received today. Combined with the
      // `isReceivedToday` re-check below and the `processed_emails`
      // dedup table, this guarantees today's task list cannot be
      // populated from yesterday's (or older) emails — so anything the
      // user deleted or completed yesterday will not come back.
      const since = getStartOfToday();
      const uids = await client.search({ since }, { uid: true });
      if (uids && uids.length > 0) {
        for (const uid of uids) {
          const msg = await client.fetchOne(
            String(uid),
            { source: true, envelope: true, internalDate: true },
            { uid: true },
          );
          if (!msg) continue;

          const subject = msg.envelope?.subject ?? "";
          const isInteresting = useDbRules
            ? dbRules.some((r) => { try { return new RegExp(r.subjectPattern, "i").test(subject); } catch { return false; } })
            : (SUBJECT_MAP.some((s) => s.match.test(subject)) ||
               SHIPMENT_SUBJECT.test(subject) ||
               PENDING_LIST_SUBJECT.test(subject));
          if (!isInteresting) continue;

          // Hard date guard: even if IMAP returned a borderline match
          // around midnight, the email itself MUST have been received
          // today. Yesterday's emails are dropped here.
          if (!isReceivedToday(msg)) continue;

          // Stable per-email identifier. Prefer RFC Message-ID; fall back
          // to a UID-based key so we still get idempotency if it's missing.
          const messageId =
            msg.envelope?.messageId ?? `uid:${user}:${String(uid)}`;

          if (await isAlreadyProcessed(messageId)) continue;

          const handled = useDbRules
            ? await processMessageWithDbRules(msg, dbRules)
            : await processMessage(msg);
          if (handled) {
            await markProcessed(messageId, subject);
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "inbox: poll failed");
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    polling = false;
  }
}

export function startInboxPoller(intervalMs = 60_000): void {
  if (pollTimer) return;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    logger.info(
      "inbox: GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping IMAP poller",
    );
    return;
  }

  logger.info({ intervalMs, user }, "inbox: starting IMAP poller");

  pollOnce().catch(() => {});
  pollTimer = setInterval(() => {
    pollOnce().catch(() => {});
  }, intervalMs);
}

export function stopInboxPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
