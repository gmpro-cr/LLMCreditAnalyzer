const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  in_review: { label: "Credit review", cls: "bg-accent text-accent-foreground" },
  approved: { label: "Approved", cls: "bg-ok-bg text-ok" },
  rejected: { label: "Returned", cls: "bg-risk-bg text-risk" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), cls: "bg-muted text-muted-foreground" };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label]));
