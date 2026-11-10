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
import { formatCr, formatCrValue, formatDate, formatDateTime, facilityLabel } from "@/lib/format";
import { PageHeader, PageBody } from "@/components/layout/PageHeader";

// Stats are real counts only (see api-server routes/dashboard.ts).
type Stats = {
  totalCases: number;
  draftsInProgress: number;
  pendingReview: number;
  approvedThisMonth: number;
  rejected?: number;
  proposedExposureCr?: number;
};

/** One stage of the appraisal flow, set on the ink band. */
function Stage({ label, value, note, href, last, branch }: { label: string; value: number | null; note: string; href: string; last?: boolean; branch?: boolean }) {
  return (
    <li className={`relative min-w-0 flex-1 ${branch ? "lg:ml-4 lg:max-w-[260px] lg:border-l lg:border-border lg:pl-4" : ""}`}>
      <Link href={href} className="group block rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06] hover:no-underline sm:px-4">
        <div className="flex items-baseline gap-3">
          <span className={`font-serif text-[40px] font-semibold leading-none tabular-nums tracking-[-0.02em] sm:text-[48px] ${value ? "text-foreground" : "text-foreground/45"}`}>
            {value === null ? <Skeleton className="inline-block h-10 w-10 bg-white/10" /> : value}
          </span>
          {!last && (
            <svg viewBox="0 0 48 12" className="hidden h-3 min-w-0 flex-1 text-white/25 lg:block" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 6h46" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
            </svg>
          )}
        </div>
        <div className="mt-2 text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{note}</div>
      </Link>
    </li>
  );
}

