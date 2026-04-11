import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoSectionsTable = pgTable("memo_sections", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  sectionKey: text("section_key").notNull(),
  sectionTitle: text("section_title").notNull(),
  content: text("content").notNull().default(""),
  confidence: text("confidence").notNull().default("pending"),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  isLocked: boolean("is_locked").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMemoSectionSchema = createInsertSchema(memoSectionsTable).omit({ id: true, updatedAt: true });
export type InsertMemoSection = z.infer<typeof insertMemoSectionSchema>;
export type MemoSection = typeof memoSectionsTable.$inferSelect;
