import { Router } from "express";
import { supabase, insertActivity } from "../lib/supabase-db.js";

const router = Router();

router.get("/stats", async (_req, res) => {
  const { data: allCases } = await supabase.from("cases").select("status, updated_at");
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
  const { data } = await supabase.from("activity_log").select("*").order("timestamp", { ascending: false }).limit(20);
  res.json(data ?? []);
});

router.get("/status-breakdown", async (_req, res) => {
  const { data: cases } = await supabase.from("cases").select("status");
  const counts: Record<string, number> = {};
  for (const c of cases ?? []) counts[c.status] = (counts[c.status] || 0) + 1;

  const labels: Record<string, string> = { draft: "Draft", in_review: "In Review", approved: "Approved", rejected: "Rejected" };
  res.json(Object.entries(counts).map(([status, count]) => ({ status, count, label: labels[status] ?? status })));
});

export default router;
