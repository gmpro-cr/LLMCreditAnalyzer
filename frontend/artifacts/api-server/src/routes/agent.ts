/**
 * The credit agent, a separate service (credit-analyst-agent), investigating a case and drafting its CAM.
 *
 *   POST   /cases/:id/agent       start an investigation for this case
 *   GET    /cases/:id/agent       progress; when the run is done, imports the CAM into the case (once)
 *   GET    /cases/:id/agent/pdf   the agent's CAM PDF
 *   DELETE /cases/:id/agent       cancel the run
 *
 * The run is tracked on a Data Room row (doc_type "agent_run"), like cam_meta, so no schema change is needed.
 * Importing writes the same rows as Generate (sections, summary, risk flags) and keeps locked sections.
 */
import { Router } from "express";
import { getCase, getCaseExtractedData, listCaseDocuments, insertCaseDocument, updateCaseDocument, insertActivity, updateCase, listSections, nullIfMissing } from "../lib/supabase-db.js";
import { saveDetailedCam } from "../lib/cam-save.js";
import { AGENT_URL, agentHeaders, agentConfigured } from "../lib/agent.js";

const router = Router({ mergeParams: true });
const ACTOR = "CreditGuard AI agent";
const ACTIVE = new Set(["queued", "running", "writing"]);
const importing = new Set<string>();   // job ids being imported by this process (a second poll waits)

type Run = Record<string, unknown> & { job_id?: string; status?: string; imported?: boolean };

async function latestRun(caseId: number) {
  const docs = await listCaseDocuments(caseId);
  const doc = docs.find((d) => d.doc_type === "agent_run");      // newest first
  return { docs, doc, run: ((doc?.extracted_data as Run | null) ?? {}) as Run };
}

function caseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post("/:id/agent", async (req, res) => {
  const id = caseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid case id" });
  if (!agentConfigured()) return res.status(503).json({ error: "The credit agent is not configured (AGENT_SERVICE_URL / AGENT_API_TOKEN).", code: "agent_not_configured" });
  const c = await getCase(id).catch(nullIfMissing);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const { doc, run } = await latestRun(id);
  if (run.status && ACTIVE.has(run.status)) return res.status(409).json({ error: "An investigation is already running for this case.", code: "agent_running" });

  // What the agent needs from the case: the borrower, the facility, and what the Data Room already knows.
  const extracted = await getCaseExtractedData(id).catch(() => null);
  const symbol = ((extracted?.financials as { company_info?: { symbol?: string } } | null)?.company_info?.symbol) || undefined;
  const docs = await listCaseDocuments(id).catch(() => [] as Record<string, unknown>[]);
  const rmInputs = (docs.find((d) => d.doc_type === "rm_inputs")?.extracted_data as Record<string, unknown> | null) || undefined;
  const tenor = Number((rmInputs?.proposal as { tenor_months?: unknown } | undefined)?.tenor_months) || undefined;

  let job: { job_id: string; status: string };
  try {
    const r = await fetch(`${AGENT_URL()}/investigate`, {
      method: "POST",
      headers: agentHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        company: c.borrower_name, facility_type: c.facility_type, amount_cr: Number(c.facility_amount) / 1e7,
        tenor_months: tenor, symbol, rm_inputs: rmInputs, reference: `case:${id}`,
      }),
      signal: AbortSignal.timeout(90_000),       // the agent service may be waking from sleep
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      console.error("[agent] start failed", r.status, err.slice(0, 300));
      return res.status(502).json({ error: `The credit agent refused the request (${r.status}).`, code: "agent_refused" });
    }
    job = await r.json() as { job_id: string; status: string };
  } catch (e) {
    console.error("[agent] start error:", e);
    // Not "upstream_unavailable": the client must not auto-retry a start that may
    // have been accepted. Refreshing the case shows any run the agent did begin.
    return res.status(503).json({ error: "The credit agent did not answer. Refresh the case in a minute before starting it again.", code: "agent_unreachable" });
  }

  const state: Run = { job_id: job.job_id, status: job.status, started_at: new Date().toISOString(), imported: false, steps: [] };
  const fields = { extracted_data: state, filename: "AI agent investigation", source: "agent" };
  if (doc) await updateCaseDocument(Number(doc.id), fields);
  else await insertCaseDocument({ case_id: id, doc_type: "agent_run", storage_path: "", fiscal_year: null, ...fields });
  await insertActivity({ case_id: id, borrower_name: c.borrower_name, action: "AI agent investigation started", actor: ACTOR }).catch(() => {});
  return res.status(202).json(state);
});

