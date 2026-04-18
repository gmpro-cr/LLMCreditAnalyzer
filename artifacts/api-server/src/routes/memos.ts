import { Router } from "express";
import { listSections, updateSection, bulkUpdateSections, listRiskFlags, insertActivity, updateCase, getCase, getCaseExtractedData } from "../lib/supabase-db.js";
import { ListSectionsParams, UpdateSectionBody, GenerateMemoParams, ListRiskFlagsParams } from "@workspace/api-zod";

const router = Router({ mergeParams: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSection(s: any) {
  return {
    ...s,
    caseId:       s.case_id,
    sectionKey:   s.section_key,
    sectionTitle: s.section_title,
    isReviewed:   s.is_reviewed,
    isLocked:     s.is_locked,
    updatedAt:    s.updated_at,
  };
}

router.get("/:id/sections", async (req, res) => {
  const { id } = ListSectionsParams.parse({ id: Number(req.params.id) });
  const sections = await listSections(id);
  res.json(sections.map(formatSection));
});

router.patch("/:id/sections/:sectionKey", async (req, res) => {
  const id = Number(req.params.id);
  const sectionKey = req.params.sectionKey;
  const body = UpdateSectionBody.parse(req.body);

  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.isReviewed !== undefined) updates.is_reviewed = body.isReviewed;
  if (body.isLocked !== undefined) updates.is_locked = body.isLocked;

  const updated = await updateSection(id, sectionKey, updates).catch(() => null);
  if (!updated) return res.status(404).json({ error: "Section not found" });

  // Recompute memo_progress
  const allSections = await listSections(id);
  const progress = Math.round((allSections.filter((s) => s.is_reviewed).length / allSections.length) * 100);
  await updateCase(id, { memo_progress: progress, updated_at: new Date().toISOString() });

  return res.json(formatSection(updated));
});

router.post("/:id/generate", async (req, res) => {
  const { id } = GenerateMemoParams.parse({ id: Number(req.params.id) });
  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const pythonUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8001";

  // Load any collected data from the Data Room
  const extracted = await getCaseExtractedData(id).catch(() => null);

  // If financials has multi-year arrays (from BSE/Screener fetch), use directly.
  // Otherwise fall back to base case info.
  const extractedFin = (extracted?.financials as Record<string, unknown>) || {};
  const hasMulitYear = Array.isArray((extractedFin?.profit_loss as Record<string, unknown>)?.years);

  // If no multi-year PDF data, check if research contains Screener financials
  let screenerFin: Record<string, unknown> = {};
  if (!hasMulitYear && extracted?.research) {
    const researchItems = Array.isArray(extracted.research) ? extracted.research : [];
    for (const item of researchItems as Record<string, unknown>[]) {
      if (item?.financials && typeof item.financials === "object") {
        screenerFin = item.financials as Record<string, unknown>;
        break;
      }
    }
  }

  const financials = {
    company_info: { name: c.borrower_name, industry: c.sector, financial_year: new Date().getFullYear().toString() },
    ...screenerFin,
    ...extractedFin,
  };

  const researchBrief = [
    `Sector: ${c.sector}. Facility: ${c.facility_type.replace(/_/g, " ")}, INR ${Number(c.facility_amount).toLocaleString("en-IN")} Lakhs. RM: ${c.rm_name}.`,
    extracted?.research ? `\n\nResearch findings:\n${JSON.stringify(extracted.research).slice(0, 4000)}` : "",
    extracted?.organogram ? `\n\nGroup structure: ${JSON.stringify(extracted.organogram).slice(0, 1000)}` : "",
  ].join("");

  const peers = (extracted?.peers as unknown[]) || [];

  const KEY_MAP: Record<string, string> = {
    company_background:  "business_profile",
    group_structure:     "group_organogram",
    management_profile:  "promoter_background",
    business_model:      "business_profile",
    industry_analysis:   "industry_analysis",
    financial_analysis:  "financial_analysis",
    working_capital:     "working_capital_analysis",
    banking_arrangement: "banking_arrangement",
    proposed_structure:  "proposed_structure",
    peer_comparison:     "peer_comparison",
    key_issues:          "risk_summary",
    recommendation:      "recommendation",
    executive_summary:   "executive_summary",
  };

  try {
    const pyRes = await fetch(`${pythonUrl}/cam/draft-sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        financials,
        ratios: {},
        company_name: c.borrower_name,
        research_brief: researchBrief,
        peers,
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (pyRes.ok) {
      const pyData = await pyRes.json();
      const camSections = pyData.cam_sections || pyData.sections || pyData || {};
      const updates: { sectionKey: string; values: Record<string, unknown> }[] = [];
      for (const [pyKey, uiKey] of Object.entries(KEY_MAP)) {
        const sec = camSections[pyKey];
        if (sec?.content) {
          updates.push({ sectionKey: uiKey, values: { content: sec.content, confidence: sec.confidence || "medium" } });
        }
      }
      if (updates.length) await bulkUpdateSections(id, updates);
    }
  } catch (e) {
    console.error("[generate] Python service error:", e);
  }

  // Recompute progress from actual reviewed sections (don't regress existing progress)
  const allSections = await listSections(id);
  const progress = allSections.length
    ? Math.round((allSections.filter((s) => s.is_reviewed).length / allSections.length) * 100)
    : 0;
  await updateCase(id, { memo_progress: Math.max(progress, 10), updated_at: new Date().toISOString() });
  await insertActivity({ case_id: id, borrower_name: c.borrower_name, action: "AI generation completed — all 12 sections drafted", actor: "CreditGuard AI" });

  return res.json({ message: "Memo generated successfully", caseId: id });
});

router.get("/:id/risk-flags", async (req, res) => {
  const { id } = ListRiskFlagsParams.parse({ id: Number(req.params.id) });
  const flags = await listRiskFlags(id);
  res.json(flags);
});

router.get("/:id/export-pdf", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });

  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const sections = await listSections(id).catch(() => []);
  const pythonUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8001";

  // Assemble memo_content from all sections with content
  const SECTION_ORDER = [
    "executive_summary", "group_organogram", "promoter_background", "business_profile",
    "industry_analysis", "financial_analysis", "working_capital_analysis",
    "banking_arrangement", "proposed_structure", "peer_comparison", "risk_summary", "recommendation",
  ];
  const sectionMap = Object.fromEntries(sections.map((s) => [s.section_key, s]));

  const memoContent = [
    `# Credit Appraisal Memorandum\n## ${c.borrower_name}\n`,
    `**Facility:** ${c.facility_type.replace(/_/g, " ")} | **Amount:** ₹${Number(c.facility_amount).toLocaleString("en-IN")} | **Sector:** ${c.sector} | **RM:** ${c.rm_name}\n\n---\n`,
    ...SECTION_ORDER.map((key) => {
      const s = sectionMap[key];
      if (!s?.content) return "";
      return `## ${s.section_title}\n\n${s.content}\n\n`;
    }),
  ].join("");

  try {
    const pyRes = await fetch(`${pythonUrl}/export-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo_content: memoContent, company_name: c.borrower_name }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!pyRes.ok) {
      const err = await pyRes.text();
      return res.status(502).json({ error: `PDF export failed: ${err}` });
    }

    const pdfBuffer = Buffer.from(await pyRes.arrayBuffer());
    const safeName = c.borrower_name.replace(/[^a-zA-Z0-9]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="CAM_${safeName}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (e) {
    console.error("[export-pdf] Error:", e);
    return res.status(500).json({ error: "PDF export failed" });
  }
});

export default router;
