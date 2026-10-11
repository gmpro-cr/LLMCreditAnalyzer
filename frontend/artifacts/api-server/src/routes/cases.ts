import { Router } from "express";
import { listCases, getCase, createCase, updateCase, deleteCase, insertSections, insertActivity, nullIfMissing } from "../lib/supabase-db.js";
import { blankSectionRows } from "../lib/sections.js";
import { ListCasesQueryParams, CreateCaseBody, GetCaseParams, UpdateCaseParams, UpdateCaseBody, DeleteCaseParams } from "@workspace/api-zod";

const router = Router();



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
  const rows = await listCases(params.success ? params.data : {});
  res.json(rows.map(formatCase));
});

router.post("/", async (req, res) => {
  const body = CreateCaseBody.parse(req.body);
  const newCase = await createCase({
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

  await insertSections(blankSectionRows(newCase.id));

  await insertActivity({ case_id: newCase.id, borrower_name: newCase.borrower_name, action: "Case created", actor: newCase.rm_name });
  res.status(201).json(formatCase(newCase));
});

router.get("/:id", async (req, res) => {
  const { id } = GetCaseParams.parse({ id: Number(req.params.id) });
  const c = await getCase(id).catch(nullIfMissing);
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

  const updated = await updateCase(id, updates).catch(nullIfMissing);
  if (!updated) return res.status(404).json({ error: "Not found" });

  await insertActivity({ case_id: id, borrower_name: updated.borrower_name, action: body.status ? `Status changed to ${body.status}` : "Case updated", actor: updated.rm_name });
  return res.json(formatCase(updated));
});

router.delete("/:id", async (req, res) => {
  const { id } = DeleteCaseParams.parse({ id: Number(req.params.id) });
  await deleteCase(id);
  res.status(204).send();
});

export default router;
