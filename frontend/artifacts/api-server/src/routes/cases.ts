import { Router } from "express";
import { listCases, getCase, createCase, updateCase, deleteCase, insertSections, insertActivity } from "../lib/supabase-db.js";
import { ListCasesQueryParams, CreateCaseBody, GetCaseParams, UpdateCaseParams, UpdateCaseBody, DeleteCaseParams } from "@workspace/api-zod";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCase(c: any) {
  return {
    ...c,
    borrowerName:   c.borrower_name,
    facilityType:   c.facility_type,
    facilityAmount: Number(c.facility_amount),
    rmName:         c.rm_name,
    memoProgress:   c.memo_progress,
    createdAt:      c.created_at,
    updatedAt:      c.updated_at,
  };
}

router.get("/", async (req, res) => {
  const params = ListCasesQueryParams.safeParse(req.query);
  const rows = await listCases(req.db, params.success ? params.data : {});
  res.json(rows.map(formatCase));
});

router.post("/", async (req, res) => {
  const body = CreateCaseBody.parse(req.body);
  const newCase = await createCase(req.db, {
    user_id: req.userId,
    borrower_name: body.borrowerName,
    cin: body.cin ?? null,
    pan: body.pan ?? null,
    facility_type: body.facilityType,
    facility_amount: body.facilityAmount,
    sector: body.sector,
    rm_name: body.rmName,
    status: "draft",
    memo_progress: 0,
  });

  await insertSections(req.db, MEMO_SECTIONS.map((s) => ({
    case_id: newCase.id,
    section_key: s.key,
    section_title: s.title,
    content: "",
    confidence: "pending",
    is_reviewed: false,
    is_locked: false,
  })));

  await insertActivity(req.db, { case_id: newCase.id, borrower_name: newCase.borrower_name, action: "Case created", actor: newCase.rm_name });
  res.status(201).json(formatCase(newCase));
});

router.get("/:id", async (req, res) => {
  const { id } = GetCaseParams.parse({ id: Number(req.params.id) });
  const c = await getCase(req.db, id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Not found" });
  return res.json(formatCase(c));
});

router.patch("/:id", async (req, res) => {
  const { id } = UpdateCaseParams.parse({ id: Number(req.params.id) });
  const body = UpdateCaseBody.parse(req.body);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.borrowerName !== undefined) updates.borrower_name = body.borrowerName;
  if (body.cin !== undefined) updates.cin = body.cin;
  if (body.pan !== undefined) updates.pan = body.pan;
  if (body.facilityType !== undefined) updates.facility_type = body.facilityType;
  if (body.facilityAmount !== undefined) updates.facility_amount = body.facilityAmount;
  if (body.sector !== undefined) updates.sector = body.sector;
  if (body.rmName !== undefined) updates.rm_name = body.rmName;
  if (body.status !== undefined) updates.status = body.status;

  const updated = await updateCase(req.db, id, updates).catch(() => null);
  if (!updated) return res.status(404).json({ error: "Not found" });

  await insertActivity(req.db, { case_id: id, borrower_name: updated.borrower_name, action: body.status ? `Status changed to ${body.status}` : "Case updated", actor: updated.rm_name });
  return res.json(formatCase(updated));
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteCaseParams.parse({ id: Number(req.params.id) });
  await deleteCase(req.db, id);
  res.status(204).send();
});

export default router;
