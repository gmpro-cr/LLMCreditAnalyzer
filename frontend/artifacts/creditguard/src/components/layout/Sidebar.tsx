import { Link, useLocation } from "wouter";
import {
  PiHouseSimpleLight,
  PiFolderSimpleLight,
  PiPlusCircleLight,
  PiReceiptLight,
  PiSignOutLight,
} from "react-icons/pi";
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

function CreditGuardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 22" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 1L2 4.5v6C2 15.25 5.6 19.7 10 21c4.4-1.3 8-5.75 8-10.5v-6L10 1z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7 11.5l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();

  const navigation = [
    { name: "Dashboard", href: "/", icon: PiHouseSimpleLight, match: (l: string) => l === "/" },
    { name: "Cases", href: "/cases", icon: PiFolderSimpleLight, match: (l: string) => l.startsWith("/cases") && !l.endsWith("/new") },
    { name: "New CAM", href: "/cases/new", icon: PiPlusCircleLight, match: (l: string) => l === "/cases/new" },
    { name: "Bank Statement", href: "/bank-statement", icon: PiReceiptLight, match: (l: string) => l.startsWith("/bank-statement") },
  ];

  const handleSignOut = () => {
    signOut();
    setLocation("/login", { replace: true });
  };

  const initials = user?.initials ?? "RM";
  const displayName = user?.name ?? "Relationship Manager";
  const displayEmail = user?.email ?? "Demo workspace";

  return (
    <div className="flex h-screen w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-16 shrink-0 items-center px-5 border-b border-sidebar-border/30">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <CreditGuardMark className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="font-semibold text-[15px] tracking-[-0.02em]">CreditGuard AI</span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-2 py-4">
        <nav className="space-y-0.5">
          {navigation.map((item) => {
            const isActive = item.match(location);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`relative flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all duration-150 ${
                  isActive
                    ? "text-sidebar-foreground bg-sidebar-accent/60 font-medium"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground/90 hover:bg-sidebar-accent/30 font-normal"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-emerald-400" />
                )}
                <item.icon
                  className={`h-[18px] w-[18px] shrink-0 transition-colors ${isActive ? "text-emerald-400" : ""}`}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-sidebar-border/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-sidebar-accent/40 transition-colors text-left">
              <div
                className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 font-semibold text-[11px] tracking-wide shrink-0 border border-emerald-500/20"
              >
                {initials}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate leading-snug">{displayName}</span>
                <span className="text-[11px] text-sidebar-foreground/45 truncate">{displayEmail}</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <span className="text-sm font-medium truncate">{displayName}</span>
                <span className="text-xs text-muted-foreground truncate">{displayEmail}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
              <PiSignOutLight className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
