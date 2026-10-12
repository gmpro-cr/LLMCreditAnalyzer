import { useLocation, Link } from "wouter";
import {
  useGetDashboardStats,
  useGetRecentActivity,
  useListCases,
  getGetDashboardStatsQueryKey,
  getGetRecentActivityQueryKey,
  getListCasesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { OutageState } from "@/components/outage-state";
import { isDataUnavailable } from "@/lib/query-state";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/status";
import { formatCr, formatDate, formatDateTime, facilityLabel } from "@/lib/format";

// Stats are real counts only (see api-server routes/dashboard.ts).
type Stats = {
  totalCases: number;
  draftsInProgress: number;
  pendingReview: number;
  approvedThisMonth: number;
  rejected?: number;
  proposedExposureCr?: number;
};

function Figure({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.01em] text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </>
  );
  const cls = "block border-b border-border px-5 py-4 transition-colors sm:border-r lg:border-b-0 lg:last:border-r-0";
  return href
    ? <Link href={href} className={`${cls} text-foreground hover:bg-muted/60 hover:no-underline`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const statsQ = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const activityQ = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const casesQ = useListCases({}, { query: { queryKey: getListCasesQueryKey({}) } });

  const stats = statsQ.data as Stats | undefined;
  const statsDown = isDataUnavailable(statsQ.isError, statsQ.isLoading, statsQ.data);
  const activityDown = isDataUnavailable(activityQ.isError, activityQ.isLoading, activityQ.data);
  const casesDown = isDataUnavailable(casesQ.isError, casesQ.isLoading, casesQ.data);

  const open = (casesQ.data ?? [])
    .filter((c) => c.status === "draft" || c.status === "in_review" || c.status === "rejected")
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
    .slice(0, 8);

  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] leading-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">{today}</p>
        </div>
        <Button onClick={() => setLocation("/cases/new")}>New case</Button>
      </div>

      {statsDown ? (
        <OutageState description="The figures are safe — we can't load them right now. This usually clears in a few minutes." onRetry={() => statsQ.refetch()} isRetrying={statsQ.isFetching} compact />
      ) : (
        <div className="grid grid-cols-1 rounded border border-border bg-card sm:grid-cols-2 lg:grid-cols-5">
          {statsQ.isLoading || !stats ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="p-5"><Skeleton className="h-14" /></div>) : (
            <>
              <Figure label="Drafts with RMs" value={String(stats.draftsInProgress)} note="Being prepared" href="/cases?status=draft" />
              <Figure label="In credit review" value={String(stats.pendingReview)} note="Awaiting a credit officer" href="/cases?status=in_review" />
              <Figure label="Approved this month" value={String(stats.approvedThisMonth)} note="Ready for sanction" href="/cases?status=approved" />
              <Figure label="Returned to RM" value={String(stats.rejected ?? 0)} note="Needs rework" href="/cases?status=rejected" />
              <Figure label="Proposed exposure" value={stats.proposedExposureCr != null ? `₹${stats.proposedExposureCr.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr` : "—"} note={`Across ${stats.totalCases} case${stats.totalCases === 1 ? "" : "s"}`} />
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <section className="min-w-0 flex-[999_1_620px] rounded border border-border bg-card">
          <div className="flex items-baseline justify-between border-b border-border px-5 py-3.5">
            <h2 className="font-sans text-[15px] font-semibold tracking-normal">Open cases</h2>
            <Link href="/cases" className="text-[13px]">All cases</Link>
          </div>
          {casesDown ? (
            <div className="p-6"><OutageState description="Your cases are safe — we can't load them right now." onRetry={() => casesQ.refetch()} isRetrying={casesQ.isFetching} compact /></div>
          ) : casesQ.isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : open.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Borrower</th>
                    <th className="px-4 py-2 text-left font-medium">Facility</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Reviewed</th>
                    <th className="px-5 py-2 text-left font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-t border-border/70 hover:bg-muted/60" onClick={() => setLocation(`/cases/${c.id}`)}>
                      <td className="px-5 py-3">
                        <Link href={`/cases/${c.id}`} className="font-medium text-foreground hover:text-primary">{c.borrowerName}</Link>
                        <div className="text-xs text-muted-foreground">{c.sector} · RM {c.rmName}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{facilityLabel(c.facilityType)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatCr(c.facilityAmount)}</td>
                      <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">{c.memoProgress}%</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(c.updatedAt ?? c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium">No open cases</p>
              <p className="mt-1 text-sm text-muted-foreground">Start a case to draft a credit appraisal memorandum.</p>
              <Button className="mt-4" size="sm" onClick={() => setLocation("/cases/new")}>New case</Button>
            </div>
          )}
        </section>

        <section className="min-w-0 flex-[1_1_340px] rounded border border-border bg-card lg:max-w-[420px]">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="font-sans text-[15px] font-semibold tracking-normal">Recent activity</h2>
          </div>
          {activityDown ? (
            <div className="p-6"><OutageState description="Activity is safe — we can't load it right now." onRetry={() => activityQ.refetch()} isRetrying={activityQ.isFetching} compact /></div>
          ) : activityQ.isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : activityQ.data?.length ? (
            <ul className="divide-y divide-border/70">
              {activityQ.data.slice(0, 10).map((item) => {
                const raw = item as unknown as { case_id?: number; borrower_name?: string };
                const caseId = item.caseId ?? raw.case_id;
                const name = item.borrowerName ?? raw.borrower_name;
                return (
                  <li key={item.id} className="px-5 py-2.5 text-[13px]">
                    <div className="flex items-baseline justify-between gap-3">
                      {caseId ? <Link href={`/cases/${caseId}`} className="truncate font-medium text-foreground hover:text-primary">{name}</Link> : <span className="truncate font-medium">{name}</span>}
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatDateTime(item.timestamp)}</span>
                    </div>
                    <div className="text-muted-foreground">{item.action}{item.actor && item.actor !== "CreditGuard AI" ? ` · ${item.actor}` : ""}</div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Activity appears here as cases are worked on.</p>
          )}
        </section>
      </div>
    </div>
  );
}
