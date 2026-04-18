import { Router } from "express";
import path from "path";
import multer from "multer";
import {
  listCaseDocuments,
  insertCaseDocument,
  deleteCaseDocument,
  getCaseExtractedData,
  upsertCaseExtractedData,
  getCase,
  supabase,
} from "../lib/supabase-db.js";

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const PYTHON_URL = () => process.env.PYTHON_SERVICE_URL || "http://localhost:8001";

// ── GET /api/cases/:id/data-room ───────────────────────────────────────────
router.get("/:id/data-room", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  try {
    const [docs, extracted] = await Promise.all([
      listCaseDocuments(id),
      getCaseExtractedData(id),
    ]);

    const checks = [
      docs.some((d: Record<string, unknown>) => d.doc_type === "annual_report"),
      !!(extracted?.research && (extracted.research as unknown[]).length > 0),
      !!(extracted?.peers && (extracted.peers as unknown[]).length > 0),
      docs.some((d: Record<string, unknown>) => d.doc_type === "organogram"),
      docs.some((d: Record<string, unknown>) => d.doc_type === "security"),
    ];
    const completeness = Math.round((checks.filter(Boolean).length / checks.length) * 100);

    res.json({ documents: docs, extractedData: extracted, completeness });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load data room" });
  }
});

// ── POST /api/cases/:id/data-room/fetch-reports ───────────────────────────
router.post("/:id/data-room/fetch-reports", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const { symbol, companyName } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  let pyRes: Response;
  try {
    pyRes = await fetch(`${PYTHON_URL()}/fetch-annual-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, company_name: companyName || "" }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: unknown) {
    return res.status(502).json({ error: `Python service unreachable: ${(e as Error).message}` });
  }

  if (!pyRes.ok) {
    const err = await pyRes.text();
    return res.status(502).json({ error: `Annual report fetch failed: ${err}` });
  }

  const pyData = await pyRes.json() as { reports: Record<string, unknown>[]; merged_financials: Record<string, unknown> };
  const { reports, merged_financials } = pyData;

  try {
    for (const rpt of reports) {
      if (rpt.error) continue;
      await insertCaseDocument({
        case_id: id,
        doc_type: "annual_report",
        filename: `Annual Report ${rpt.fiscal_year}.pdf`,
        storage_path: `case-${id}/annual-reports/${rpt.fiscal_year}.pdf`,
        fiscal_year: rpt.fiscal_year,
        extracted_data: rpt.financials || null,
        source: rpt.source || "bse",
      });
    }
    await upsertCaseExtractedData(id, { financials: merged_financials });
  } catch (e) {
    console.error("[fetch-reports] DB error:", e);
    // still return what Python found, even if DB write partially failed
  }

  return res.json({ ok: true, reportsFound: reports.length, reports });
});

// ── POST /api/cases/:id/data-room/run-research ────────────────────────────
router.post("/:id/data-room/run-research", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  let pyRes: Response;
  try {
    pyRes = await fetch(`${PYTHON_URL()}/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: c.borrower_name, sector: c.sector }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e: unknown) {
    return res.status(502).json({ error: `Research service unreachable: ${(e as Error).message}` });
  }

  if (!pyRes.ok) {
    const errBody = await pyRes.text().catch(() => "");
    return res.status(502).json({ error: `Research service failed: ${errBody}` });
  }

  const pyData = await pyRes.json() as Record<string, unknown>;

  const existing = await getCaseExtractedData(id);
  const existingResearch: unknown[] = (existing?.research as unknown[]) || [];
  const newFindings = pyData.findings || pyData.research || pyData.brief || pyData.brief;
  const brief = typeof pyData.brief === "string" ? pyData.brief : JSON.stringify(pyData.brief || "");
  const newItems: unknown[] = [{ content: brief, sources: pyData.sources, timestamp: new Date().toISOString() }];
  const merged = [...existingResearch, ...newItems];

  try {
    const upsertPayload: Record<string, unknown> = { research: merged };
    // If Screener returned multi-year financials, save them (only if we don't already have PDF-extracted data)
    if (pyData.financials && typeof pyData.financials === "object") {
      const fin = pyData.financials as Record<string, unknown>;
      const pl = fin.profit_loss as Record<string, unknown> | undefined;
      if (Array.isArray(pl?.years) && pl.years.length > 0) {
        const existingFin = (existing?.financials as Record<string, unknown>) || {};
        const existingPl = existingFin.profit_loss as Record<string, unknown> | undefined;
        // Only update if current financials don't already have multi-year data
        if (!Array.isArray(existingPl?.years)) {
          upsertPayload.financials = pyData.financials;
        }
      }
    }
    await upsertCaseExtractedData(id, upsertPayload);
  } catch (e) {
    return res.status(500).json({ error: "Failed to save research findings" });
  }
  return res.json({ ok: true, newItems: newItems.length, totalItems: merged.length });
});

