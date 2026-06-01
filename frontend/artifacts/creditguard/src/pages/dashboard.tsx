import { useLocation, Link } from "wouter";
import {
  PiFileTextLight,
  PiPulseLight,
  PiCheckCircleLight,
  PiClockCountdownLight,
  PiArrowRightLight,
  PiPlusLight,
} from "react-icons/pi";
import { useGetDashboardStats, useGetRecentActivity, getGetDashboardStatsQueryKey, getGetRecentActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });

  return (
    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground mt-1.5 text-sm font-light">Overview of your credit appraisal pipeline.</p>
        </div>
        <Button
          onClick={() => setLocation("/cases/new")}
          className="transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          <PiPlusLight className="mr-2 h-4 w-4" />
          New CAM Request
        </Button>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[100px] rounded-xl" />
          <Skeleton className="h-[100px] rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Featured top row: Active Cases + Drafts */}
          <Card
            className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
            onClick={() => setLocation("/cases")}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="p-2 rounded-lg bg-primary/8 text-primary">
                  <PiFileTextLight className="h-5 w-5" />
                </div>
                <PiArrowRightLight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
              <div className="text-[2.25rem] font-semibold tabular-nums leading-none tracking-tight">
                {stats?.totalCases ?? 0}
              </div>
              <div className="mt-2 text-sm font-medium text-foreground/80">Total active cases</div>
              <div className="text-xs text-muted-foreground mt-0.5">Across all RM portfolios</div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group border-blue-500/20 bg-blue-500/[0.03]"
            onClick={() => setLocation("/cases?status=draft")}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                  <PiPulseLight className="h-5 w-5" />
                </div>
                <PiArrowRightLight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
              <div className="text-[2.25rem] font-semibold tabular-nums leading-none tracking-tight text-blue-600">
                {stats?.draftsInProgress ?? 0}
              </div>
              <div className="mt-2 text-sm font-medium text-foreground/80">Drafts in progress</div>
              <div className="text-xs text-muted-foreground mt-0.5">Actively being worked on</div>
            </CardContent>
          </Card>

          {/* Supporting row: Approved + Time saved — smaller */}
          <Card
            className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group border-emerald-500/20 bg-emerald-500/[0.03]"
            onClick={() => setLocation("/cases?status=approved")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <PiCheckCircleLight className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Approved this month</span>
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-emerald-600">
                    {stats?.approvedThisMonth ?? 0}
                  </div>
                </div>
                <PiArrowRightLight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group border-amber-500/20 bg-amber-500/[0.02]"
            onClick={() => setLocation("/cases")}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <PiClockCountdownLight className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg time saved</span>
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-amber-600">
                    {stats?.timeSavedHours ?? 0}
                    <span className="text-base font-medium ml-0.5">h</span>
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground/50 text-right leading-snug max-w-[80px]">per memo vs manual</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <PiPulseLight className="h-4.5 w-4.5 text-primary" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activity && activity.length > 0 ? (
            <div className="space-y-5">
              {activity.map((item, index) => (
                <div key={item.id} className="flex gap-4 relative">
                  {index !== activity.length - 1 && (
                    <div className="absolute top-7 bottom-[-20px] left-[11px] w-px bg-border/60" />
                  )}
                  <div className="relative z-10 flex h-5.5 w-5.5 shrink-0 mt-0.5 items-center justify-center rounded-full bg-primary/8 ring-[6px] ring-card">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                  </div>
                  <div className="flex flex-1 flex-col pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{item.borrowerName}</p>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                        {formatDateTime(item.timestamp)}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className="font-medium text-foreground/80">{item.actor}</span>
                      <span>{item.action.toLowerCase()}</span>
                      {(() => {
                        const caseId = item.caseId ?? (item as any).case_id;
                        return caseId ? (
                          <Link
                            href={`/cases/${caseId}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 ml-1 text-xs"
                          >
                            View case <PiArrowRightLight className="h-3 w-3" />
                          </Link>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center">
                <PiPulseLight className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/70">No recent activity</p>
                <p className="text-xs text-muted-foreground mt-0.5">Activity will appear here as cases are worked on.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
