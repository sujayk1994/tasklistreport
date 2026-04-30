import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { clerkClient } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import {
  db,
  printShipmentsTable,
  processedEmailsTable,
  type PrintShipment,
} from "@workspace/db";
import { logger } from "./logger";
import {
  ensureTodayList,
  appendTasksDeduped,
  getLocalDateString,
} from "./carryover";

type ReminderKind = "twitter marketing" | "Reprints";

const SUBJECT_MAP: { match: RegExp; kind: ReminderKind }[] = [
  { match: /twitter\s+marketing\s+reminder/i, kind: "twitter marketing" },
  { match: /reprint\s+reminder/i, kind: "Reprints" },
];

const SHIPMENT_SUBJECT =
  /shipment\s+copies\s+summary|copies\s+required/i;

// Number of days between a Print task and its automatically-generated
// Shipment follow-up task.
const SHIPMENT_DELAY_DAYS = 3;
// Subtracted from print copies to compute the shipment copies count.
const SHIPMENT_COPIES_OFFSET = 2;

export function parseReminderEmail(
  subject: string,
  body: string,
): { kind: ReminderKind; tasks: string[] } | null {
  const sub = SUBJECT_MAP.find((s) => s.match.test(subject));
  if (!sub) return null;

  const startMatch = body.match(/sent\s+today\s*:/i);
  if (!startMatch) return null;
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
      tasks.push(`${currentBrand} - ${subItem[1].trim()} - ${sub.kind}`);
      continue;
    }

    const stripped = raw.trim();
    const dashIdx = stripped.indexOf(" - ");
    if (dashIdx > 0) {
      currentBrand = stripped.slice(0, dashIdx).trim();
      tasks.push(`${stripped} - ${sub.kind}`);
    }
  }

  return { kind: sub.kind, tasks };
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
export function parseShipmentEmail(
  subject: string,
  body: string,
): ShipmentEntry[] | null {
  if (!SHIPMENT_SUBJECT.test(subject)) return null;

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
      const inserted = await appendTasksDeduped(list.id, tasks);
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

async function processMessage(message: FetchMessageObject): Promise<boolean> {
  const source = message.source;
  if (!source) return false;
  const parsed = await simpleParser(source);
  const subject = parsed.subject ?? "";
  const body = parsed.text ?? "";

  // Twitter Marketing / Reprint reminders.
  const reminder = parseReminderEmail(subject, body);
  if (reminder) {
    logger.info(
      { subject, kind: reminder.kind, count: reminder.tasks.length },
      "inbox: parsed reminder email",
    );
    await ingestTasksForAllUsers(reminder.tasks);
    return true;
  }

  // Shipment Copies Summary — creates a Print task today and schedules a
  // Shipment task 3 business days later (skipping weekends).
  const shipment = parseShipmentEmail(subject, body);
  if (shipment) {
    logger.info(
      { subject, count: shipment.length },
      "inbox: parsed shipment email",
    );
    await processShipmentEmail(shipment);
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

async function processShipmentEmail(entries: ShipmentEntry[]): Promise<void> {
  const today = getLocalDateString();
  const shipmentDate = computeShipmentDate(today);

  const printTasks = entries.map(formatPrintTask);
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
          const isInteresting =
            SUBJECT_MAP.some((s) => s.match.test(subject)) ||
            SHIPMENT_SUBJECT.test(subject);
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

          const handled = await processMessage(msg);
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
