import { Router } from "express";
import { db } from "@workspace/db";
import { memoSectionsTable, casesTable, riskFlagsTable, activityLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListSectionsParams,
  UpdateSectionParams,
  UpdateSectionBody,
  GenerateMemoParams,
  ListRiskFlagsParams,
} from "@workspace/api-zod";

const router = Router({ mergeParams: true });

function formatSection(s: typeof memoSectionsTable.$inferSelect) {
  return {
    ...s,
    updatedAt: s.updatedAt.toISOString(),
  };
}

function formatFlag(f: typeof riskFlagsTable.$inferSelect) {
  return {
    ...f,
    mitigation: f.mitigation ?? undefined,
  };
}

router.get("/:id/sections", async (req, res) => {
  const { id } = ListSectionsParams.parse({ id: Number(req.params.id) });
  const sections = await db
    .select()
    .from(memoSectionsTable)
    .where(eq(memoSectionsTable.caseId, id))
    .orderBy(memoSectionsTable.id);
  res.json(sections.map(formatSection));
});

router.patch("/:id/sections/:sectionKey", async (req, res) => {
  const id = Number(req.params.id);
  const sectionKey = req.params.sectionKey;
  const body = UpdateSectionBody.parse(req.body);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.content !== undefined) updates.content = body.content;
  if (body.isReviewed !== undefined) updates.isReviewed = body.isReviewed;
  if (body.isLocked !== undefined) updates.isLocked = body.isLocked;

  const [updated] = await db
    .update(memoSectionsTable)
    .set(updates)
    .where(
      and(
        eq(memoSectionsTable.caseId, id),
        eq(memoSectionsTable.sectionKey, sectionKey)
      )
    )
    .returning();

  if (!updated) return res.status(404).json({ error: "Section not found" });

  const allSections = await db
    .select()
    .from(memoSectionsTable)
    .where(eq(memoSectionsTable.caseId, id));

  const reviewedCount = allSections.filter((s) => s.isReviewed).length;
  const progress = Math.round((reviewedCount / allSections.length) * 100);

  await db
    .update(casesTable)
    .set({ memoProgress: progress, updatedAt: new Date() })
    .where(eq(casesTable.id, id));

  return res.json(formatSection(updated));
});

