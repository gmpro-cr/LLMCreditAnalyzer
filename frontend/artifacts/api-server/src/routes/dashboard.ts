import { Router } from "express";
import { supabase, insertActivity } from "../lib/supabase-db.js";

const router = Router();

// These handlers used to destructure only `{ data }` and fall back to `?? []`,
// so a database outage produced a confident HTTP 200 reading "0 cases,
// 0 hours saved" instead of an error. A wrong number is worse than a visible
// failure, so every query now propagates its error — Express 5 forwards the
// rejection to the global handler, which maps an unreachable database to a
// 503 `database_unavailable`.

router.get("/stats", async (_req, res) => {
  const { data: allCases, error } = await supabase.from("cases").select("status, updated_at");
  if (error) throw error;
  const cases = allCases ?? [];
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  res.json({
    totalCases: cases.length,
    draftsInProgress: cases.filter((c) => c.status === "draft").length,
    pendingReview: cases.filter((c) => c.status === "in_review").length,
    approvedThisMonth: cases.filter((c) => c.status === "approved" && new Date(c.updated_at) >= startOfMonth).length,
    avgDraftTimeHours: 2.3,
    timeSavedHours: cases.length * 6.2,
  });
});

router.get("/recent-activity", async (_req, res) => {
  const { data, error } = await supabase.from("activity_log").select("*").order("timestamp", { ascending: false }).limit(20);
  if (error) throw error;
  res.json(data ?? []);
});

router.get("/status-breakdown", async (_req, res) => {
  const { data: cases, error } = await supabase.from("cases").select("status");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const c of cases ?? []) counts[c.status] = (counts[c.status] || 0) + 1;

  const labels: Record<string, string> = { draft: "Draft", in_review: "In Review", approved: "Approved", rejected: "Rejected" };
  res.json(Object.entries(counts).map(([status, count]) => ({ status, count, label: labels[status] ?? status })));
});

export default router;
