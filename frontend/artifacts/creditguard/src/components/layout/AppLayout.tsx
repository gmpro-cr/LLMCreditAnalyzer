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
      <header className="on-ink sticky top-0 z-40 shadow-[0_1px_0_hsl(209_32%_22%)]">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-4 sm:px-8">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-muted md:hidden"
          >
            <PiListLight className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em] text-foreground">
            <CreditGuardMark className="h-5 w-5 text-[hsl(195_70%_62%)]" />
            CreditGuard
          </Link>
          <nav className="hidden h-full items-center gap-1 text-[13px] md:flex" aria-label="Main">
            {NAVIGATION.map((item) => {
              const active = item.match(location);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 transition-colors hover:no-underline ${active ? "bg-white/10 font-medium text-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="chip hidden bg-white/[0.07] text-muted-foreground sm:inline-flex">
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
