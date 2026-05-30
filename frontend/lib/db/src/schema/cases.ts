import { pgTable, serial, text, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  borrowerName: text("borrower_name").notNull(),
  cin: text("cin"),
  pan: text("pan"),
  facilityType: text("facility_type").notNull(),
  facilityAmount: numeric("facility_amount", { precision: 15, scale: 2 }).notNull(),
  sector: text("sector").notNull(),
  rmName: text("rm_name").notNull(),
  status: text("status").notNull().default("draft"),
  memoProgress: integer("memo_progress").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