// ── GET /api/cases/:id/data-room/peers ────────────────────────────────────
router.get("/:id/data-room/peers", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const extracted = await getCaseExtractedData(id);
  const savedPeers = (extracted?.peers as unknown[]) || [];

  if (savedPeers.length === 0) {
    let pyRes: Response | null = null;
    try {
      pyRes = await fetch(
        `${PYTHON_URL()}/search-companies?q=${encodeURIComponent(c.sector)}&limit=5`,
        { signal: AbortSignal.timeout(10_000) }
      );
    } catch {
      // ignore — return empty list
    }

    if (pyRes?.ok) {
      const suggestions = await pyRes.json() as unknown[];
      return res.json({ peers: suggestions.map((s: unknown) => ({ ...(s as object), confirmed: false, suggested: true })) });
    }
  }

  return res.json({ peers: savedPeers });
});

// ── PATCH /api/cases/:id/data-room/peers ─────────────────────────────────
router.patch("/:id/data-room/peers", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const { peers } = req.body;
  if (!Array.isArray(peers)) return res.status(400).json({ error: "peers must be an array" });
  try {
    await upsertCaseExtractedData(id, { peers });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save peers" });
  }
  return res.json({ ok: true });
});

// ── POST /api/cases/:id/data-room/upload ─────────────────────────────────
router.post("/:id/data-room/upload", upload.single("file"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const fiscalYear: string | null = req.body.fiscalYear || null;

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { buffer, originalname, mimetype } = req.file;

  // Sanitize to prevent path traversal
  const safeDocType = (req.body.docType || "other").replace(/[^a-zA-Z0-9_\-]/g, "");
  const safeFilename = path.basename(originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
  const storagePath = `case-${id}/${safeDocType}/${Date.now()}-${safeFilename}`;

  // Upload to Supabase Storage (best-effort — don't fail if bucket missing)
  const { error: uploadError } = await supabase.storage
    .from("case-documents")
    .upload(storagePath, buffer, { contentType: mimetype, upsert: false });
  if (uploadError) {
    console.warn("[upload] Supabase storage warning:", uploadError.message);
  }

  let extractedData: Record<string, unknown> | null = null;
  const isExtractable = mimetype === "application/pdf" ||
    originalname.toLowerCase().endsWith(".xlsx") ||
    originalname.toLowerCase().endsWith(".xls");
  const isOrganogram = safeDocType === "organogram";

  if (isOrganogram) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: mimetype }), originalname);
      if (req.body.companyName) formData.append("company_name", req.body.companyName);
      const pyRes = await fetch(`${PYTHON_URL()}/extract-organogram`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });
      if (pyRes.ok) {
        extractedData = await pyRes.json() as Record<string, unknown>;
        await upsertCaseExtractedData(id, { organogram: extractedData });
      }
    } catch (e) {
      console.error("[upload] Organogram extraction failed:", e);
    }
  } else if (isExtractable) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: mimetype }), originalname);
      if (req.body.companyName) formData.append("company_name", req.body.companyName);
      const pyRes = await fetch(`${PYTHON_URL()}/extract`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });
      if (pyRes.ok) {
        const d = await pyRes.json() as Record<string, unknown>;
        extractedData = d;
        if (["annual_report", "cma"].includes(safeDocType) && d.financials) {
          // Always update financials — each new upload may have more recent data
          await upsertCaseExtractedData(id, { financials: d.financials });
        }
      }
    } catch (e) {
      console.error("[upload] Extraction failed:", e);
    }
  }

  let doc: Record<string, unknown>;
  try {
    doc = await insertCaseDocument({
      case_id: id,
      doc_type: safeDocType,
      filename: originalname,
      storage_path: storagePath,
      fiscal_year: fiscalYear,
      extracted_data: extractedData,
      source: "manual",
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save document record" });
  }

  return res.status(201).json(doc);
});

// ── DELETE /api/cases/:id/data-room/documents/:docId ─────────────────────
router.delete("/:id/data-room/documents/:docId", async (req, res) => {
  const docId = Number(req.params.docId);
  if (isNaN(docId)) return res.status(400).json({ error: "Invalid document id" });
  try {
    await deleteCaseDocument(docId);
  } catch (e) {
    return res.status(500).json({ error: "Failed to delete document" });
  }
  res.status(204).send();
});

// ── POST /api/cases/:id/data-room/organogram-tree ─────────────────────────
router.post("/:id/data-room/organogram-tree", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid case id" });
  const { tree, summary } = req.body;
  try {
    const existing = await getCaseExtractedData(id);
    const current = (existing?.organogram as Record<string, unknown>) || {};
    await upsertCaseExtractedData(id, { organogram: { ...current, manual_tree: tree, manual_summary: summary } });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save organogram" });
  }
  return res.json({ ok: true });
});

export default router;
