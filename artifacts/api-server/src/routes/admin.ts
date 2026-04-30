import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, taskListsTable, tasksTable, printShipmentsTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { requireAuth, getUserId } from "../lib/auth";
import { ensureTodayList, appendTasksDeduped, getLocalDateString } from "../lib/carryover";
import {
  parseReminderEmail,
  parseShipmentEmail,
  formatPrintTask,
  computeShipmentDate,
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
    .where(eq(taskListsTable.userId, userId));

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
