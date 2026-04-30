import { Router } from "express";
import { db, taskListsTable, tasksTable, userSettingsTable } from "@workspace/db";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { requireAuth, getUserId } from "../lib/auth";
import { sendDailyReport } from "../lib/email";
import { ensureTodayList, getLocalDateString } from "../lib/carryover";
import { triggerShipmentForCompletedPrint } from "../lib/inbox";

const router = Router();

const MAX_TASKS = 100;
const MAX_TASK_LENGTH = 500;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  if (!DATE_REGEX.test(date)) return false;
  const d = new Date(date);
  return !isNaN(d.getTime());
}

type DbTask = typeof tasksTable.$inferSelect;

function serializeTask(t: DbTask) {
  return {
    id: t.id,
    text: t.text,
    completed: t.completed,
    note: t.note,
    position: t.position,
    postedForFuture: t.postedForFuture,
    createdAt: t.createdAt.toISOString(),
  };
}

router.get("/tasks/today", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  await ensureTodayList(userId, today);

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.json({ id: 0, date: today, submitted: false, submittedAt: null, tasks: [] });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskList.id))
    .orderBy(tasksTable.position);

  res.json({
    id: taskList.id,
    date: taskList.date,
    submitted: taskList.submitted,
    submittedAt: taskList.submittedAt?.toISOString() ?? null,
    tasks: tasks.map(serializeTask),
  });
});

router.post("/tasks/today", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();
  const { rawText } = req.body as { rawText?: unknown };

  if (typeof rawText !== "string") {
    res.status(400).json({ error: "rawText must be a string." });
    return;
  }

  if (rawText.length > MAX_TASKS * MAX_TASK_LENGTH) {
    res.status(400).json({ error: "Input too large." });
    return;
  }

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_TASKS);

  const invalidLine = lines.find((l) => l.length > MAX_TASK_LENGTH);
  if (invalidLine) {
    res.status(400).json({ error: `Each task must be ${MAX_TASK_LENGTH} characters or fewer.` });
    return;
  }

  const existing = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  let taskListId: number;

  if (existing.length > 0) {
    taskListId = existing[0].id;
    await db.delete(tasksTable).where(eq(tasksTable.taskListId, taskListId));
  } else {
    const [newList] = await db
      .insert(taskListsTable)
      .values({ userId, date: today, submitted: false })
      .returning();
    taskListId = newList.id;
  }

  if (lines.length > 0) {
    await db.insert(tasksTable).values(
      lines.map((text, i) => ({ taskListId, text, completed: false, position: i }))
    );
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.id, taskListId))
    .limit(1);

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskListId))
    .orderBy(tasksTable.position);

  res.json({
    id: taskList.id,
    date: taskList.date,
    submitted: taskList.submitted,
    submittedAt: taskList.submittedAt?.toISOString() ?? null,
    tasks: tasks.map(serializeTask),
  });
});

router.post("/tasks/today/add", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();
  const { rawText } = req.body as { rawText?: unknown };

  if (typeof rawText !== "string") {
    res.status(400).json({ error: "rawText must be a string." });
    return;
  }

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_TASKS);

  const invalidLine = lines.find((l) => l.length > MAX_TASK_LENGTH);
  if (invalidLine) {
    res.status(400).json({ error: `Each task must be ${MAX_TASK_LENGTH} characters or fewer.` });
    return;
  }

  let [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  let taskListId: number;

  if (!taskList) {
    const [newList] = await db
      .insert(taskListsTable)
      .values({ userId, date: today, submitted: false })
      .returning();
    taskList = newList;
    taskListId = newList.id;
  } else {
    taskListId = taskList.id;
  }

  if (lines.length > 0) {
    const existing = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.taskListId, taskListId));
    const nextPosition = existing.length;

    await db.insert(tasksTable).values(
      lines.map((text, i) => ({ taskListId, text, completed: false, position: nextPosition + i }))
    );
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskListId))
    .orderBy(tasksTable.position);

  res.json({
    id: taskList.id,
    date: taskList.date,
    submitted: taskList.submitted,
    submittedAt: taskList.submittedAt?.toISOString() ?? null,
    tasks: tasks.map(serializeTask),
  });
});

router.delete("/tasks/today/delete", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();
  const { taskId } = req.body as { taskId?: unknown };

  if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId." });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.taskListId, taskList.id)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, taskId));

  res.json({ success: true, message: "Task removed." });
});

router.delete("/tasks/today/reset", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.json({ success: true, message: "Nothing to reset." });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.taskListId, taskList.id));
  await db.delete(taskListsTable).where(eq(taskListsTable.id, taskList.id));

  res.json({ success: true, message: "Day reset successfully." });
});