router.get("/:id/agent", async (req, res) => {
  const id = caseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid case id" });
  const { docs, doc, run } = await latestRun(id);
  if (!doc || !run.job_id) return res.json({ status: "none" });
  if (!ACTIVE.has(String(run.status)) && (run.imported || run.status !== "done")) return res.json(run);
  if (!agentConfigured()) return res.json(run);

  // Refresh from the agent service.
  let view: Record<string, unknown>;
  try {
    const r = await fetch(`${AGENT_URL()}/jobs/${run.job_id}`, { headers: agentHeaders(), signal: AbortSignal.timeout(30_000) });
    if (r.status === 404) {
      const lost = { ...run, status: "failed", message: "The agent service no longer has this run (it was redeployed). Start it again." };
      await updateCaseDocument(Number(doc.id), { extracted_data: lost });
      return res.json(lost);
    }
    if (!r.ok) return res.json({ ...run, stale: true });
    view = await r.json() as Record<string, unknown>;
  } catch {
    return res.json({ ...run, stale: true });     // keep showing the last known state
  }
  let next: Run = { ...run, status: String(view.status), message: view.message, steps: view.steps, finished_at: view.finished_at };

  if (next.status === "done" && !run.imported && !importing.has(run.job_id)) {
    importing.add(run.job_id);
    try {
      const r = await fetch(`${AGENT_URL()}/jobs/${run.job_id}/result`, { headers: agentHeaders(), signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`result ${r.status}`);
      const result = await r.json() as {
        sections: Record<string, unknown>; risk_flags: unknown[]; summary: Record<string, unknown>; info_requests: unknown[];
        checks: Record<string, unknown>; trace: string; sources: unknown[]; entity: Record<string, unknown>; stopped_because?: string;
      };
      const c = await getCase(id);
      const failed = await saveDetailedCam(id, {
        ...result.sections, _summary: result.summary, _info_requests: result.info_requests, _risk_flags: result.risk_flags,
      }, { docs, defaultConfidence: "agent", meta: { drafted_by: "agent", agent_job_id: run.job_id } });
      next = {
        ...next, imported: true, imported_at: new Date().toISOString(), failed_sections: failed,
        checks: result.checks, entity: result.entity, trace: result.trace, sources: result.sources, stopped_because: result.stopped_because,
      };
      const all = await listSections(id);
      const progress = all.length ? Math.round((all.filter((s) => s.is_reviewed).length / all.length) * 100) : 0;
      await updateCase(id, { memo_progress: progress, updated_at: new Date().toISOString() });
      const gate = (result.checks?.decision_gate as { decision?: string } | undefined)?.decision;
      await insertActivity({ case_id: id, borrower_name: c.borrower_name, actor: ACTOR,
        action: `AI agent investigation completed — CAM drafted${gate && gate !== "clear" ? ` (decision gate: ${gate})` : ""}` }).catch(() => {});
    } catch (e) {
      console.error("[agent] import failed:", e);
      next = { ...next, import_error: "The CAM could not be imported. It will be retried on the next refresh." };
    } finally {
      importing.delete(run.job_id);
    }
  } else if (["failed", "no_cam", "cancelled"].includes(String(next.status)) && next.status !== run.status) {
    const c = await getCase(id).catch(nullIfMissing);
    if (c) await insertActivity({ case_id: id, borrower_name: c.borrower_name, actor: ACTOR,
      action: `AI agent investigation ${next.status === "cancelled" ? "cancelled" : `ended without a CAM — ${String(next.message ?? "")}`}` }).catch(() => {});
  }
  // Polled every 5 s while a run is active; only write when something changed.
  if (JSON.stringify(next) !== JSON.stringify(run)) await updateCaseDocument(Number(doc.id), { extracted_data: next });
  return res.json(next);
});

router.get("/:id/agent/pdf", async (req, res) => {
  const id = caseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid case id" });
  const { run } = await latestRun(id);
  if (!run.job_id || run.status !== "done" || !agentConfigured()) return res.status(404).json({ error: "No agent CAM for this case yet." });
  const r = await fetch(`${AGENT_URL()}/jobs/${run.job_id}/pdf`, { headers: agentHeaders(), signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!r?.ok) return res.status(502).json({ error: "The agent's PDF is not available." });
  const c = await getCase(id).catch(nullIfMissing);
  const name = String(c?.borrower_name ?? "borrower").replace(/[^a-zA-Z0-9]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="CAM_${name}_agent.pdf"`);
  return res.send(Buffer.from(await r.arrayBuffer()));
});

router.delete("/:id/agent", async (req, res) => {
  const id = caseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid case id" });
  const { doc, run } = await latestRun(id);
  if (!doc || !run.job_id || !ACTIVE.has(String(run.status))) return res.status(409).json({ error: "No investigation is running." });
  if (agentConfigured()) await fetch(`${AGENT_URL()}/jobs/${run.job_id}`, { method: "DELETE", headers: agentHeaders(), signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const next = { ...run, status: "cancelled", message: "Cancelled", finished_at: Date.now() / 1000 };
  await updateCaseDocument(Number(doc.id), { extracted_data: next });
  const c = await getCase(id).catch(nullIfMissing);
  if (c) await insertActivity({ case_id: id, borrower_name: c.borrower_name, action: "AI agent investigation cancelled", actor: ACTOR }).catch(() => {});
  return res.json(next);
});

export default router;
