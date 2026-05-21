import { and, eq, inArray } from "drizzle-orm";
import { db, taskListsTable, tasksTable, userSettingsTable } from "@workspace/db";
import { sendDailyReport } from "./email";
import { getLocalDateString } from "./carryover";
import { logger } from "./logger";

// How often to check the clock (every 30 seconds).
const POLL_INTERVAL_MS = 30_000;

// Auto-submit fires at 23:59 local server time.
const AUTO_SUBMIT_HOUR = 23;
const AUTO_SUBMIT_MINUTE = 59;

// Track which date we already ran the auto-submit for so we don't fire twice.
let lastAutoSubmitDate = "";

async function runAutoSubmit(): Promise<void> {
  const today = getLocalDateString();

  // Find all task lists for today that are checked-in but not yet submitted.
  const pendingLists = await db
    .select()
    .from(taskListsTable)
    .where(
      and(
        eq(taskListsTable.date, today),
        eq(taskListsTable.checkedIn, true),
        eq(taskListsTable.submitted, false),
      ),
    );

  if (pendingLists.length === 0) {
    logger.info("Auto-submit: no pending checked-in lists to submit");
    return;
  }

  // Filter out users who have disabled autoSubmit or today is not a work day.
  const userIds = pendingLists.map((tl) => tl.userId);
  const settingsList = await db
    .select()
    .from(userSettingsTable)
    .where(inArray(userSettingsTable.userId, userIds));

  const settingsMap = new Map(settingsList.map((s) => [s.userId, s]));
  const todayDow = new Date().getDay(); // 0=Sun … 6=Sat

  const eligibleLists = pendingLists.filter((tl) => {
    const s = settingsMap.get(tl.userId);
    // Default to true / Mon–Fri when no settings row exists yet.
    if (!(s?.autoSubmit ?? true)) return false;
    const workDays = (s?.workDays ?? "1,2,3,4,5")
      .split(",")
      .map((d) => parseInt(d.trim(), 10))
      .filter((n) => !isNaN(n));
    return workDays.includes(todayDow);
  });

  if (eligibleLists.length === 0) {
    logger.info("Auto-submit: all pending users have autoSubmit disabled");
    return;
  }

  logger.info(
    { count: eligibleLists.length },
    "Auto-submit: submitting pending checked-in lists",
  );

  for (const taskList of eligibleLists) {
    try {
      // Mark submitted first so a transient email failure never blocks completion.
      await db
        .update(taskListsTable)
        .set({ submitted: true, submittedAt: new Date() })
        .where(eq(taskListsTable.id, taskList.id));

      const tasks = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.taskListId, taskList.id))
        .orderBy(tasksTable.position);

      const settings = settingsMap.get(taskList.userId);
      const recipientEmails = settings?.recipientEmails ?? "";

      const result = await sendDailyReport(
        recipientEmails,
        today,
        tasks.map((t) => ({
          text: t.text,
          completed: t.completed,
          note: t.note ?? "",
          postedForFuture: t.postedForFuture,
        })),
        taskList.userId,
      );

      logger.info(
        { userId: taskList.userId, success: result.success, message: result.message },
        "Auto-submit: email result",
      );
    } catch (err: any) {
      logger.error(
        { userId: taskList.userId, err: err?.message },
        "Auto-submit: failed for user",
      );
    }
  }
}

function tick(): void {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const today = getLocalDateString(now);

  if (
    hour === AUTO_SUBMIT_HOUR &&
    minute === AUTO_SUBMIT_MINUTE &&
    lastAutoSubmitDate !== today
  ) {
    lastAutoSubmitDate = today;
    logger.info("Auto-submit: 11:59 PM reached — running auto-submit");
    runAutoSubmit().catch((err) => {
      logger.error({ err }, "Auto-submit: unhandled error in runAutoSubmit");
    });
  }
}

export function startAutoSubmitScheduler(): void {
  logger.info("Auto-submit scheduler started (polls every 30 s, fires at 23:59)");
  setInterval(tick, POLL_INTERVAL_MS);
  // Run a tick immediately so we don't miss the window if the server starts at 23:59.
  tick();
}
