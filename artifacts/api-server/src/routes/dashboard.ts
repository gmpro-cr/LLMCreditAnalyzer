import { Router } from "express";
import { db } from "@workspace/db";
import { casesTable, activityLogTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";

const router = Router();

router.get("/stats", async (_req, res) => {
  const allCases = await db.select().from(casesTable);

  const totalCases = allCases.length;
  const draftsInProgress = allCases.filter((c) => c.status === "draft").length;
  const pendingReview = allCases.filter((c) => c.status === "in_review").length;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const approvedThisMonth = allCases.filter(
    (c) => c.status === "approved" && new Date(c.updatedAt) >= startOfMonth
  ).length;

  const avgDraftTimeHours = 2.3;
  const timeSavedHours = totalCases * 6.2;

  res.json({
    totalCases,
    draftsInProgress,
    pendingReview,
    approvedThisMonth,
    avgDraftTimeHours,
    timeSavedHours,
  });
});

router.get("/recent-activity", async (_req, res) => {
  const activity = await db
    .select()
    .from(activityLogTable)
    .orderBy(sql`${activityLogTable.timestamp} desc`)
    .limit(20);

  res.json(
    activity.map((a) => ({
      ...a,
      timestamp: a.timestamp.toISOString(),
    }))
  );
});

router.get("/status-breakdown", async (_req, res) => {
  const rows = await db
    .select({
      status: casesTable.status,
      count: count(),
    })
    .from(casesTable)
    .groupBy(casesTable.status);

  const labels: Record<string, string> = {
    draft: "Draft",
    in_review: "In Review",
    approved: "Approved",
    rejected: "Rejected",
  };

  res.json(
    rows.map((r) => ({
      status: r.status,
      count: Number(r.count),
      label: labels[r.status] ?? r.status,
    }))
  );
});

export default router;
