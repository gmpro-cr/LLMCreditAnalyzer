import { pgTable, serial, integer, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const riskFlagsTable = pgTable("risk_flags", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  riskType: text("risk_type").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  mitigation: text("mitigation"),
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
});

export const insertRiskFlagSchema = createInsertSchema(riskFlagsTable).omit({ id: true });
export type InsertRiskFlag = z.infer<typeof insertRiskFlagSchema>;
export type RiskFlag = typeof riskFlagsTable.$inferSelect;
