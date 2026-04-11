import { Link } from "wouter";
import { 
  BarChart, 
  Activity, 
  Clock, 
  FileText, 
  CheckCircle, 
  ArrowRight,
  TrendingUp,
  AlertTriangle
} from "lucide-react";
import { useGetDashboardStats, useGetRecentActivity, useGetStatusBreakdown, getGetDashboardStatsQueryKey, getGetRecentActivityQueryKey, getGetStatusBreakdownQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: breakdown, isLoading: breakdownLoading } = useGetStatusBreakdown({ query: { queryKey: getGetStatusBreakdownQueryKey() } });

  return (
    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your credit appraisal pipeline.</p>
        </div>
        <Link href="/cases/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
          <FileText className="mr-2 h-4 w-4" />
          New CAM Request
        </Link>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[120px] rounded-xl" />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Active Cases</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalCases}</div>
              <p className="text-xs text-muted-foreground mt-1">Across all RM portfolios</p>
            </CardContent>
          </Card>
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Drafts in Progress</CardTitle>
              <Activity className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.draftsInProgress}</div>
              <p className="text-xs text-muted-foreground mt-1">Actively being worked on</p>
            </CardContent>
          </Card>
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved This Month</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.approvedThisMonth}</div>
              <p className="text-xs text-muted-foreground mt-1">Successfully cleared</p>
            </CardContent>
          </Card>
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Time Saved</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.timeSavedHours}h</div>
              <p className="text-xs text-muted-foreground mt-1">Per memo vs manual drafting</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Recent Activity
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
                <div className="space-y-6">
                  {activity.map((item, index) => (
                    <div key={item.id} className="flex gap-4 relative">
                      {index !== activity.length - 1 && (
                        <div className="absolute top-8 bottom-[-24px] left-[11px] w-px bg-border" />
                      )}
                      <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-8 ring-card">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      <div className="flex flex-1 flex-col pb-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {item.borrowerName}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(item.timestamp)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <span className="font-medium text-foreground">{item.actor}</span> {item.action.toLowerCase()}
                          <Link href={`/cases/${item.caseId}`} className="inline-flex items-center gap-1 text-primary hover:underline ml-2">
                            View case <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="mx-auto h-8 w-8 opacity-20 mb-3" />
                  <p>No recent activity found.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart className="h-5 w-5 text-primary" />
                Status Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {breakdownLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : breakdown && breakdown.length > 0 ? (
                <div className="space-y-4">
                  {breakdown.map((item) => {
                    const total = breakdown.reduce((acc, curr) => acc + curr.count, 0);
                    const percentage = total > 0 ? Math.round((item.count / total) * 100) : 0;
                    
                    let colorClass = "bg-primary";
                    if (item.status === 'approved') colorClass = "bg-emerald-500";
                    if (item.status === 'in_review') colorClass = "bg-amber-500";
                    if (item.status === 'rejected') colorClass = "bg-red-500";
                    
                    return (
                      <div key={item.status} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{item.label}</span>
                          <span className="text-muted-foreground">{item.count} cases ({percentage}%)</span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${colorClass} transition-all duration-1000 ease-in-out`} 
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No data available.</p>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card className="bg-primary text-primary-foreground border-primary-border">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-primary-foreground/10 rounded-lg shrink-0">
                  <TrendingUp className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">System Health</h3>
                  <p className="text-primary-foreground/80 text-sm mb-4">
                    CreditGuard AI models are operating at peak efficiency. Average generation time is currently 1m 45s.
                  </p>
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-400/10 w-fit px-2 py-1 rounded">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    All Systems Operational
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}