router.patch("/tasks/today/toggle", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { taskId } = req.body as { taskId?: unknown };
  const today = getLocalDateString();

  if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId." });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.taskListId, taskList.id)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ completed: !task.completed })
    .where(eq(tasksTable.id, taskId))
    .returning();

  // If a Print task was just marked complete, trigger its Shipment follow-up.
  if (updated.completed && !task.completed) {
    try {
      await triggerShipmentForCompletedPrint(updated.text);
    } catch {
      // Logged inside the helper; never block the toggle response.
    }
  }

  res.json(serializeTask(updated));
});

router.patch("/tasks/today/note", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { taskId, note } = req.body as { taskId?: unknown; note?: unknown };
  const today = getLocalDateString();

  if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId." });
    return;
  }

  if (typeof note !== "string") {
    res.status(400).json({ error: "note must be a string." });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.taskListId, taskList.id)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ note })
    .where(eq(tasksTable.id, taskId))
    .returning();

  res.json(serializeTask(updated));
});

router.patch("/tasks/today/text", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { taskId, text } = req.body as { taskId?: unknown; text?: unknown };
  const today = getLocalDateString();

  if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId." });
    return;
  }

  if (typeof text !== "string") {
    res.status(400).json({ error: "text must be a string." });
    return;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    res.status(400).json({ error: "Task text cannot be empty." });
    return;
  }
  if (trimmed.length > MAX_TASK_LENGTH) {
    res.status(400).json({ error: `Task text must be ${MAX_TASK_LENGTH} characters or fewer.` });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.taskListId, taskList.id)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ text: trimmed })
    .where(eq(tasksTable.id, taskId))
    .returning();

  res.json(serializeTask(updated));
});

router.patch("/tasks/today/posted-for-future", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { taskId, postedForFuture } = req.body as {
    taskId?: unknown;
    postedForFuture?: unknown;
  };
  const today = getLocalDateString();

  if (typeof taskId !== "number" || !Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId." });
    return;
  }

  if (typeof postedForFuture !== "boolean") {
    res.status(400).json({ error: "postedForFuture must be a boolean." });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.taskListId, taskList.id)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ postedForFuture })
    .where(eq(tasksTable.id, taskId))
    .returning();

  res.json(serializeTask(updated));
});

// Send a *test* version of the daily report email without marking the day
// submitted or persisting any submission state. Used from Settings to verify
// recipient configuration before the real end-of-day submit.
router.post("/tasks/today/test-email", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  const tasks = taskList
    ? await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.taskListId, taskList.id))
        .orderBy(tasksTable.position)
    : [];

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const recipientEmails = settings?.recipientEmails ?? "";

  const emailResult = await sendDailyReport(
    recipientEmails,
    today,
    tasks.map((t) => ({
      text: t.text,
      completed: t.completed,
      note: t.note ?? "",
      postedForFuture: t.postedForFuture,
    })),
    userId,
    { test: true },
  );

  if (!emailResult.success) {
    res.status(502).json(emailResult);
    return;
  }

  res.json(emailResult);
});

router.post("/tasks/today/submit", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  if (taskList.submitted) {
    res.json({ success: true, message: "Already submitted." });
    return;
  }

  // Mark the day as submitted FIRST so a transient email failure can never
  // block the user from finishing their day. The email is then attempted as
  // a best-effort side effect, and its outcome is surfaced back to the
  // caller so the UI can show a helpful toast either way. This matches the
  // pre-regression behaviour of the v10 build.
  await db
    .update(taskListsTable)
    .set({ submitted: true, submittedAt: new Date() })
    .where(eq(taskListsTable.id, taskList.id));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskList.id))
    .orderBy(tasksTable.position);

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const recipientEmails = settings?.recipientEmails ?? "";

  let emailResult: { success: boolean; message: string };
  try {
    emailResult = await sendDailyReport(
      recipientEmails,
      today,
      tasks.map((t) => ({
        text: t.text,
        completed: t.completed,
        note: t.note ?? "",
        postedForFuture: t.postedForFuture,
      })),
      userId,
    );
  } catch (err: any) {
    emailResult = {
      success: false,
      message: `Day submitted, but email failed: ${err?.message ?? "Unknown error"}`,
    };
  }

  res.json(emailResult);
});

router.get("/tasks/history", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  const taskLists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, userId))
    .orderBy(desc(taskListsTable.date));

  const pastLists = taskLists.filter((tl) => tl.date !== today);

  const entries = await Promise.all(
    pastLists.map(async (tl) => {
      const tasks = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.taskListId, tl.id));
      return {
        id: tl.id,
        date: tl.date,
        submitted: tl.submitted,
        completedCount: tasks.filter((t) => t.completed).length,
        totalCount: tasks.length,
      };
    })
  );

  res.json({ entries });
});

