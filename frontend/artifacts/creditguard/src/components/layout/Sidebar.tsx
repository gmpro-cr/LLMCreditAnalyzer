import { Link, useLocation } from "wouter";
import { PiSignOutLight } from "react-icons/pi";
import { useAuth } from "@/hooks/use-auth";
import { signOut } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CreditGuardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 13V7m4 6V9m4 4V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export const NAVIGATION = [
  { name: "Pipeline", href: "/", match: (l: string) => l === "/" },
  { name: "Cases", href: "/cases", match: (l: string) => l.startsWith("/cases") },
  { name: "Bank statements", href: "/bank-statement", match: (l: string) => l.startsWith("/bank-statement") },
];

/** Account menu shared by the desktop top bar and the mobile menu. */
export function AccountMenu() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const initials = user?.initials ?? "RM";
  const displayName = user?.name ?? "Relationship manager";
  const displayEmail = user?.email ?? "Demo workspace";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Account: ${displayName}`}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-accent text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{displayEmail}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => { signOut(); setLocation("/", { replace: true }); }}
          className="text-destructive focus:text-destructive"
        >
          <PiSignOutLight className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile navigation list (rendered inside the sheet). */
export function Sidebar() {
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-1 p-4" aria-label="Main">
      <div className="mb-4 flex items-center gap-2.5 px-2 font-semibold tracking-[-0.01em]">
        <CreditGuardMark className="h-5 w-5 text-primary" /> CreditGuard
      </div>
      {NAVIGATION.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          className={`rounded px-3 py-2.5 text-sm transition-colors ${item.match(location) ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          {item.name}
        </Link>
      ))}
    </nav>
  );
}
