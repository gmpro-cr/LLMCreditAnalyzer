// Canonical CAM section list (detailed CAM, engine cam_v2.SECTIONS). One list for
// case creation, generation, display order and PDF export, so they can't drift.
export const MEMO_SECTIONS: { key: string; title: string }[] = [
  { key: "executive_summary", title: "Executive Summary" },
  { key: "proposed_structure", title: "Proposal & Facility Structure" },
  { key: "business_profile", title: "Company & Business Profile" },
  { key: "group_organogram", title: "Group Structure" },
  { key: "promoter_background", title: "Shareholding, Board & Management" },
  { key: "industry_analysis", title: "Industry Outlook" },
  { key: "financial_analysis", title: "Financial Analysis — Summary" },
  { key: "sales_profitability", title: "Revenue & Profitability" },
  { key: "leverage_debt", title: "Leverage, Debt Profile & Debt Servicing" },
  { key: "working_capital_analysis", title: "Liquidity & Working Capital" },
  { key: "interim_performance", title: "Interim Performance" },
  { key: "facility_assessment", title: "Assessment of Facilities & Sensitivity" },
  { key: "banking_arrangement", title: "Banking Arrangement & Credit Ratings" },
  { key: "contingent_rpt", title: "Contingent Liabilities, Related Parties & Audit" },
  { key: "peer_comparison", title: "Peer Comparison" },
  { key: "due_diligence", title: "Due Diligence & Hygiene Checks" },
  { key: "risk_summary", title: "Key Risks & Mitigants" },
  { key: "recommendation", title: "Recommendation, Terms & Covenants" },
  { key: "ews_checklist", title: "EWS Checklist" },
  { key: "reference_check", title: "Reference Check" },
  { key: "information_required", title: "Information Required from RM" },
];

const ORDER = new Map(MEMO_SECTIONS.map((s, i) => [s.key, i]));

/** Canonical display order; sections created before a key was added sort by it too. */
export function sortSections<T extends { section_key: string; id?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (ORDER.get(a.section_key) ?? 999) - (ORDER.get(b.section_key) ?? 999) || (a.id ?? 0) - (b.id ?? 0));
}

export function blankSectionRows(caseId: number, keys?: string[]) {
  return MEMO_SECTIONS.filter((s) => !keys || keys.includes(s.key)).map((s) => ({
    case_id: caseId,
    section_key: s.key,
    section_title: s.title,
    content: "",
    confidence: "pending",
    is_reviewed: false,
    is_locked: false,
  }));
}
