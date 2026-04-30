import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const processedEmailsTable = pgTable("processed_emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  subject: text("subject").notNull().default(""),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type ProcessedEmail = typeof processedEmailsTable.$inferSelect;
