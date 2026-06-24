import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const twitterMarketingCompletionsTable = pgTable(
  "twitter_marketing_completions",
  {
    id: serial("id").primaryKey(),
    magazine: text("magazine").notNull(),
    project: text("project").notNull(),
    completedAt: timestamp("completed_at").defaultNow().notNull(),
    printTaskCreated: boolean("print_task_created").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export type TwitterMarketingCompletion =
  typeof twitterMarketingCompletionsTable.$inferSelect;

export const addressReceiptsTable = pgTable("address_receipts", {
  id: serial("id").primaryKey(),
  magazine: text("magazine").notNull(),
  project: text("project").notNull(),
  copies: integer("copies").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AddressReceipt = typeof addressReceiptsTable.$inferSelect;
