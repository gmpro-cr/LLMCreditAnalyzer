import { Router } from "express";
import { db } from "@workspace/db";
import { casesTable, memoSectionsTable, activityLogTable } from "@workspace/db";
import { eq, ilike, and, isNull, sql } from "drizzle-orm";
import {
  ListCasesQueryParams,
  CreateCaseBody,
  GetCaseParams,
  UpdateCaseParams,
  UpdateCaseBody,
  DeleteCaseParams,
} from "@workspace/api-zod";

const router = Router();

const MEMO_SECTIONS = [
  { key: "executive_summary", title: "Executive Summary" },
  { key: "group_organogram", title: "Group Organogram" },
  { key: "promoter_background", title: "Promoter Background" },
  { key: "business_profile", title: "Business Profile" },
  { key: "industry_analysis", title: "Industry Analysis" },
  { key: "financial_analysis", title: "Financial Analysis" },
  { key: "working_capital_analysis", title: "Working Capital Analysis" },
  { key: "banking_arrangement", title: "Banking Arrangement" },
  { key: "proposed_structure", title: "Proposed Structure" },
  { key: "peer_comparison", title: "Peer Comparison" },
  { key: "risk_summary", title: "Risk Summary" },
  { key: "recommendation", title: "Recommendation" },
];

function formatCase(c: typeof casesTable.$inferSelect) {
  return {
    ...c,
    facilityAmount: Number(c.facilityAmount),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const params = ListCasesQueryParams.safeParse(req.query);
  const query = db.select().from(casesTable).$dynamic();
  const conditions = [];

  if (params.success && params.data.status) {
    conditions.push(eq(casesTable.status, params.data.status));
  }
  if (params.success && params.data.search) {
    conditions.push(ilike(casesTable.borrowerName, `%${params.data.search}%`));
  }

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(casesTable)
          .where(and(...conditions))
          .orderBy(sql`${casesTable.updatedAt} desc`)
      : await db.select().from(casesTable).orderBy(sql`${casesTable.updatedAt} desc`);

  res.json(rows.map(formatCase));
});

router.post("/", async (req, res) => {
  const body = CreateCaseBody.parse(req.body);

  const [newCase] = await db
    .insert(casesTable)
    .values({
      borrowerName: body.borrowerName,
      cin: body.cin ?? null,
      pan: body.pan ?? null,
      facilityType: body.facilityType,
      facilityAmount: String(body.facilityAmount),
      sector: body.sector,
      rmName: body.rmName,
      status: "draft",
      memoProgress: 0,
    })
    .returning();

  await db.insert(memoSectionsTable).values(
    MEMO_SECTIONS.map((s) => ({
      caseId: newCase.id,
      sectionKey: s.key,
      sectionTitle: s.title,
      content: "",
      confidence: "pending" as const,
      isReviewed: false,
      isLocked: false,
    }))
  );

  await db.insert(activityLogTable).values({
    caseId: newCase.id,
    borrowerName: newCase.borrowerName,
    action: "Case created",
    actor: newCase.rmName,
  });

  res.status(201).json(formatCase(newCase));
});

router.get("/:id", async (req, res) => {
  const { id } = GetCaseParams.parse({ id: Number(req.params.id) });
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, id));
  if (!c) return res.status(404).json({ error: "Not found" });
  return res.json(formatCase(c));
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateCaseParams.parse({ id: Number(req.params.id) });
  const body = UpdateCaseBody.parse(req.body);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.borrowerName !== undefined) updates.borrowerName = body.borrowerName;
  if (body.cin !== undefined) updates.cin = body.cin;
  if (body.pan !== undefined) updates.pan = body.pan;
  if (body.facilityType !== undefined) updates.facilityType = body.facilityType;
  if (body.facilityAmount !== undefined) updates.facilityAmount = String(body.facilityAmount);
  if (body.sector !== undefined) updates.sector = body.sector;
  if (body.rmName !== undefined) updates.rmName = body.rmName;
  if (body.status !== undefined) updates.status = body.status;

  const [updated] = await db
    .update(casesTable)
    .set(updates)
    .where(eq(casesTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Not found" });

  await db.insert(activityLogTable).values({
    caseId: id,
    borrowerName: updated.borrowerName,
    action: body.status ? `Status changed to ${body.status}` : "Case updated",
    actor: updated.rmName,
  });

  return res.json(formatCase(updated));
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteCaseParams.parse({ id: Number(req.params.id) });
  await db.delete(memoSectionsTable).where(eq(memoSectionsTable.caseId, id));
  await db.delete(activityLogTable).where(eq(activityLogTable.caseId, id));
  await db.delete(casesTable).where(eq(casesTable.id, id));
  res.status(204).send();
});

export default router;
