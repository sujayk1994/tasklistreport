import { Router } from "express";
import { clerkClient } from "@clerk/express";
import {
  db,
  taskListsTable,
  tasksTable,
  printShipmentsTable,
  inboxRulesTable,
  twitterMarketingCompletionsTable,
  addressReceiptsTable,
  reprintReceiptsTable,
  reprintCompletionsTable,
  manualProjectsTable,
} from "@workspace/db";
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
  parseAdRequestBodyOnly,
  parseSubjectAsTask,
  parseBulletListBodyOnly,
  parsePlainLinesBodyOnly,
  parseReprintTaskText,
} from "../lib/inbox";

const router = Router();

async function getUserEmail(userId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.emailAddresses[0]?.emailAddress ?? "";
  } catch {
    return "";
  }
}

async function requireAdmin(req: any, res: any, next: any): Promise<void> {
  const userId = getUserId(req);
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;

  if (!adminEmail) {
    res.status(403).json({ error: "No super admin configured." });
    return;
  }

  try {
    const userEmail = await getUserEmail(userId);
    if (userEmail.toLowerCase() !== adminEmail.toLowerCase()) {
      res.status(403).json({ error: "Forbidden. Super admin only." });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: "Could not verify admin identity." });
  }
}

async function requireAdminOrSubAdmin(req: any, res: any, next: any): Promise<void> {
  const userId = getUserId(req);
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;

  if (!adminEmail) {
    res.status(403).json({ error: "No super admin configured." });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const userEmail = user.emailAddresses[0]?.emailAddress ?? "";
    const isAdmin = userEmail.toLowerCase() === adminEmail.toLowerCase();
    const isSubAdmin = !isAdmin && (user.publicMetadata as any)?.role === "subAdmin";

    if (!isAdmin && !isSubAdmin) {
      res.status(403).json({ error: "Forbidden. Admin access required." });
      return;
    }
    (req as any).isSubAdmin = isSubAdmin;
    (req as any).isAdmin = isAdmin;
    next();
  } catch {
    res.status(403).json({ error: "Could not verify admin identity." });
  }
}

