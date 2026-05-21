import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, taskListsTable, tasksTable, printShipmentsTable, inboxRulesTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { requireAuth, getUserId } from "../lib/auth";
import { ensureTodayList, appendTasksDeduped, getLocalDateString } from "../lib/carryover";
import {
  parseReminderEmail,
  parseShipmentEmail,
  formatPrintTask,
  computeShipmentDate,
  parseReminderBodyOnly,
  parsePendingListBodyOnly,
  parseShipmentBodyOnly,
} from "../lib/inbox";

const router = Router();

async function requireAdmin(req: any, res: any, next: any): Promise<void> {
  const userId = getUserId(req);
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;

  if (!adminEmail) {
    res.status(403).json({ error: "No super admin configured." });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const userEmail = user.emailAddresses[0]?.emailAddress ?? "";

    if (userEmail.toLowerCase() !== adminEmail.toLowerCase()) {
      res.status(403).json({ error: "Forbidden. Super admin only." });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: "Could not verify admin identity." });
  }
}

router.get("/admin/check", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) {
    res.json({ isAdmin: false });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const userEmail = user.emailAddresses[0]?.emailAddress ?? "";
    res.json({ isAdmin: userEmail.toLowerCase() === adminEmail.toLowerCase() });
  } catch {
    res.json({ isAdmin: false });
  }
});

router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const allLists = await db
    .select()
    .from(taskListsTable)
    .orderBy(desc(taskListsTable.date));

  const grouped: Record<
    string,
    {
      userId: string;
      displayName: string;
      dates: { id: number; date: string; submitted: boolean; completedCount: number; totalCount: number }[];
    }
  > = {};

  for (const list of allLists) {
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.taskListId, list.id));

    if (!grouped[list.userId]) {
      let displayName = list.userId;
      try {
        const user = await clerkClient.users.getUser(list.userId);
        displayName =
          user.fullName ||
          user.emailAddresses[0]?.emailAddress ||
          list.userId;
      } catch {
        // fall back to userId
      }
      grouped[list.userId] = { userId: list.userId, displayName, dates: [] };
    }

    grouped[list.userId].dates.push({
      id: list.id,
      date: list.date,
      submitted: list.submitted,
      completedCount: tasks.filter((t) => t.completed).length,
      totalCount: tasks.length,
    });
  }

  res.json({ users: Object.values(grouped) });
});

router.get("/admin/users/:userId/tasks/:date", requireAuth, requireAdmin, async (req, res) => {
  const { userId, date } = req.params;

  const allLists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, String(userId)));

  const matchingList = allLists.find((l) => l.date === date);

  if (!matchingList) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, matchingList.id))
    .orderBy(tasksTable.position);

  res.json({
    id: matchingList.id,
    date: matchingList.date,
    submitted: matchingList.submitted,
    submittedAt: matchingList.submittedAt?.toISOString() ?? null,
    userId: matchingList.userId,
    tasks: tasks.map((t) => ({
      id: t.id,
      text: t.text,
      completed: t.completed,
      position: t.position,
    })),
  });
});

// Returns raw per-day per-user task data within the requested inclusive
// date range, for the admin report screen. The frontend computes tag counts
// using its own client-side tag definitions so this endpoint stays generic.
router.get("/admin/report", requireAuth, requireAdmin, async (req, res) => {
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  if (typeof fromRaw !== "string" || !DATE_RE.test(fromRaw)) {
    res.status(400).json({ error: "Invalid 'from' date (expected YYYY-MM-DD)." });
    return;
  }
  if (typeof toRaw !== "string" || !DATE_RE.test(toRaw)) {
    res.status(400).json({ error: "Invalid 'to' date (expected YYYY-MM-DD)." });
    return;
  }
  if (fromRaw > toRaw) {
    res.status(400).json({ error: "'from' must be on or before 'to'." });
    return;
  }

  const lists = await db
    .select()
    .from(taskListsTable)
    .where(
      and(
        gte(taskListsTable.date, fromRaw),
        lte(taskListsTable.date, toRaw),
      ),
    )
    .orderBy(taskListsTable.date);

  const userNameCache = new Map<string, string>();
  async function resolveDisplayName(userId: string): Promise<string> {
    const cached = userNameCache.get(userId);
    if (cached) return cached;
    let name = userId;
    try {
      const user = await clerkClient.users.getUser(userId);
      name = user.fullName || user.emailAddresses[0]?.emailAddress || userId;
    } catch {
      // fall back to userId
    }
    userNameCache.set(userId, name);
    return name;
  }

  const days = await Promise.all(
    lists.map(async (list) => {
      const taskRows = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.taskListId, list.id))
        .orderBy(tasksTable.position);

      return {
        listId: list.id,
        userId: list.userId,
        userName: await resolveDisplayName(list.userId),
        date: list.date,
        submitted: list.submitted,
        tasks: taskRows.map((t) => ({
          id: t.id,
          text: t.text,
          completed: t.completed,
          note: t.note,
          postedForFuture: t.postedForFuture,
        })),
      };
    }),
  );

  res.json({ from: fromRaw, to: toRaw, days });
});

