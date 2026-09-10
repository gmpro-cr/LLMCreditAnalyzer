"""Early Warning Signal (EWS) monitoring checklist. No LLM, no I/O.

RBI's EWS framework requires lenders to track a standard set of account-conduct
indicators post-sanction (overdrawing, statement delays, fund diversion, etc.).
None of this is knowable at appraisal time from financial statements — it depends
on live account behaviour the RM observes after disbursement. So this is a static,
publicly-known checklist scaffold, not LLM-narrated: there is nothing
company-specific to say yet, and nothing here should ever be hallucinated per-company.
Trigger Status and Action Point are deliberately left for the RM to fill in during
ongoing monitoring.
"""

STANDARD_EWS_PARAMETERS = [
    {"label": "Stock/debtor statement delay",
     "description": "Delay in submission of stock or debtor statements beyond 30 days from the due date."},
    {"label": "Frequent overdrawing",
     "description": "Frequent overdrawing of cash credit/overdraft limits, or overdue beyond sanctioned limit."},
    {"label": "Cheque bounces",
     "description": "Bouncing of cheques issued by the borrower for reasons other than technical errors."},
    {"label": "Adverse regulatory action",
     "description": "Raid, search, or adverse action by Income Tax, GST, or other enforcement authorities."},
    {"label": "Adverse market report",
     "description": "Adverse market reports or rumours about the company's or promoters' financial position."},
    {"label": "Frequent management/auditor changes",
     "description": "Frequent changes in management, key managerial personnel, or statutory auditors."},
    {"label": "Fund diversion",
     "description": "Diversion of funds for purposes other than the approved end-use of the facility."},
    {"label": "Deteriorating debtor/creditor ratios",
     "description": "Significant deterioration in debtor or creditor days, or net working capital, versus prior periods."},
    {"label": "Promoter shareholding decline/pledge",
     "description": "Reduction in promoter shareholding, or an increase in pledged promoter shares."},
    {"label": "Non-cooperation with inspection",
     "description": "Non-cooperation by the borrower in stock audits, inspections, or statutory audits."},
    {"label": "Statutory dues delay",
     "description": "Delay in payment of statutory dues such as PF, ESI, or GST beyond the due date."},
]


def format_ews_checklist_md() -> str:
    """Render the standard EWS parameter checklist as a markdown table for the CAM."""
    lines = [
        "## Early Warning Signal (EWS) Monitoring Checklist",
        "",
        "_Standard parameters per RBI's EWS framework. Trigger status is unknown at "
        "appraisal time — RM to monitor and update post-sanction._",
        "",
        "| Parameter | Description | Trigger Status | Action Point |",
        "|---|---|---|---|",
    ]
    for p in STANDARD_EWS_PARAMETERS:
        lines.append(f"| {p['label']} | {p['description']} | To be monitored | — |")
    return "\n".join(lines)
