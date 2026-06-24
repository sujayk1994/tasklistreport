import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const manualProjectsTable = pgTable("manual_projects", {
  id: serial("id").primaryKey(),
  magazine: text("magazine").notNull(),
  project: text("project").notNull(),
  copies: integer("copies").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reprintTaskCreated: boolean("reprint_task_created").notNull().default(false),
  reprintTaskCreatedAt: timestamp("reprint_task_created_at"),
  reprintCompletedAt: timestamp("reprint_completed_at"),
  twitterTaskCreated: boolean("twitter_task_created").notNull().default(false),
  twitterTaskCreatedAt: timestamp("twitter_task_created_at"),
});

export type ManualProject = typeof manualProjectsTable.$inferSelect;