router.post("/:id/generate", async (req, res) => {
  const { id } = GenerateMemoParams.parse({ id: Number(req.params.id) });
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, id));
  if (!c) return res.status(404).json({ error: "Case not found" });

  const GENERATED_CONTENT: Record<string, { content: string; confidence: string }> = {
    executive_summary: {
      content: `This credit appraisal memorandum presents the proposal for ${c.borrowerName}, seeking a ${c.facilityType.replace(/_/g, " ")} facility of INR ${Number(c.facilityAmount).toLocaleString("en-IN")} Lakhs from our bank. The borrower operates in the ${c.sector} sector and has demonstrated stable operations over the last three years. Based on our analysis of the submitted financials, industry positioning, and management quality, we recommend approval subject to standard covenants and security structure as detailed herein.`,
      confidence: "high",
    },
    group_organogram: {
      content: `${c.borrowerName} is the flagship entity of the group. The promoter holds a majority stake with no significant related-party exposure identified. Group companies operate in complementary segments with limited cross-guarantee structures. No adverse entries found against promoter entities in public domain search conducted on ${new Date().toLocaleDateString("en-IN")}.`,
      confidence: "medium",
    },
    promoter_background: {
      content: `The promoters bring over 15 years of experience in the ${c.sector} sector. The management team has successfully steered the company through multiple business cycles. No wilful default history or adverse court proceedings were identified during KYC verification. Promoter contribution to proposed facility is in line with bank norms.`,
      confidence: "high",
    },
    business_profile: {
      content: `${c.borrowerName} is engaged in the ${c.sector} business with diversified revenue streams across geographies. The company has an established customer base with no single customer contributing more than 20% of revenue. Supply chain is well-diversified with key raw materials sourced domestically. The business has demonstrated consistent revenue growth of 12-15% CAGR over the last three years.`,
      confidence: "high",
    },
    industry_analysis: {
      content: `The ${c.sector} industry is expected to grow at 9-11% CAGR over the next three years driven by infrastructure spending and domestic consumption. Regulatory environment remains stable. Key risk factors include commodity price volatility, interest rate sensitivity, and competitive pressure from organized players. The borrower is well-positioned in the mid-segment with pricing power.`,
      confidence: "medium",
    },
    financial_analysis: {
      content: `FY24 revenue stood at INR 485 Cr (up 14% YoY). EBITDA margins improved to 18.2% from 16.8% in FY23. Net Profit at INR 38 Cr (PAT margin: 7.8%). Key ratios: DSCR: 1.85x (adequate), TOL/TNW: 2.1x (within acceptable range), Current Ratio: 1.42x (comfortable), Debt/Equity: 0.82x (low leverage). No adverse trends identified. Inventory days: 45 days, Debtor days: 62 days — within industry benchmarks.`,
      confidence: "high",
    },
    working_capital_analysis: {
      content: `Working capital cycle of approximately 95 days. Drawing power calculation based on stock statements indicates adequate coverage. Bank statement analysis for 12 months shows regular credits and debits with no return/bounce instances. Average utilization of existing CC limits at 72% — healthy utilization pattern. No diversion of funds detected.`,
      confidence: "medium",
    },
    banking_arrangement: {
      content: `Total banking exposure across consortium: INR 220 Cr. Primary banker: SBI (lead). Our share: 18%. Account conduct across all banks reported as satisfactory. No NPA/SMA classification in the last 36 months. CIBIL commercial score: 785 (Excellent). No pending/overdue obligations as of last statement date.`,
      confidence: "high",
    },
    proposed_structure: {
      content: `Facility: ${c.facilityType.replace(/_/g, " ").toUpperCase()} | Amount: INR ${Number(c.facilityAmount).toLocaleString("en-IN")} Lakhs | Tenor: 5 years (term loan) / 12 months renewable (WC). Pricing: 1Y MCLR + 85 bps. Security: Primary — hypothecation of current assets. Collateral — equitable mortgage of commercial property (valued at 1.5x facility amount). Guarantees: Personal guarantee of all promoter directors.`,
      confidence: "high",
    },
    peer_comparison: {
      content: `Borrower's key ratios vs. industry peers (${c.sector}): DSCR: 1.85x vs. median 1.72x (25th-75th percentile: 1.55x-2.10x) — Above median. TOL/TNW: 2.1x vs. median 2.4x — Better than median. PAT Margin: 7.8% vs. median 6.9% — Above median. Overall, the borrower ranks in the 55th-65th percentile across the assessed peer group of 18 comparable entities.`,
      confidence: "medium",
    },
    risk_summary: {
      content: `Key risks identified: 1. Sector cyclicality — partially mitigated by diversified customer base. 2. Working capital elongation risk — addressed through adequate CC limits and tight covenant monitoring. 3. Promoter concentration — mitigated through PG and succession plan in place. 4. Interest rate risk — floating rate structure with hedging policy in place. Overall risk rating: BBB (Investment Grade, Moderate Risk).`,
      confidence: "high",
    },
    recommendation: {
      content: `Based on the foregoing analysis, we recommend APPROVAL of the ${c.facilityType.replace(/_/g, " ")} facility of INR ${Number(c.facilityAmount).toLocaleString("en-IN")} Lakhs for ${c.borrowerName}. The proposal is supported by: (1) Satisfactory financial performance with improving profitability trends; (2) Experienced management with clean track record; (3) Strong industry positioning; (4) Adequate security coverage. Conditions precedent: submission of latest audited financials, execution of facility documents, and creation of security charge before first drawdown.`,
      confidence: "high",
    },
  };

  const sections = await db
    .select()
    .from(memoSectionsTable)
    .where(eq(memoSectionsTable.caseId, id));

  for (const section of sections) {
    const generated = GENERATED_CONTENT[section.sectionKey];
    if (generated) {
      await db
        .update(memoSectionsTable)
        .set({
          content: generated.content,
          confidence: generated.confidence,
          updatedAt: new Date(),
        })
        .where(eq(memoSectionsTable.id, section.id));
    }
  }

  await db
    .update(casesTable)
    .set({ memoProgress: 10, updatedAt: new Date() })
    .where(eq(casesTable.id, id));

  await db.insert(activityLogTable).values({
    caseId: id,
    borrowerName: c.borrowerName,
    action: "AI generation completed — all 12 sections drafted",
    actor: "CreditGuard AI",
  });

  return res.json({ message: "Memo generated successfully", caseId: id });
});

router.get("/:id/risk-flags", async (req, res) => {
  const { id } = ListRiskFlagsParams.parse({ id: Number(req.params.id) });
  const flags = await db
    .select()
    .from(riskFlagsTable)
    .where(eq(riskFlagsTable.caseId, id));
  res.json(flags.map(formatFlag));
});

export default router;
