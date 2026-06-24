import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskListsTable = pgTable("task_lists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  submitted: boolean("submitted").notNull().default(false),
  submittedAt: timestamp("submitted_at"),
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  taskListId: integer("task_list_id").notNull().references(() => taskListsTable.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: boolean("completed").notNull().default(false),
  note: text("note").notNull().default(""),
  position: integer("position").notNull().default(0),
  postedForFuture: boolean("posted_for_future").notNull().default(false),
  remindDate: text("remind_date"),
  source: text("source").notNull().default("user"),
  elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSettingsTable = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  recipientEmails: text("recipient_emails").notNull().default(""),
  autoCheckIn: boolean("auto_check_in").notNull().default(true),
  autoSubmit: boolean("auto_submit").notNull().default(true),
  // Comma-separated JS day numbers that are work days: 0=Sun,1=Mon,...,6=Sat
  // Default "1,2,3,4,5" = Mon–Fri. Sat (6) and Sun (0) are off by default.
  workDays: text("work_days").notNull().default("1,2,3,4,5"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaskListSchema = createInsertSchema(taskListsTable).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type TaskList = typeof taskListsTable.$inferSelect;
export type Task = typeof tasksTable.$inferSelect;
export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertTaskList = z.infer<typeof insertTaskListSchema>;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
