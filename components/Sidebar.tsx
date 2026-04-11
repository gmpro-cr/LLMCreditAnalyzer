'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Shield, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Portfolio overview' },
  { href: '/borrowers', label: 'Borrowers', icon: Users, desc: 'Manage borrowers' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-lg bg-sidebar-primary">
            <Shield className="h-5 w-5 text-sidebar-primary-foreground" strokeWidth={2} />
          </div>
          <div>
            <p className="font-semibold text-sidebar-foreground text-[13px] leading-tight tracking-tight">
              CreditGuard AI
            </p>
            <p className="text-[10px] leading-tight mt-0.5 text-sidebar-foreground/70">
              SME Credit Monitoring
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] px-3 mb-3 select-none text-sidebar-foreground/50">
          Navigation
        </p>

        <div className="space-y-0.5">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] transition-all duration-150 relative text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                )}
              >
                {/* Active left bar */}
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full w-[3px] h-[22px] bg-sidebar-primary" />
                )}
                <item.icon className="h-4 w-4 shrink-0 transition-colors" />
                <span className="flex-1">{item.label}</span>
                {active && (
                  <ChevronRight className="h-3.5 w-3.5 opacity-40 shrink-0" />
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/50">
            Build
          </span>
          <span className="text-[9px] font-mono text-sidebar-foreground/60">
            v1.0.0
          </span>
        </div>
        <p className="text-[10px] text-sidebar-foreground/50">
          Confidential · Internal use only
        </p>
      </div>
    </aside>
  )
}
