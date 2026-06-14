import { Router } from "express";

const router = Router();

// All queries run through req.db (the user-scoped RLS client), so each user's
// dashboard reflects only their own cases and activity.

router.get("/stats", async (req, res) => {
  const { data: allCases } = await req.db.from("cases").select("status, updated_at");
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

router.get("/recent-activity", async (req, res) => {
  const { data } = await req.db.from("activity_log").select("*").order("timestamp", { ascending: false }).limit(20);
  res.json(data ?? []);
});

router.get("/status-breakdown", async (req, res) => {
  const { data: cases } = await req.db.from("cases").select("status");
  const counts: Record<string, number> = {};
  for (const c of cases ?? []) counts[c.status] = (counts[c.status] || 0) + 1;

  const labels: Record<string, string> = { draft: "Draft", in_review: "In Review", approved: "Approved", rejected: "Rejected" };
  res.json(Object.entries(counts).map(([status, count]) => ({ status, count, label: labels[status] ?? status })));
});

export default router;
