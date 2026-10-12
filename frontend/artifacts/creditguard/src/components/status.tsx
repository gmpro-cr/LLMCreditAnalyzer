const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-border bg-muted text-muted-foreground" },
  in_review: { label: "Credit review", cls: "border-primary/25 bg-accent text-accent-foreground" },
  approved: { label: "Approved", cls: "border-ok/25 bg-ok-bg text-ok" },
  rejected: { label: "Returned", cls: "border-risk/25 bg-risk-bg text-risk" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), cls: "border-border text-muted-foreground" };
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[3px] border px-1.5 py-px text-xs ${s.cls}`}>{s.label}</span>;
}

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label]));