router.post("/admin/create-user", requireAuth, requireAdmin, async (req, res) => {
  const { email, password, firstName, lastName } = req.body as {
    email?: unknown;
    password?: unknown;
    firstName?: unknown;
    lastName?: unknown;
  };

  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  try {
    const user = await clerkClient.users.createUser({
      emailAddress: [email.trim()],
      password,
      firstName: typeof firstName === "string" ? firstName.trim() || undefined : undefined,
      lastName: typeof lastName === "string" ? lastName.trim() || undefined : undefined,
    });
    res.json({
      success: true,
      userId: user.id,
      email: user.emailAddresses[0]?.emailAddress,
      displayName: user.fullName || user.emailAddresses[0]?.emailAddress || user.id,
    });
  } catch (err: unknown) {
    const clerkErr = err as { errors?: { message: string }[] };
    const msg = clerkErr?.errors?.[0]?.message ?? (err instanceof Error ? err.message : "Failed to create user");
    res.status(400).json({ error: msg });
  }
});

router.get("/admin/users/:userId/board", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const today = getLocalDateString();

  const allLists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, String(userId)));

  const matchingList = allLists.find((l) => l.date === today);

  if (!matchingList) {
    res.json({ date: today, submitted: false, tasks: [] });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, matchingList.id))
    .orderBy(tasksTable.position);

  res.json({
    id: matchingList.id,
    date: matchingList.date,
    submitted: matchingList.submitted,
    userId: matchingList.userId,
    tasks: tasks.map((t) => ({
      id: t.id,
      text: t.text,
      completed: t.completed,
      note: t.note,
      position: t.position,
    })),
  });
});

router.post("/admin/users/:userId/assign-tasks", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { tasks } = req.body as { tasks?: unknown };

  if (!Array.isArray(tasks) || tasks.some((t) => typeof t !== "string")) {
    res.status(400).json({ error: "tasks must be an array of strings" });
    return;
  }
  if ((tasks as string[]).length === 0) {
    res.status(400).json({ error: "No tasks provided" });
    return;
  }

  const today = getLocalDateString();
  const list = await ensureTodayList(String(userId), today);
  const inserted = await appendTasksDeduped(list.id, tasks as string[]);

  res.json({ success: true, inserted, targetUserId: userId });
});

// ---------------------------------------------------------------------------
// Inbox rules CRUD
// ---------------------------------------------------------------------------

router.get("/admin/inbox-rules", requireAuth, requireAdmin, async (_req, res) => {
  const rules = await db
    .select()
    .from(inboxRulesTable)
    .orderBy(inboxRulesTable.id);
  res.json({ rules });
});

router.post("/admin/inbox-rules", requireAuth, requireAdmin, async (req, res) => {
  const { label, subjectPattern, parserType, taskSuffix } = req.body as {
    label?: unknown;
    subjectPattern?: unknown;
    parserType?: unknown;
    taskSuffix?: unknown;
  };

  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (typeof subjectPattern !== "string" || !subjectPattern.trim()) {
    res.status(400).json({ error: "subjectPattern is required" });
    return;
  }
  const VALID_TYPES = ["reminder", "pending_list", "shipment"] as const;
  if (!VALID_TYPES.includes(parserType as any)) {
    res.status(400).json({ error: "parserType must be reminder, pending_list, or shipment" });
    return;
  }

  try {
    new RegExp(subjectPattern as string, "i");
  } catch {
    res.status(400).json({ error: "subjectPattern is not a valid regular expression" });
    return;
  }

  const [rule] = await db
    .insert(inboxRulesTable)
    .values({
      label: (label as string).trim(),
      subjectPattern: (subjectPattern as string).trim(),
      parserType: parserType as "reminder" | "pending_list" | "shipment",
      taskSuffix: typeof taskSuffix === "string" && taskSuffix.trim() ? taskSuffix.trim() : null,
      enabled: true,
    })
    .returning();

  res.json({ rule });
});

router.patch("/admin/inbox-rules/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { label, subjectPattern, taskSuffix, enabled } = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof label === "string" && label.trim()) patch.label = label.trim();
  if (typeof subjectPattern === "string" && subjectPattern.trim()) {
    try { new RegExp(subjectPattern, "i"); } catch {
      res.status(400).json({ error: "subjectPattern is not a valid regular expression" }); return;
    }
    patch.subjectPattern = subjectPattern.trim();
  }
  if (typeof taskSuffix === "string") patch.taskSuffix = taskSuffix.trim() || null;
  if (typeof enabled === "boolean") patch.enabled = enabled;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" }); return;
  }

  const [rule] = await db
    .update(inboxRulesTable)
    .set(patch)
    .where(eq(inboxRulesTable.id, id))
    .returning();

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json({ rule });
});

