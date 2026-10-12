import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCase,
  useListRiskFlags,
  useUpdateRiskFlag,
  getGetCaseQueryKey,
  getListRiskFlagsQueryKey,
  getCaseWorkspaceQueryKey,
  RiskFlag,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { OutageState } from "@/components/outage-state";
import { isDataUnavailable } from "@/lib/query-state";
import { useToast } from "@/hooks/use-toast";
import { caseRef } from "@/lib/format";

const SEVERITY: Record<string, { label: string; cls: string; order: number }> = {
  high: { label: "High", cls: "border-risk/25 bg-risk-bg text-risk", order: 0 },
  medium: { label: "Medium", cls: "border-warn/25 bg-warn-bg text-warn", order: 1 },
  low: { label: "Low", cls: "border-border bg-muted text-muted-foreground", order: 2 },
};

function FlagRow({ caseId, flag }: { caseId: number; flag: RiskFlag & { mitigation?: string | null } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateRiskFlag();
  const [note, setNote] = useState(flag.mitigation ?? "");
  const sev = SEVERITY[flag.severity] ?? SEVERITY.low;
  const acknowledged = !!flag.isAcknowledged;

  const submit = async (isAcknowledged: boolean) => {
    if (isAcknowledged && !note.trim()) {
      toast({ title: "Add the mitigation before acknowledging", description: "Record how the risk is addressed — it goes into the case's audit trail.", variant: "destructive" });
      return;
    }
    try {
      await update.mutateAsync({ caseId, flagId: flag.id, isAcknowledged, mitigation: note.trim() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListRiskFlagsQueryKey(caseId) }),
        queryClient.invalidateQueries({ queryKey: getCaseWorkspaceQueryKey(caseId) }),
      ]);
      toast({ title: isAcknowledged ? "Risk acknowledged" : "Risk reopened" });
    } catch {
      toast({ title: "Could not save. Please try again.", variant: "destructive" });
    }
  };

  return (
    <article className="rounded border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <span className={`inline-flex rounded-[3px] border px-1.5 py-px text-xs ${sev.cls}`}>{sev.label}</span>
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">{flag.riskType}</h2>
        <span className={`ml-auto text-xs ${acknowledged ? "text-ok" : "text-warn"}`}>{acknowledged ? "Acknowledged" : "Open"}</span>
      </div>
      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Finding</div>
          <p className="mt-1 text-sm leading-relaxed">{flag.description}</p>
        </div>
        <div>
          <label htmlFor={`mit-${flag.id}`} className="text-xs text-muted-foreground">Mitigation</label>
          {acknowledged ? (
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{flag.mitigation || "—"}</p>
          ) : (
            <Textarea
              id={`mit-${flag.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How is this risk addressed? e.g. quarterly inventory ageing as a covenant; stock audit before disbursement."
              className="mt-1 min-h-[88px] text-sm"
            />
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        {acknowledged ? (
          <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={update.isPending}>Reopen</Button>
        ) : (
          <Button size="sm" onClick={() => submit(true)} disabled={update.isPending}>Acknowledge with mitigation</Button>
        )}
      </div>
    </article>
  );
}

export default function CaseRisks() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { data: caseData } = useGetCase(id, { query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) } });
  const { data: riskFlags, isLoading, isError, refetch, isFetching } =
    useListRiskFlags(id, { query: { enabled: !!id, queryKey: getListRiskFlagsQueryKey(id) } });

  const flags = [...(riskFlags ?? [])].sort((a, b) => (SEVERITY[a.severity]?.order ?? 3) - (SEVERITY[b.severity]?.order ?? 3));
  const open = flags.filter((f) => !f.isAcknowledged).length;

  return (
    <div>
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8">
          <div className="text-xs text-muted-foreground">
            <Link href="/cases" className="text-muted-foreground hover:text-foreground">Cases</Link>
            <span className="mx-1.5">/</span>
            <Link href={`/cases/${id}`} className="text-muted-foreground hover:text-foreground">{caseData ? caseRef(caseData.id, caseData.createdAt) : "Case"}</Link>
            <span className="mx-1.5">/</span>Risk flags
          </div>
          <div className="mt-1.5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[32px] leading-tight">Risk flags</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {caseData?.borrowerName ?? ""}{flags.length ? ` · ${flags.length} flag${flags.length === 1 ? "" : "s"}, ${open} open` : ""}.
                {" "}Flags are computed from the financial ratios; each needs a recorded mitigation before credit review.
              </p>
            </div>
            <Button variant="outline" asChild><Link href={`/cases/${id}`}>Back to memorandum</Link></Button>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-8 sm:px-8">
        {isLoading ? (
          <><Skeleton className="h-48" /><Skeleton className="h-48" /></>
        ) : isDataUnavailable(isError, isLoading, riskFlags) ? (
          // A failed read must never look like a clean risk profile.
          <OutageState
            title="Can't load risk flags"
            description="We can't reach the service, so we can't confirm this case's risk profile. Don't treat this as an all-clear."
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : flags.length ? (
          flags.map((f) => <FlagRow key={f.id} caseId={id} flag={f} />)
        ) : (
          <div className="rounded border border-border bg-card px-8 py-14 text-center">
            <p className="text-sm font-medium">No ratio-based risk flags</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              None of the computed ratios crossed a risk threshold. This is not a full credit assessment — review the Key risks section of the memorandum.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
