import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";

// Dashboard is the first authed route — keep it eager so it paints immediately.
import Dashboard from "@/pages/dashboard";

// Heavy/secondary routes are code-split so they don't bloat the initial bundle
// (react-markdown, charts, data-room, bank-statement load on demand). This
// shrinks the JS the dashboard needs on first load.
const CasesList = lazy(() => import("@/pages/cases/index"));
const NewCase = lazy(() => import("@/pages/cases/new"));
const CaseDetail = lazy(() => import("@/pages/cases/[id]/index"));
const CaseRisks = lazy(() => import("@/pages/cases/[id]/risks"));
const BankStatement = lazy(() => import("@/pages/bank-statement"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function RouteFallback() {
  return (
    <div className="p-8 space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[120px] w-full rounded-xl" />
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  );
}

function Router() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route><Redirect to="/" /></Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login"><Redirect to="/" /></Route>
      <Route>
        <AppLayout>
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/cases" component={CasesList} />
              <Route path="/cases/new" component={NewCase} />
              <Route path="/cases/:id" component={CaseDetail} />
              <Route path="/cases/:id/risks" component={CaseRisks} />
              <Route path="/bank-statement" component={BankStatement} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </AppLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
