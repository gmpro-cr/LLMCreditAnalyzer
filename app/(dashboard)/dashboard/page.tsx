import { createServerSupabaseClient } from '@/lib/supabase-server'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  Building2, FileText, ShieldAlert, Plus, TrendingUp,
  ArrowRight, AlertTriangle, Activity, ChevronRight
} from 'lucide-react'
import type { Borrower, Covenant } from '@/types'
import DashboardBorrowersTable from './DashboardBorrowersTable'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: borrowers }, { data: uploads }, { data: covenants }] = await Promise.all([
    supabase.from('borrowers').select('*').order('created_at', { ascending: false }),
    supabase.from('financial_uploads').select('id, status, financial_year, borrower_id').eq('status', 'complete'),
    supabase.from('covenants').select('*'),
  ])

  const borrowerList = (borrowers as Borrower[]) ?? []
  const covenantList = (covenants as Covenant[]) ?? []
  const breachedCovenants = covenantList.filter(c => c.is_breached)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memoCount = (uploads as any[])?.filter((u: any) => u.status === 'complete').length ?? 0

  const stats = [
    {
      label: 'Total Borrowers',
      value: borrowerList.length,
      icon: Building2,
      accent: 'text-blue-600',
      bgIcon: 'bg-blue-50',
      colorIcon: 'text-blue-600',
      border: 'stat-card-blue',
      sub: 'in portfolio',
    },
    {
      label: 'Covenant Breaches',
      value: breachedCovenants.length,
      icon: AlertTriangle,
      accent: breachedCovenants.length > 0 ? 'text-red-600' : 'text-green-600',
      bgIcon: breachedCovenants.length > 0 ? 'bg-red-50' : 'bg-green-50',
      colorIcon: breachedCovenants.length > 0 ? 'text-red-600' : 'text-green-600',
      border: breachedCovenants.length > 0 ? 'stat-card-red' : 'stat-card-green',
      sub: breachedCovenants.length > 0 ? 'needs attention' : 'all clear',
    },
    {
      label: 'CAM Reports',
      value: memoCount,
      icon: FileText,
      accent: 'text-yellow-600',
      bgIcon: 'bg-yellow-50',
      colorIcon: 'text-yellow-600',
      border: 'stat-card-gold',
      sub: 'generated',
    },
    {
      label: 'Active Covenants',
      value: covenantList.length,
      icon: ShieldAlert,
      accent: 'text-teal-600',
      bgIcon: 'bg-teal-50',
      colorIcon: 'text-teal-600',
      border: 'stat-card-green',
      sub: 'monitored',
    },
  ]

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-8 cg-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide uppercase">{today}</p>
          <h1 className="font-display text-3xl font-semibold text-foreground leading-tight">
            Portfolio Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Credit monitoring · SME portfolio
          </p>
        </div>
        <Button
          asChild
          className="shadow-sm bg-slate-900 text-white hover:bg-slate-800"
        >
          <Link href="/borrowers/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Borrower
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 cg-fade-up cg-delay-1">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`bg-card rounded-xl p-5 border border-border shadow-sm ${s.border} transition-shadow hover:shadow-md`}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className={`p-2.5 rounded-lg ${s.bgIcon}`}
              >
                <s.icon className={`h-4.5 w-4.5 ${s.colorIcon}`} />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {s.sub}
              </span>
            </div>
            <p className={`text-3xl font-display font-semibold ${s.accent}`}>
              {s.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Breach alert */}
      {breachedCovenants.length > 0 && (
        <div
          className="rounded-xl border p-4 flex items-center justify-between cg-scale-in bg-red-50 border-red-200"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="font-semibold text-red-900 text-sm">
                {breachedCovenants.length} covenant {breachedCovenants.length > 1 ? 'breaches' : 'breach'} detected
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                Immediate review required — click to see affected borrowers
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-red-300 text-red-700 hover:bg-red-100 hover:border-red-400 font-medium text-xs shrink-0"
          >
            <Link href="/borrowers">
              View Details
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      )}

      {/* Borrowers table */}
      <DashboardBorrowersTable
        borrowerList={borrowerList}
        covenantList={covenantList}
      />
    </div>
  )
}