// Bulk-remove every completed task from today's list. Returns the count
// of rows that were deleted so the UI can show a friendly toast.
router.delete("/tasks/today/completed", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list for today." });
    return;
  }

  const deleted = await db
    .delete(tasksTable)
    .where(
      and(eq(tasksTable.taskListId, taskList.id), eq(tasksTable.completed, true)),
    )
    .returning({ id: tasksTable.id });

  res.json({ success: true, deletedCount: deleted.length });
});

// Server-side search across the user's entire submission history. Two modes:
//   - mode=name: case-insensitive substring match on task text or note.
//                Returns matched task snippets (capped) per day.
//   - mode=date: substring match on the YYYY-MM-DD list date.
const SEARCH_MAX_QUERY_LEN = 200;
const SEARCH_MAX_SNIPPETS_PER_DAY = 8;
const SEARCH_MAX_RESULT_DAYS = 200;

router.get("/tasks/history/search", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const today = getLocalDateString();
  const rawQuery = req.query.q;
  const rawMode = req.query.mode;

  const q = (typeof rawQuery === "string" ? rawQuery : "").trim();
  const mode = rawMode === "date" ? "date" : "name";

  if (!q) {
    res.json({ entries: [] });
    return;
  }
  if (q.length > SEARCH_MAX_QUERY_LEN) {
    res.status(400).json({ error: "Query too long." });
    return;
  }

  // Escape ILIKE wildcard characters so user input is treated literally.
  const safe = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const pattern = `%${safe}%`;

  if (mode === "date") {
    const lists = await db
      .select()
      .from(taskListsTable)
      .where(
        and(
          eq(taskListsTable.userId, userId),
          ilike(taskListsTable.date, pattern),
        ),
      )
      .orderBy(desc(taskListsTable.date))
      .limit(SEARCH_MAX_RESULT_DAYS);

    const entries = await Promise.all(
      lists
        .filter((l) => l.date !== today)
        .map(async (l) => {
          const tasks = await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.taskListId, l.id));
          return {
            id: l.id,
            date: l.date,
            submitted: l.submitted,
            completedCount: tasks.filter((t) => t.completed).length,
            totalCount: tasks.length,
            matchedTasks: [],
          };
        }),
    );

    res.json({ entries });
    return;
  }

  // mode === "name"
  const matchingRows = await db
    .select({
      taskId: tasksTable.id,
      text: tasksTable.text,
      completed: tasksTable.completed,
      taskListId: tasksTable.taskListId,
      date: taskListsTable.date,
      submitted: taskListsTable.submitted,
    })
    .from(tasksTable)
    .innerJoin(taskListsTable, eq(tasksTable.taskListId, taskListsTable.id))
    .where(
      and(
        eq(taskListsTable.userId, userId),
        or(ilike(tasksTable.text, pattern), ilike(tasksTable.note, pattern)),
      ),
    )
    .orderBy(desc(taskListsTable.date), tasksTable.position);

  type Group = {
    id: number;
    date: string;
    submitted: boolean;
    matchedTasks: Array<{ id: number; text: string; completed: boolean }>;
  };
  const grouped = new Map<number, Group>();

  for (const r of matchingRows) {
    if (r.date === today) continue;
    let g = grouped.get(r.taskListId);
    if (!g) {
      if (grouped.size >= SEARCH_MAX_RESULT_DAYS) continue;
      g = {
        id: r.taskListId,
        date: r.date,
        submitted: r.submitted,
        matchedTasks: [],
      };
      grouped.set(r.taskListId, g);
    }
    if (g.matchedTasks.length < SEARCH_MAX_SNIPPETS_PER_DAY) {
      g.matchedTasks.push({
        id: r.taskId,
        text: r.text,
        completed: r.completed,
      });
    }
  }

  const entries = await Promise.all(
    Array.from(grouped.values()).map(async (g) => {
      const tasks = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.taskListId, g.id));
      return {
        id: g.id,
        date: g.date,
        submitted: g.submitted,
        completedCount: tasks.filter((t) => t.completed).length,
        totalCount: tasks.length,
        matchedTasks: g.matchedTasks,
      };
    }),
  );

  res.json({ entries });
});

router.get("/tasks/history/:date", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { date } = req.params;

  if (!isValidDate(date)) {
    res.status(400).json({ error: "Invalid date format." });
    return;
  }

  const [taskList] = await db
    .select()
    .from(taskListsTable)
    .where(and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, date)))
    .limit(1);

  if (!taskList) {
    res.status(404).json({ error: "No task list found for this date." });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskList.id))
    .orderBy(tasksTable.position);

  res.json({
    id: taskList.id,
    date: taskList.date,
    submitted: taskList.submitted,
    submittedAt: taskList.submittedAt?.toISOString() ?? null,
    tasks: tasks.map(serializeTask),
  });
});

export default router;
