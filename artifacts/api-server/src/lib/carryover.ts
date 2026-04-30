import { and, desc, eq, lt } from "drizzle-orm";
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
    // Posted-for-future tasks are intentionally NOT carried over — they
    // represent work scheduled for a specific later date and live only on
    // the day they were posted.
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
  }

  return { id: newList.id, created: true };
}

export async function appendTasksDeduped(
  taskListId: number,
  texts: string[],
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
      position: nextPosition++,
    })),
  );

  return toInsert.length;
}
