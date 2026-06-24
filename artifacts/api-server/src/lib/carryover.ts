import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db, taskListsTable, tasksTable } from "@workspace/db";

export function getLocalDateString(d: Date = new Date()): string {
  return d.toISOString().split("T")[0];
}

export async function ensureTodayList(
  userId: string,
  today: string = getLocalDateString(),
): Promise<{ id: number; created: boolean }> {
  const [existing] = await db
    .select()
    .from(taskListsTable)
    .where(
      and(eq(taskListsTable.userId, userId), eq(taskListsTable.date, today)),
    )
    .limit(1);

  if (existing) {
    return { id: existing.id, created: false };
  }

  const [newList] = await db
    .insert(taskListsTable)
    .values({ userId, date: today, submitted: false })
    .returning();

  const [priorList] = await db
    .select()
    .from(taskListsTable)
    .where(
      and(
        eq(taskListsTable.userId, userId),
        lt(taskListsTable.date, today),
      ),
    )
    .orderBy(desc(taskListsTable.date))
    .limit(1);

  if (priorList) {
    // 1. Regular incomplete tasks (no scheduled reminder) — carry over as-is.
    const incomplete = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.taskListId, priorList.id),
          eq(tasksTable.completed, false),
          eq(tasksTable.postedForFuture, false),
        ),
      )
      .orderBy(tasksTable.position);

    if (incomplete.length > 0) {
      await db.insert(tasksTable).values(
        incomplete.map((t: typeof tasksTable.$inferSelect, i: number) => ({
          taskListId: newList.id,
          text: t.text,
          completed: false,
          note: t.note,
          position: i,
          // Preserve the original creation timestamp so the UI can show
          // "Pending from <original date>" / "Pending Nd" for carried tasks.
          createdAt: t.createdAt,
        })),
      );
    }

    // 2. Scheduled tasks (postedForFuture=true, remindDate set):
    //    • remindDate > today  → carry over as scheduled (stays in Posted folder)
    //    • remindDate <= today → activate (copy as normal task, clear remindDate/postedForFuture)
    const scheduled = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.taskListId, priorList.id),
          eq(tasksTable.completed, false),
          eq(tasksTable.postedForFuture, true),
          isNotNull(tasksTable.remindDate),
        ),
      )
      .orderBy(tasksTable.position);

    if (scheduled.length > 0) {
      const nextPos = incomplete.length;
      const stillFuture = scheduled.filter((t) => (t.remindDate ?? "") > today);
      const dueNow = scheduled.filter((t) => (t.remindDate ?? "") <= today);

      // Still-future: carry over preserving scheduled state.
      if (stillFuture.length > 0) {
        await db.insert(tasksTable).values(
          stillFuture.map((t, i) => ({
            taskListId: newList.id,
            text: t.text,
            completed: false,
            note: t.note,
            position: nextPos + i,
            postedForFuture: true,
            remindDate: t.remindDate,
            createdAt: t.createdAt,
          })),
        );
      }

      // Due today or overdue: activate — copy as normal board task.
      if (dueNow.length > 0) {
        await db.insert(tasksTable).values(
          dueNow.map((t, i) => ({
            taskListId: newList.id,
            text: t.text,
            completed: false,
            note: t.note,
            position: nextPos + stillFuture.length + i,
            postedForFuture: false,
            remindDate: null,
            createdAt: t.createdAt,
          })),
        );
      }
    }
  }

  return { id: newList.id, created: true };
}

export async function appendTasksDeduped(
  taskListId: number,
  texts: string[],
  source: string = "user",
): Promise<number> {
  if (texts.length === 0) return 0;

  const existing = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskListId));

  const existingTexts = new Set(existing.map((t: typeof tasksTable.$inferSelect) => t.text));
  const toInsert = texts.filter((t) => !existingTexts.has(t));

  if (toInsert.length === 0) return 0;

  let nextPosition = existing.length;
  await db.insert(tasksTable).values(
    toInsert.map((text) => ({
      taskListId,
      text,
      completed: false,
      source,
      position: nextPosition++,
    })),
  );

  return toInsert.length;
}

export async function appendTasksWithNotesDeduped(
  taskListId: number,
  tasks: Array<{ text: string; note?: string | null }>,
  source: string = "user",
): Promise<number> {
  if (tasks.length === 0) return 0;

  const existing = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.taskListId, taskListId));

  const existingTexts = new Set(existing.map((t: typeof tasksTable.$inferSelect) => t.text));
  const toInsert = tasks.filter((t) => !existingTexts.has(t.text));

  if (toInsert.length === 0) return 0;

  let nextPosition = existing.length;
  await db.insert(tasksTable).values(
    toInsert.map((task) => ({
      taskListId,
      text: task.text,
      note: task.note ?? "",
      completed: false,
      source,
      position: nextPosition++,
    })),
  );

  return toInsert.length;
}