router.get("/admin/check", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) {
    res.json({ isAdmin: false, isSubAdmin: false });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const userEmail = user.emailAddresses[0]?.emailAddress ?? "";
    const isAdmin = userEmail.toLowerCase() === adminEmail.toLowerCase();
    const isSubAdmin = !isAdmin && (user.publicMetadata as any)?.role === "subAdmin";
    res.json({ isAdmin, isSubAdmin });
  } catch {
    res.json({ isAdmin: false, isSubAdmin: false });
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
      isSubAdmin: boolean;
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
      let isSubAdmin = false;
      try {
        const user = await clerkClient.users.getUser(list.userId);
        displayName =
          user.fullName ||
          user.emailAddresses[0]?.emailAddress ||
          list.userId;
        isSubAdmin = (user.publicMetadata as any)?.role === "subAdmin";
      } catch {
        // fall back to userId
      }
      grouped[list.userId] = { userId: list.userId, displayName, isSubAdmin, dates: [] };
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

router.patch("/admin/users/:userId/role", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body as { role?: unknown };

  if (role !== "subAdmin" && role !== null && role !== "") {
    res.status(400).json({ error: "role must be 'subAdmin' or null to remove" });
    return;
  }

  const adminEmail = process.env.SUPER_ADMIN_EMAIL ?? "";
  try {
    const target = await clerkClient.users.getUser(String(userId));
    const targetEmail = target.emailAddresses[0]?.emailAddress ?? "";
    if (targetEmail.toLowerCase() === adminEmail.toLowerCase()) {
      res.status(400).json({ error: "Cannot change role of the super admin." });
      return;
    }

    const newMetadata = role === "subAdmin"
      ? { ...(target.publicMetadata as object), role: "subAdmin" }
      : { ...(target.publicMetadata as object), role: null };

    await clerkClient.users.updateUser(String(userId), { publicMetadata: newMetadata });
    res.json({ success: true, userId, role: role || null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update role";
    res.status(500).json({ error: msg });
  }
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

router.get("/admin/users/:userId/board", requireAuth, requireAdminOrSubAdmin, async (req, res) => {
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

router.post("/admin/users/:userId/assign-tasks", requireAuth, requireAdminOrSubAdmin, async (req, res) => {
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
  const VALID_TYPES = ["reminder", "pending_list", "shipment", "ad_request", "subject_as_task", "bullet_list", "plain_lines"] as const;
  if (!VALID_TYPES.includes(parserType as any)) {
    res.status(400).json({ error: "parserType must be one of: reminder, pending_list, shipment, ad_request, subject_as_task, bullet_list, plain_lines" });
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
      parserType: parserType as "reminder" | "pending_list" | "shipment" | "ad_request" | "subject_as_task" | "bullet_list" | "plain_lines",
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
  { label: "Ad Design Request",          subjectPattern: "request\\s+to\\s+design\\s+the\\s+ad", parserType: "ad_request" as const, taskSuffix: null },
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

  const { body, subject: reqSubject } = req.body as { body?: unknown; subject?: unknown };
  const subject = typeof reqSubject === "string" ? reqSubject : "";
  if (typeof body !== "string") {
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
  } else if (rule.parserType === "ad_request") {
    const result = parseAdRequestBodyOnly(body);
    if (result) {
      tasks = [result.title];
      parseNote = result.details
        ? `Details note (${result.details.length} chars): ${result.details.slice(0, 120)}${result.details.length > 120 ? "…" : ""}`
        : "Task title extracted. No details found after the title.";
    } else {
      parseNote = "No task found. Make sure the body starts with 'Hi name,' followed by the task title on the next line.";
    }
  } else if (rule.parserType === "subject_as_task") {
    const result = parseSubjectAsTask(subject || "(no subject provided)", body);
    if (result) {
      tasks = [result.title];
      parseNote = result.note
        ? `Body stored as note (${result.note.length} chars).`
        : "Task created with no note (empty body).";
    } else {
      parseNote = "No task found — subject was empty.";
    }
  } else if (rule.parserType === "bullet_list") {
    tasks = parseBulletListBodyOnly(body);
    if (tasks.length === 0) {
      parseNote = "No bullet points found. Start lines with -, *, or • followed by a space.";
    }
  } else if (rule.parserType === "plain_lines") {
    tasks = parsePlainLinesBodyOnly(body);
    if (tasks.length === 0) {
      parseNote = "No task lines found. Each non-empty line (excluding greetings/signatures) becomes a task.";
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
  const userIds = (await clerkClient.users.getUserList({ limit: 200 })).data
    .filter((u) => (u.publicMetadata as any)?.role !== "subAdmin")
    .map((u) => u.id);

  const reminder = parseReminderEmail(subject, body);
  if (reminder) {
    let totalInserted = 0;
    for (const userId of userIds) {
      const list = await ensureTodayList(userId, today);
      totalInserted += await appendTasksDeduped(list.id, reminder.tasks);
    }
    // Record reprint receipts for project tracker
    if (reminder.kind === "Reprints") {
      for (const taskText of reminder.tasks) {
        const parsed = parseReprintTaskText(taskText);
        if (parsed) {
          await db
            .insert(reprintReceiptsTable)
            .values({ magazine: parsed.magazine, project: parsed.project })
            .catch(() => {});
        }
      }
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

// ---------------------------------------------------------------------------
// Print Queue — view pending twitter-marketing → print task pipeline
// ---------------------------------------------------------------------------

router.get("/admin/print-queue", requireAuth, requireAdmin, async (req, res) => {
  const PRINT_DELAY_MS = 24 * 60 * 60 * 1000;

  const [tmCompletions, allAddresses] = await Promise.all([
    db
      .select()
      .from(twitterMarketingCompletionsTable)
      .where(eq(twitterMarketingCompletionsTable.printTaskCreated, false))
      .orderBy(desc(twitterMarketingCompletionsTable.completedAt)),
    db
      .select()
      .from(addressReceiptsTable)
      .orderBy(desc(addressReceiptsTable.receivedAt)),
  ]);

  const now = Date.now();

  const queue = tmCompletions.map((tm) => {
    const address = allAddresses.find(
      (a) =>
        a.magazine.toLowerCase() === tm.magazine.toLowerCase() &&
        a.project.toLowerCase() === tm.project.toLowerCase(),
    ) ?? null;

    const elapsedMs = now - tm.completedAt.getTime();
    const hoursElapsed = elapsedMs / 3_600_000;
    const hoursRemaining = Math.max(0, (PRINT_DELAY_MS - elapsedMs) / 3_600_000);
    const past24h = elapsedMs >= PRINT_DELAY_MS;

    let status: "no_address" | "waiting_24h" | "ready";
    if (!address) status = "no_address";
    else if (!past24h) status = "waiting_24h";
    else status = "ready";

    return {
      id: tm.id,
      magazine: tm.magazine,
      project: tm.project,
      tmCompletedAt: tm.completedAt.toISOString(),
      hoursElapsed: Math.round(hoursElapsed * 10) / 10,
      hoursRemaining: Math.round(hoursRemaining * 10) / 10,
      addressReceived: !!address,
      addressCopies: address?.copies ?? null,
      addressReceivedAt: address?.receivedAt.toISOString() ?? null,
      addressId: address?.id ?? null,
      status,
    };
  });

  const addressedMagazines = new Set(
    tmCompletions.map((t) => `${t.magazine.toLowerCase()}|${t.project.toLowerCase()}`),
  );
  const pendingAddresses = allAddresses
    .filter(
      (a) =>
        !addressedMagazines.has(`${a.magazine.toLowerCase()}|${a.project.toLowerCase()}`),
    )
    .map((a) => ({
      id: a.id,
      magazine: a.magazine,
      project: a.project,
      copies: a.copies,
      receivedAt: a.receivedAt.toISOString(),
    }));

  res.json({ queue, pendingAddresses });
});

// Force-create a Print task for a specific magazine/project, bypassing the
// 24h wait. Marks the TM completion row as fulfilled so it doesn't fire again.
router.post("/admin/print-queue/trigger", requireAuth, requireAdmin, async (req, res) => {
  const { magazine, project } = req.body as { magazine?: unknown; project?: unknown };

  if (typeof magazine !== "string" || !magazine.trim()) {
    res.status(400).json({ error: "magazine is required" });
    return;
  }
  if (typeof project !== "string" || !project.trim()) {
    res.status(400).json({ error: "project is required" });
    return;
  }

  const [tmCompletion] = await db
    .select()
    .from(twitterMarketingCompletionsTable)
    .where(
      and(
        eq(twitterMarketingCompletionsTable.magazine, magazine.trim()),
        eq(twitterMarketingCompletionsTable.project, project.trim()),
        eq(twitterMarketingCompletionsTable.printTaskCreated, false),
      ),
    )
    .orderBy(desc(twitterMarketingCompletionsTable.completedAt))
    .limit(1);

  if (!tmCompletion) {
    res.status(404).json({ error: "No pending Twitter Marketing completion found for this magazine/project." });
    return;
  }

  const [addressReceipt] = await db
    .select()
    .from(addressReceiptsTable)
    .where(
      and(
        eq(addressReceiptsTable.magazine, magazine.trim()),
        eq(addressReceiptsTable.project, project.trim()),
      ),
    )
    .orderBy(desc(addressReceiptsTable.receivedAt))
    .limit(1);

  if (!addressReceipt) {
    res.status(404).json({ error: "No address receipt found for this magazine/project. Cannot create Print task without copy count." });
    return;
  }

  const today = getLocalDateString();
  const shipmentDate = computeShipmentDate(today);
  const taskText = formatPrintTask({
    magazine: tmCompletion.magazine,
    project: tmCompletion.project,
    copies: addressReceipt.copies,
  });

  const userList = await clerkClient.users.getUserList({ limit: 200 });
  const userIds = userList.data
    .filter((u) => (u.publicMetadata as any)?.role !== "subAdmin")
    .map((u) => u.id);
  let totalInserted = 0;
  for (const userId of userIds) {
    const list = await ensureTodayList(userId, today);
    const inserted = await appendTasksDeduped(list.id, [taskText], "inbox");
    totalInserted += inserted;
  }

  await db
    .insert(printShipmentsTable)
    .values({
      magazine: tmCompletion.magazine,
      project: tmCompletion.project,
      printCopies: addressReceipt.copies,
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

  await db
    .update(twitterMarketingCompletionsTable)
    .set({ printTaskCreated: true })
    .where(eq(twitterMarketingCompletionsTable.id, tmCompletion.id));

  res.json({
    success: true,
    taskText,
    copies: addressReceipt.copies,
    usersTargeted: userIds.length,
    tasksInserted: totalInserted,
  });
});

// ---------------------------------------------------------------------------
// Delete a TM completion row from the print queue
// ---------------------------------------------------------------------------

router.delete("/admin/print-queue/tm/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(twitterMarketingCompletionsTable)
    .where(eq(twitterMarketingCompletionsTable.id, id));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Delete an address receipt row from the print queue
// ---------------------------------------------------------------------------

router.delete("/admin/print-queue/address/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(addressReceiptsTable)
    .where(eq(addressReceiptsTable.id, id));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Project Tracker — lifecycle view per project (reprint → TM → address → shipping)
// ---------------------------------------------------------------------------

function subtractWorkingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

router.get("/admin/project-tracker", requireAuth, requireAdmin, async (req, res) => {
  const [reprintReceipts, reprintCompletions, tmCompletions, addressReceipts, printShipments] =
    await Promise.all([
      db.select().from(reprintReceiptsTable).orderBy(desc(reprintReceiptsTable.receivedAt)),
      db.select().from(reprintCompletionsTable).orderBy(desc(reprintCompletionsTable.completedAt)),
      db.select().from(twitterMarketingCompletionsTable).orderBy(desc(twitterMarketingCompletionsTable.completedAt)),
      db.select().from(addressReceiptsTable).orderBy(desc(addressReceiptsTable.receivedAt)),
      db.select().from(printShipmentsTable).orderBy(desc(printShipmentsTable.createdAt)),
    ]);

  // Deduplicate reprint receipts — latest occurrence per project
  const projectMap = new Map<string, typeof reprintReceipts[0]>();
  for (const rr of reprintReceipts) {
    const key = `${rr.magazine.toLowerCase()}|${rr.project.toLowerCase()}`;
    if (!projectMap.has(key)) {
      projectMap.set(key, rr);
    }
  }

  const rows = Array.from(projectMap.values()).map((rr) => {
    const key = `${rr.magazine.toLowerCase()}|${rr.project.toLowerCase()}`;

    const onlineDate = subtractWorkingDays(rr.receivedAt, 2);

    const reprintCompletion =
      reprintCompletions.find(
        (rc) => `${rc.magazine.toLowerCase()}|${rc.project.toLowerCase()}` === key,
      ) ?? null;

    const tmCompletion =
      tmCompletions.find(
        (tm) => `${tm.magazine.toLowerCase()}|${tm.project.toLowerCase()}` === key,
      ) ?? null;

    const addressReceipt =
      addressReceipts.find(
        (ar) => `${ar.magazine.toLowerCase()}|${ar.project.toLowerCase()}` === key,
      ) ?? null;

    const printShipment =
      printShipments.find(
        (ps) => `${ps.magazine.toLowerCase()}|${ps.project.toLowerCase()}` === key,
      ) ?? null;

    return {
      magazine: rr.magazine,
      project: rr.project,
      reprintReceiptDate: rr.receivedAt.toISOString(),
      onlineDate: onlineDate.toISOString(),
      reprintDone: !!reprintCompletion,
      reprintDoneDate: reprintCompletion?.completedAt.toISOString() ?? null,
      tmDone: !!tmCompletion,
      tmDoneDate: tmCompletion?.completedAt.toISOString() ?? null,
      addressDone: !!addressReceipt,
      addressDoneDate: addressReceipt?.receivedAt.toISOString() ?? null,
      shippingDone: !!printShipment,
      shippingDoneDate: printShipment?.shipmentDate ?? null,
    };
  });

  // Sort newest reprint first
  rows.sort(
    (a, b) =>
      new Date(b.reprintReceiptDate).getTime() - new Date(a.reprintReceiptDate).getTime(),
  );

  res.json({ rows });
});

// ---------------------------------------------------------------------------
// Delete user (admin only — sub-admin cannot delete)
// ---------------------------------------------------------------------------

router.delete("/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    await clerkClient.users.deleteUser(userId);
  } catch (err: unknown) {
    const clerkErr = err as { errors?: { message: string }[] };
    const msg = clerkErr?.errors?.[0]?.message ?? (err instanceof Error ? err.message : "Failed to delete user from Clerk");
    res.status(400).json({ error: msg });
    return;
  }

  const userLists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, userId));

  for (const list of userLists) {
    await db.delete(tasksTable).where(eq(tasksTable.taskListId, list.id));
  }

  await db
    .delete(taskListsTable)
    .where(eq(taskListsTable.userId, userId));

  res.json({ success: true, userId });
});

// ---------------------------------------------------------------------------
// Sub-admin: get admin's own board (so sub-admin can view it and assign tasks)
// ---------------------------------------------------------------------------

router.get("/admin/my-board", requireAuth, requireAdminOrSubAdmin, async (req, res) => {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) {
    res.status(403).json({ error: "No super admin configured." });
    return;
  }

  const userList = await clerkClient.users.getUserList({ limit: 200 });
  const adminUser = userList.data.find(
    (u) => u.emailAddresses[0]?.emailAddress?.toLowerCase() === adminEmail.toLowerCase(),
  );

  if (!adminUser) {
    res.status(404).json({ error: "Admin user not found." });
    return;
  }

  const today = getLocalDateString();
  const allLists = await db
    .select()
    .from(taskListsTable)
    .where(eq(taskListsTable.userId, adminUser.id));

  const matchingList = allLists.find((l) => l.date === today);

  if (!matchingList) {
    res.json({
      adminUserId: adminUser.id,
      adminDisplayName: adminUser.fullName || adminEmail,
      date: today,
      submitted: false,
      tasks: [],
    });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, matchingList.id))
    .orderBy(tasksTable.position);

  res.json({
    adminUserId: adminUser.id,
    adminDisplayName: adminUser.fullName || adminEmail,
    date: today,
    submitted: matchingList.submitted,
    tasks: tasks.map((t) => ({
      id: t.id,
      text: t.text,
      completed: t.completed,
      note: t.note,
      position: t.position,
    })),
  });
});

// ---------------------------------------------------------------------------
// Manual Projects — CRUD for manually-tracked magazine/project entries
// ---------------------------------------------------------------------------

router.get("/admin/manual-projects", requireAuth, requireAdmin, async (_req, res) => {
  const projects = await db
    .select()
    .from(manualProjectsTable)
    .orderBy(desc(manualProjectsTable.createdAt));
  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      magazine: p.magazine,
      project: p.project,
      copies: p.copies,
      createdAt: p.createdAt.toISOString(),
      reprintTaskCreated: p.reprintTaskCreated,
      reprintTaskCreatedAt: p.reprintTaskCreatedAt?.toISOString() ?? null,
      reprintCompletedAt: p.reprintCompletedAt?.toISOString() ?? null,
      twitterTaskCreated: p.twitterTaskCreated,
      twitterTaskCreatedAt: p.twitterTaskCreatedAt?.toISOString() ?? null,
    })),
  });
});

router.post("/admin/manual-projects", requireAuth, requireAdmin, async (req, res) => {
  const { magazine, project, copies } = req.body as {
    magazine?: unknown;
    project?: unknown;
    copies?: unknown;
  };

  if (typeof magazine !== "string" || !magazine.trim()) {
    res.status(400).json({ error: "magazine is required" });
    return;
  }
  if (typeof project !== "string" || !project.trim()) {
    res.status(400).json({ error: "project is required" });
    return;
  }
  const copiesNum = typeof copies === "number" ? copies : parseInt(String(copies ?? "1"), 10);
  if (isNaN(copiesNum) || copiesNum < 1) {
    res.status(400).json({ error: "copies must be a positive number" });
    return;
  }

  try {
    const [row] = await db
      .insert(manualProjectsTable)
      .values({
        magazine: magazine.trim(),
        project: project.trim(),
        copies: copiesNum,
      })
      .returning();
    res.json({
      project: {
        id: row.id,
        magazine: row.magazine,
        project: row.project,
        copies: row.copies,
        createdAt: row.createdAt.toISOString(),
        reprintTaskCreated: row.reprintTaskCreated,
        reprintTaskCreatedAt: row.reprintTaskCreatedAt?.toISOString() ?? null,
        reprintCompletedAt: row.reprintCompletedAt?.toISOString() ?? null,
        twitterTaskCreated: row.twitterTaskCreated,
        twitterTaskCreatedAt: row.twitterTaskCreatedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A project with this magazine and project name already exists." });
    } else {
      res.status(500).json({ error: "Failed to create project" });
    }
  }
});

router.delete("/admin/manual-projects/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(manualProjectsTable).where(eq(manualProjectsTable.id, id));
  res.json({ success: true });
});

router.post("/admin/manual-projects/seed-demo", requireAuth, requireAdmin, async (_req, res) => {
  const now = new Date();
  const minus3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const minus5d = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const demos = [
    {
      magazine: "Demo Magazine",
      project: "Demo Project A",
      copies: 5,
      createdAt: minus3d,
      reprintTaskCreated: false,
      reprintTaskCreatedAt: null,
      reprintCompletedAt: null,
      twitterTaskCreated: false,
      twitterTaskCreatedAt: null,
    },
    {
      magazine: "Demo Magazine",
      project: "Demo Project B",
      copies: 3,
      createdAt: minus5d,
      reprintTaskCreated: true,
      reprintTaskCreatedAt: minus3d,
      reprintCompletedAt: minus3d,
      twitterTaskCreated: false,
      twitterTaskCreatedAt: null,
    },
  ];

  const inserted: number[] = [];
  const skipped: string[] = [];

  for (const demo of demos) {
    try {
      const [row] = await db
        .insert(manualProjectsTable)
        .values(demo)
        .onConflictDoNothing({ target: [manualProjectsTable.magazine, manualProjectsTable.project] })
        .returning({ id: manualProjectsTable.id });
      if (row) inserted.push(row.id);
      else skipped.push(demo.project);
    } catch {
      skipped.push(demo.project);
    }
  }

  res.json({ inserted: inserted.length, skipped });
});

export default router;
