/**
 * Supabase-based database adapter.
 *
 * Access model:
 *  - Every request handler operates through a *per-request* client bound to the
 *    caller's access token (see middlewares/auth.ts -> req.db). RLS therefore
 *    scopes all table access to the signed-in user. Each data function below
 *    takes that client as its first argument.
 *  - `supabaseAdmin` (service-role, RLS-bypassing) is exported ONLY for Supabase
 *    Storage operations, which are namespaced by case-<id>. Never use it for
 *    table access inside request handlers.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set",
  );
}

export type Db = SupabaseClient;

/** Service-role client — bypasses RLS. Storage only. */
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

/** Per-request client bound to the caller's JWT — RLS enforced. */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Validate a bearer token and return the user (or null). Uses the anon client. */
export async function getUserFromToken(accessToken: string) {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

// ── Cases ─────────────────────────────────────────────────────────────────

export async function listCases(db: Db, filters?: { status?: string; search?: string }) {
  let query = db.from("cases").select("*").order("updated_at", { ascending: false });
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.search) query = query.ilike("borrower_name", `%${filters.search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getCase(db: Db, id: number) {
  const { data, error } = await db.from("cases").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createCase(db: Db, values: Record<string, unknown>) {
  const { data, error } = await db.from("cases").insert(values).select().single();
  if (error) throw error;
  return data;
}

export async function updateCase(db: Db, id: number, values: Record<string, unknown>) {
  const { data, error } = await db.from("cases").update(values).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCase(db: Db, id: number) {
  const { error } = await db.from("cases").delete().eq("id", id);
  if (error) throw error;
}

// ── Memo Sections ─────────────────────────────────────────────────────────

export async function listSections(db: Db, caseId: number) {
  const { data, error } = await db
    .from("memo_sections").select("*").eq("case_id", caseId).order("id");
  if (error) throw error;
  return data ?? [];
}

export async function updateSection(db: Db, caseId: number, sectionKey: string, values: Record<string, unknown>) {
  const { data, error } = await db
    .from("memo_sections").update({ ...values, updated_at: new Date().toISOString() })
    .eq("case_id", caseId).eq("section_key", sectionKey).select().single();
  if (error) throw error;
  return data;
}

export async function insertSections(db: Db, rows: Record<string, unknown>[]) {
  const { error } = await db.from("memo_sections").insert(rows);
  if (error) throw error;
}

export async function bulkUpdateSections(db: Db, caseId: number, updates: { sectionKey: string; values: Record<string, unknown> }[]) {
  for (const { sectionKey, values } of updates) {
    await db.from("memo_sections")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("case_id", caseId).eq("section_key", sectionKey);
  }
}

// ── Risk Flags ────────────────────────────────────────────────────────────

export async function listRiskFlags(db: Db, caseId: number) {
  const { data, error } = await db.from("risk_flags").select("*").eq("case_id", caseId);
  if (error) throw error;
  return data ?? [];
}

// ── Activity Log ──────────────────────────────────────────────────────────

export async function insertActivity(db: Db, values: Record<string, unknown>) {
  const { error } = await db.from("activity_log").insert(values);
  if (error) throw error;
}

// ── Case Documents ────────────────────────────────────────────────────────

export async function listCaseDocuments(db: Db, caseId: number) {
  const { data, error } = await db
    .from("case_documents").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertCaseDocument(db: Db, values: Record<string, unknown>) {
  const { data, error } = await db.from("case_documents").insert(values).select().single();
  if (error) throw error;
  return data;
}

export async function updateCaseDocument(db: Db, id: number, values: Record<string, unknown>) {
  const { data, error } = await db.from("case_documents").update(values).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCaseDocument(db: Db, id: number) {
  const { error } = await db.from("case_documents").delete().eq("id", id);
  if (error) throw error;
}

// ── Case Extracted Data ───────────────────────────────────────────────────

export async function getCaseExtractedData(db: Db, caseId: number) {
  const { data } = await db
    .from("case_extracted_data").select("*").eq("case_id", caseId).single();
  return data ?? null;
}

// NOTE: This upsert only sets the columns present in `values` — other JSON columns are untouched.
// Concurrent writes to the same column (e.g. two research runs simultaneously) are NOT safe;
// callers that need read-modify-write (like run-research) must do so manually.
export async function upsertCaseExtractedData(db: Db, caseId: number, values: Record<string, unknown>) {
  const { data, error } = await db
    .from("case_extracted_data")
    .upsert({ case_id: caseId, ...values, updated_at: new Date().toISOString() }, { onConflict: "case_id" })
    .select().single();
  if (error) throw error;
  return data;
}