router.delete("/admin/inbox-rules/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(inboxRulesTable).where(eq(inboxRulesTable.id, id));
  res.json({ success: true });
});

const DEFAULT_INBOX_RULES = [
  { label: "Twitter Marketing Reminder", subjectPattern: "twitter\\s+marketing\\s+reminder", parserType: "reminder" as const, taskSuffix: "twitter marketing" },
  { label: "Reprint Reminder",           subjectPattern: "reprint\\s+reminder",              parserType: "reminder" as const, taskSuffix: "Reprints" },
  { label: "Pending List",               subjectPattern: "pending\\s+list",                  parserType: "pending_list" as const, taskSuffix: null },
  { label: "Shipment Copies Summary",    subjectPattern: "shipment\\s+copies\\s+summary|copies\\s+required", parserType: "shipment" as const, taskSuffix: null },
];

router.post("/admin/inbox-rules/seed-defaults", requireAuth, requireAdmin, async (_req, res) => {
  const existing = await db.select().from(inboxRulesTable);
  const existingPatterns = new Set(existing.map((r) => r.subjectPattern));

  const toInsert = DEFAULT_INBOX_RULES.filter((r) => !existingPatterns.has(r.subjectPattern));

  if (toInsert.length === 0) {
    res.json({ seeded: 0, message: "All default rules already exist." });
    return;
  }

  const inserted = await db
    .insert(inboxRulesTable)
    .values(toInsert.map((r) => ({ ...r, enabled: true })))
    .returning();

  res.json({ seeded: inserted.length, rules: inserted });
});

router.post("/admin/inbox-rules/:id/test", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { body } = req.body as { body?: unknown };
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }

  const [rule] = await db
    .select()
    .from(inboxRulesTable)
    .where(eq(inboxRulesTable.id, id))
    .limit(1);

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

  let tasks: string[] = [];
  let parseNote: string | null = null;

  if (rule.parserType === "reminder") {
    const suffix = rule.taskSuffix ?? rule.label;
    tasks = parseReminderBodyOnly(body, suffix);
    if (tasks.length === 0) {
      parseNote = "No tasks found. Make sure the body contains 'sent today:' before the task list and 'Best regards' after it.";
    }
  } else if (rule.parserType === "pending_list") {
    tasks = parsePendingListBodyOnly(body) ?? [];
    if (tasks.length === 0) {
      parseNote = "No tasks found. Make sure lines are numbered like '1. Task name'.";
    }
  } else if (rule.parserType === "shipment") {
    const entries = parseShipmentBodyOnly(body) ?? [];
    tasks = entries.map((e) => `Print: ${e.magazine} - ${e.project} - ${e.copies} copies`);
    if (tasks.length === 0) {
      parseNote = "No entries found. Expected blocks with 'Magazine:', 'Project:', and a number.";
    }
  }

  res.json({ tasks, parseNote, ruleLabel: rule.label, parserType: rule.parserType });
});

router.post("/admin/inbox/simulate", requireAuth, requireAdmin, async (req, res) => {
  const { subject, body } = req.body as { subject?: unknown; body?: unknown };
  if (typeof subject !== "string" || typeof body !== "string") {
    res.status(400).json({ error: "subject and body must be strings" });
    return;
  }

  const today = getLocalDateString();
  const userIds = (await clerkClient.users.getUserList({ limit: 200 })).data.map((u) => u.id);

  const reminder = parseReminderEmail(subject, body);
  if (reminder) {
    let totalInserted = 0;
    for (const userId of userIds) {
      const list = await ensureTodayList(userId, today);
      totalInserted += await appendTasksDeduped(list.id, reminder.tasks);
    }
    res.json({
      success: true,
      kind: reminder.kind,
      parsedTasks: reminder.tasks,
      usersTargeted: userIds.length,
      tasksInserted: totalInserted,
    });
    return;
  }

  const shipment = parseShipmentEmail(subject, body);
  if (shipment) {
    const printTasks = shipment.map(formatPrintTask);
    let totalInserted = 0;
    for (const userId of userIds) {
      const list = await ensureTodayList(userId, today);
      totalInserted += await appendTasksDeduped(list.id, printTasks);
    }
    const shipmentDate = computeShipmentDate(today);
    for (const entry of shipment) {
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
    }
    res.json({
      success: true,
      kind: "shipment",
      parsedTasks: printTasks,
      scheduledShipmentDate: shipmentDate,
      usersTargeted: userIds.length,
      tasksInserted: totalInserted,
    });
    return;
  }

  res.status(400).json({
    error:
      "Subject not recognised — must contain 'Twitter Marketing Reminder', 'Reprint Reminder', or 'Shipment Copies Summary'",
  });
});

export default router;
