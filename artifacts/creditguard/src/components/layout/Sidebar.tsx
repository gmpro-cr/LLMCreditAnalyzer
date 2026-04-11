import { Link, useLocation } from "wouter";
import { 
  BarChart3, 
  Files, 
  PlusCircle,
  LayoutDashboard,
  LogOut,
  Settings,
  Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Cases", href: "/cases", icon: Files },
    { name: "New CAM", href: "/cases/new", icon: PlusCircle },
  ];

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-sidebar-border/50">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <BarChart3 className="h-6 w-6 text-emerald-500" />
          <span>CreditGuard AI</span>
        </div>
      </div>
      
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
        <div className="space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className={`h-5 w-5 ${isActive ? "text-emerald-500" : ""}`} />
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-sidebar-border/50 space-y-4">
        <div className="flex items-center justify-between text-sidebar-foreground/70 px-2">
          <button className="hover:text-white transition-colors">
            <Bell className="h-5 w-5" />
          </button>
          <button className="hover:text-white transition-colors">
            <Settings className="h-5 w-5" />
          </button>
          <button className="hover:text-white transition-colors">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 px-2">
          <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-xs">
            JD
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">John Doe</span>
            <span className="text-xs text-sidebar-foreground/50">Relationship Manager</span>
          </div>
        </div>
      </div>
    </div>
  );
}
