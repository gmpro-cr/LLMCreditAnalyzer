import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { PiListLight } from "react-icons/pi";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [location]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-60 border-sidebar-border p-0 [&>button]:text-sidebar-foreground/70"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      <main className="flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-muted active:scale-95"
          >
            <PiListLight className="h-5 w-5" />
          </button>
          <span className="font-semibold text-sm tracking-[-0.02em]">CreditGuard AI</span>
        </header>

        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
