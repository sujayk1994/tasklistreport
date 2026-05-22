import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const inboxRulesTable = pgTable("inbox_rules", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  subjectPattern: text("subject_pattern").notNull(),
  parserType: text("parser_type").notNull().$type<"reminder" | "pending_list" | "shipment" | "ad_request" | "subject_as_task" | "bullet_list" | "plain_lines">(),
  taskSuffix: text("task_suffix"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InboxRule = typeof inboxRulesTable.$inferSelect;
export type NewInboxRule = typeof inboxRulesTable.$inferInsert;
