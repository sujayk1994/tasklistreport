import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const reprintReceiptsTable = pgTable("reprint_receipts", {
  id: serial("id").primaryKey(),
  magazine: text("magazine").notNull(),
  project: text("project").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReprintReceipt = typeof reprintReceiptsTable.$inferSelect;

export const reprintCompletionsTable = pgTable("reprint_completions", {
  id: serial("id").primaryKey(),
  magazine: text("magazine").notNull(),
  project: text("project").notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReprintCompletion = typeof reprintCompletionsTable.$inferSelect;
