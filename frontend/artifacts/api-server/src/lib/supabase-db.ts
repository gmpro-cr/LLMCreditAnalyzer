/**
 * Supabase-based database adapter.
 * Replaces direct Drizzle/pg connection — uses Supabase REST API with service role key.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ── Cases ─────────────────────────────────────────────────────────────────

export async function listCases(filters?: { status?: string; search?: string }) {
  let query = supabase.from("cases").select("*").order("updated_at", { ascending: false });
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.search) query = query.ilike("borrower_name", `%${filters.search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getCase(id: number) {
  const { data, error } = await supabase.from("cases").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createCase(values: Record<string, unknown>) {
  const { data, error } = await supabase.from("cases").insert(values).select().single();
  if (error) throw error;
  return data;
}

export async function updateCase(id: number, values: Record<string, unknown>) {
  const { data, error } = await supabase.from("cases").update(values).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCase(id: number) {
  const { error } = await supabase.from("cases").delete().eq("id", id);
  if (error) throw error;
}

// ── Memo Sections ─────────────────────────────────────────────────────────

export async function listSections(caseId: number) {
  const { data, error } = await supabase
    .from("memo_sections").select("*").eq("case_id", caseId).order("id");
  if (error) throw error;
  return data ?? [];
}

export async function updateSection(caseId: number, sectionKey: string, values: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("memo_sections").update({ ...values, updated_at: new Date().toISOString() })
    .eq("case_id", caseId).eq("section_key", sectionKey).select().single();
  if (error) throw error;
  return data;
}

export async function insertSections(rows: Record<string, unknown>[]) {
  const { error } = await supabase.from("memo_sections").insert(rows);
  if (error) throw error;
}

export async function bulkUpdateSections(caseId: number, updates: { sectionKey: string; values: Record<string, unknown> }[]) {
  for (const { sectionKey, values } of updates) {
    await supabase.from("memo_sections")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("case_id", caseId).eq("section_key", sectionKey);
  }
}

// ── Risk Flags ────────────────────────────────────────────────────────────

export async function listRiskFlags(caseId: number) {
  const { data, error } = await supabase.from("risk_flags").select("*").eq("case_id", caseId);
  if (error) throw error;
  return data ?? [];
}

// ── Activity Log ──────────────────────────────────────────────────────────

export async function insertActivity(values: Record<string, unknown>) {
  const { error } = await supabase.from("activity_log").insert(values);
  if (error) throw error;
}

// ── Case Documents ────────────────────────────────────────────────────────

export async function listCaseDocuments(caseId: number) {
  const { data, error } = await supabase
    .from("case_documents").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertCaseDocument(values: Record<string, unknown>) {
  const { data, error } = await supabase.from("case_documents").insert(values).select().single();
  if (error) throw error;
  return data;
}

export async function updateCaseDocument(id: number, values: Record<string, unknown>) {
  const { data, error } = await supabase.from("case_documents").update(values).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCaseDocument(id: number) {
  const { error } = await supabase.from("case_documents").delete().eq("id", id);
  if (error) throw error;
}

// ── Case Extracted Data ───────────────────────────────────────────────────

export async function getCaseExtractedData(caseId: number) {
  const { data } = await supabase
    .from("case_extracted_data").select("*").eq("case_id", caseId).single();
  return data ?? null;
}

// NOTE: This upsert only sets the columns present in `values` — other JSON columns are untouched.
// Concurrent writes to the same column (e.g. two research runs simultaneously) are NOT safe;
// callers that need read-modify-write (like run-research) must do so manually.
export async function upsertCaseExtractedData(caseId: number, values: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("case_extracted_data")
    .upsert({ case_id: caseId, ...values, updated_at: new Date().toISOString() }, { onConflict: "case_id" })
    .select().single();
  if (error) throw error;
  return data;
}
