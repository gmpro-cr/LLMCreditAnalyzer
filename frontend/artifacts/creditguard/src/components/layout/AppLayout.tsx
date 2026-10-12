import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { PiListLight } from "react-icons/pi";
import { Sidebar, AccountMenu, CreditGuardMark, NAVIGATION } from "./Sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-4 sm:px-8">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded text-foreground/70 transition-colors hover:bg-muted md:hidden"
          >
            <PiListLight className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em] text-foreground">
            <CreditGuardMark className="h-5 w-5 text-primary" />
            CreditGuard
          </Link>
          <nav className="hidden h-full items-stretch gap-6 text-[13px] md:flex" aria-label="Main">
            {NAVIGATION.map((item) => {
              const active = item.match(location);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center border-b-2 transition-colors ${active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden rounded-[3px] border border-border px-2 py-0.5 text-xs text-muted-foreground sm:inline">
              Demo workspace
            </span>
            <AccountMenu />
          </div>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      <main id="main" className="flex-1">{children}</main>
    </div>
  );
}
