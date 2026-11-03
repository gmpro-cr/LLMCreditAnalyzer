/**
 * Save a detailed (v2) CAM into a case: the sections, the workspace summary (cam_meta) and the risk flags.
 * Shared by the engine's Generate (routes/memos.ts) and the credit agent (routes/agent.ts), so both land in
 * the case the same way: rows a pre-v2 case lacks are created, titles refreshed, locked sections kept.
 */
import { listSections, bulkUpdateSections, insertSections, replaceRiskFlags, insertCaseDocument, updateCaseDocument } from "./supabase-db.js";
import { MEMO_SECTIONS, blankSectionRows } from "./sections.js";

type Section = { content?: string; confidence?: string; ai_generated?: boolean; drafted?: boolean };

export interface SaveOptions {
  /** Only these sections were redrafted: keep the summary and risk flags, merge failed_sections. */
  requested?: string[];
  /** The case's documents (to find an existing cam_meta row). */
  docs: Record<string, unknown>[];
  /** Confidence written on each section when the source gives none. The agent grades nothing ("agent": no badge). */
  defaultConfidence?: string;
  /** Extra fields for the workspace summary (e.g. which engine drafted it). */
  meta?: Record<string, unknown>;
}

/** Returns the AI sections the source could not draft. */
export async function saveDetailedCam(caseId: number, camSections: Record<string, unknown>, opts: SaveOptions): Promise<string[]> {
  const partial = !!opts.requested?.length;
  const existing = await listSections(caseId);
  const have = new Map(existing.map((s) => [s.section_key as string, s]));
  const missing = MEMO_SECTIONS.map((s) => s.key).filter((k) => !have.has(k) && camSections[k]);
  if (missing.length) await insertSections(blankSectionRows(caseId, missing));
  const updates: { sectionKey: string; values: Record<string, unknown> }[] = [];
  for (const s of MEMO_SECTIONS) {
    const sec = camSections[s.key] as Section | undefined;
    if (!sec?.content?.trim() || have.get(s.key)?.is_locked) continue;
    updates.push({ sectionKey: s.key, values: { content: sec.content, confidence: sec.confidence || opts.defaultConfidence || "medium", section_title: s.title } });
  }
  if (updates.length) await bulkUpdateSections(caseId, updates);
  const failedSections = MEMO_SECTIONS.map((s) => s.key).filter((k) => {
    const sec = camSections[k] as Section | undefined;
    return !!sec?.ai_generated && !sec.drafted;
  });
  // Workspace summary (headline figures, sources, open RM items) — stored as
  // its own Data Room row like rm_inputs, so no schema change is needed.
  const metaDoc = opts.docs.find((d) => d.doc_type === "cam_meta");
  const prevMeta = (metaDoc?.extracted_data as Record<string, unknown> | null) || {};
  // failed_sections drives the "Redraft N sections" prompt on the case page.
  const meta = partial
    ? {
        ...prevMeta,
        failed_sections: [...new Set([
          ...((prevMeta.failed_sections as string[] | undefined) ?? []).filter((k) => !opts.requested!.includes(k)),
          ...failedSections,
        ])],
      }
    : {
        ...((camSections["_summary"] as Record<string, unknown>) || {}),
        info_requests: camSections["_info_requests"] ?? [],
        failed_sections: failedSections,
        generated_at: new Date().toISOString(),
        ...(opts.meta ?? {}),
      };
  try {
    if (metaDoc) await updateCaseDocument(Number(metaDoc.id), { extracted_data: meta });
    else await insertCaseDocument({ case_id: caseId, doc_type: "cam_meta", filename: "CAM summary", storage_path: "", fiscal_year: null, extracted_data: meta, source: "engine" });
  } catch (e) {
    console.error("[cam-save] could not save CAM summary:", e);
  }
  const flags = Array.isArray(camSections["_risk_flags"]) ? camSections["_risk_flags"] as Record<string, unknown>[] : [];
  if (!partial) await replaceRiskFlags(caseId, flags.map((f) => ({
    case_id: caseId,
    risk_type: String(f.title ?? f.ratio_key ?? "Risk"),
    severity: ["high", "medium", "low"].includes(String(f.severity)) ? String(f.severity) : "medium",
    description: String(f.description ?? ""),
  })));
  return failedSections;
}