const activityTone = (action: string) =>
  /fail|error|returned|rejected/i.test(action) ? "bg-risk" : /complet|approved|drafted/i.test(action) ? "bg-ok" : "bg-[hsl(213_14%_72%)]";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const statsQ = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const activityQ = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const casesQ = useListCases({}, { query: { queryKey: getListCasesQueryKey({}) } });

  const stats = statsQ.data as Stats | undefined;
  const statsDown = isDataUnavailable(statsQ.isError, statsQ.isLoading, statsQ.data);
  const activityDown = isDataUnavailable(activityQ.isError, activityQ.isLoading, activityQ.data);
  const casesDown = isDataUnavailable(casesQ.isError, casesQ.isLoading, casesQ.data);

  const all = casesQ.data ?? [];
  const open = all
    .filter((c) => c.status === "draft" || c.status === "in_review" || c.status === "rejected")
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
    .slice(0, 8);

  // Exposure concentration: proposed facility amount by borrower, largest first.
  const ranked = [...all].filter((c) => Number(c.facilityAmount) > 0).sort((a, b) => Number(b.facilityAmount) - Number(a.facilityAmount));
  const totalRupees = ranked.reduce((t, c) => t + Number(c.facilityAmount), 0);
  const top = ranked.slice(0, 5);
  const restCases = ranked.slice(5);
  const restRupees = restCases.reduce((t, c) => t + Number(c.facilityAmount), 0);
  const maxRupees = top[0] ? Number(top[0].facilityAmount) : 0;
  const share = (r: number) => (totalRupees ? Math.round((r / totalRupees) * 100) : 0);

  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const n = (v: number | undefined) => (statsQ.isLoading || !stats ? null : v ?? 0);

  return (
    <>
      <PageHeader title="Pipeline" subtitle={today} actions={<Button onClick={() => setLocation("/cases/new")}>New case</Button>}>
        {statsDown ? (
          <p className="mt-6 text-sm text-muted-foreground" role="status">
            The stage counts can't be loaded right now. Your cases are safe.{" "}
            <button type="button" className="font-medium text-foreground underline" onClick={() => statsQ.refetch()}>Try again</button>
          </p>
        ) : (
          <ol className="mt-6 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border pt-3 lg:flex lg:gap-0" aria-label="Cases by stage">
            <Stage label="Drafts with RMs" note="Being prepared" value={n(stats?.draftsInProgress)} href="/cases?status=draft" />
            <Stage label="In credit review" note="Awaiting a credit officer" value={n(stats?.pendingReview)} href="/cases?status=in_review" />
            <Stage label="Approved this month" note="Ready for sanction" value={n(stats?.approvedThisMonth)} href="/cases?status=approved" last />
            <Stage label="Returned to RM" note="Needs rework" value={n(stats?.rejected)} href="/cases?status=rejected" last branch />
          </ol>
        )}
      </PageHeader>

      <PageBody className="flex flex-wrap items-start gap-6">
        <section className="panel min-w-0 flex-[999_1_620px]">
          <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
            <h2 className="font-sans text-[15px] font-semibold tracking-normal">Open cases</h2>
            <Link href="/cases" className="text-[13px] font-medium">All cases</Link>
          </div>
          {casesDown ? (
            <div className="p-6"><OutageState description="Your cases are safe — we can't load them right now." onRetry={() => casesQ.refetch()} isRetrying={casesQ.isFetching} compact /></div>
          ) : casesQ.isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : open.length ? (
            <div className="overflow-x-auto">
              <table className="ledger w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left sm:px-5">Borrower</th>
                    <th className="hidden px-4 py-2 text-left md:table-cell">Facility</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-left"><span className="sr-only sm:not-sr-only">Status</span></th>
                    <th className="hidden px-4 py-2 text-left md:table-cell">Sections reviewed</th>
                    <th className="hidden px-5 py-2 text-left md:table-cell">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-t border-border/60" onClick={() => setLocation(`/cases/${c.id}`)}>
                      <td className="px-4 py-3 sm:px-5">
                        <Link href={`/cases/${c.id}`} className="font-medium text-foreground hover:text-primary">{c.borrowerName}</Link>
                        <div className="text-xs text-muted-foreground">{c.sector} · RM {c.rmName}<span className="md:hidden"> · {facilityLabel(c.facilityType)}</span></div>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{facilityLabel(c.facilityType)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatCr(c.facilityAmount)}</td>
                      <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="bar-track w-20" role="img" aria-label={`${c.memoProgress}% of sections reviewed`}>
                            <div className="bar-fill" style={{ width: `${c.memoProgress}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{c.memoProgress}%</span>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-5 py-3 text-muted-foreground md:table-cell">{formatDate(c.updatedAt ?? c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <p className="font-serif text-lg font-semibold">No open cases</p>
              <p className="mt-1 text-sm text-muted-foreground">Start a case to draft a credit appraisal memorandum.</p>
              <Button className="mt-4" size="sm" onClick={() => setLocation("/cases/new")}>New case</Button>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-6 lg:max-w-[420px]">
          <section className="panel px-5 pb-5 pt-4" aria-labelledby="exposure-h">
            <h2 id="exposure-h" className="font-sans text-[15px] font-semibold tracking-normal">Proposed exposure</h2>
            {casesDown || statsDown ? (
              <p className="mt-3 text-sm text-muted-foreground">Exposure can't be loaded right now.</p>
            ) : casesQ.isLoading || statsQ.isLoading ? (
              <Skeleton className="mt-3 h-40" />
            ) : (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-serif text-[34px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                    {stats?.proposedExposureCr != null ? formatCrValue(stats.proposedExposureCr) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">across {stats?.totalCases ?? 0} case{stats?.totalCases === 1 ? "" : "s"}</span>
                </div>
                {top.length > 0 && (
                  <ul className="mt-5 space-y-3" aria-label="Exposure by borrower, largest first">
                    {top.map((c) => (
                      <li key={c.id} title={`${c.borrowerName}: ${formatCr(c.facilityAmount)} (${share(Number(c.facilityAmount))}% of proposed exposure)`}>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <Link href={`/cases/${c.id}`} className="truncate text-foreground hover:text-primary">{c.borrowerName}</Link>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            <span className="font-medium text-foreground">{formatCr(c.facilityAmount, 0)}</span> · {share(Number(c.facilityAmount))}%
                          </span>
                        </div>
                        <div className="bar-track mt-1.5 h-1.5">
                          <div className="bar-fill" style={{ width: `${Math.max(1.5, (Number(c.facilityAmount) / maxRupees) * 100)}%` }} />
                        </div>
                      </li>
                    ))}
                    {restCases.length > 0 && (
                      <li className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-3 text-[13px] text-muted-foreground">
                        <span>{restCases.length} more case{restCases.length === 1 ? "" : "s"}</span>
                        <span className="tabular-nums">{formatCr(restRupees, 0)} · {share(restRupees)}%</span>
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <div className="px-5 pb-2 pt-4">
              <h2 className="font-sans text-[15px] font-semibold tracking-normal">Recent activity</h2>
            </div>
            {activityDown ? (
              <div className="p-6"><OutageState description="Activity is safe — we can't load it right now." onRetry={() => activityQ.refetch()} isRetrying={activityQ.isFetching} compact /></div>
            ) : activityQ.isLoading ? (
              <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
            ) : activityQ.data?.length ? (
              <ol className="relative px-5 pb-4">
                <span aria-hidden="true" className="absolute bottom-6 left-[23.5px] top-3 w-px bg-border" />
                {activityQ.data.slice(0, 8).map((item) => {
                  const raw = item as unknown as { case_id?: number; borrower_name?: string };
                  const caseId = item.caseId ?? raw.case_id;
                  const name = item.borrowerName ?? raw.borrower_name;
                  return (
                    <li key={item.id} className="relative py-2 pl-6 text-[13px]">
                      <span aria-hidden="true" className={`absolute left-0 top-[14px] h-2 w-2 rounded-full ring-4 ring-card ${activityTone(item.action)}`} />
                      <div className="flex items-baseline justify-between gap-3">
                        {caseId ? <Link href={`/cases/${caseId}`} className="truncate font-medium text-foreground hover:text-primary">{name}</Link> : <span className="truncate font-medium">{name}</span>}
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatDateTime(item.timestamp)}</span>
                      </div>
                      <div className="text-muted-foreground">{item.action}{item.actor && item.actor !== "CreditGuard AI" ? ` · ${item.actor}` : ""}</div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="px-5 pb-8 pt-4 text-center text-sm text-muted-foreground">Activity appears here as cases are worked on.</p>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
