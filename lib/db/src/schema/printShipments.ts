import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const printShipmentsTable = pgTable(
  "print_shipments",
  {
    id: serial("id").primaryKey(),
    magazine: text("magazine").notNull(),
    project: text("project").notNull(),
    printCopies: integer("print_copies").notNull(),
    printDate: text("print_date").notNull(),
    shipmentDate: text("shipment_date").notNull(),
    shipmentCreated: boolean("shipment_created").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("print_shipments_unique").on(
      t.magazine,
      t.project,
      t.printDate,
    ),
  ],
);

export type PrintShipment = typeof printShipmentsTable.$inferSelect;
