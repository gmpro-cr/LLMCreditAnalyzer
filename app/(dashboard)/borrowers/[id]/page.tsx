import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import { ArrowLeft, Upload, Settings, FileText, Calendar, TrendingUp, ChevronRight, TrendingDown, BarChart3, Users, RefreshCw, Search, ExternalLink } from 'lucide-react'
import type { Borrower, FinancialUpload, Covenant, RatioData } from '@/types'
import { RATIO_LABELS, RATIO_BENCHMARKS } from '@/types'
import AutoAnalyzeButton from './AutoAnalyzeButton'
import RunResearchButton from './RunResearchButton'
import DeleteBorrowerButton from './DeleteBorrowerButton'

// ── Helpers ────────────────────────────────────────────────────────────────

function getRatioStatus(key: string, value: number): 'green' | 'amber' | 'red' {
  const bench = RATIO_BENCHMARKS[key]
  if (!bench) return 'green'
  if (bench.higherIsBetter) {
    if (value >= bench.high) return 'green'
    if (value >= bench.low) return 'amber'
    return 'red'
  } else {
    if (value <= bench.low) return 'green'
    if (value <= bench.high) return 'amber'
    return 'red'
  }
}

const RATIO_STYLES = {
  green: { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803D', dot: '#22C55E', val: '#166534' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', dot: '#F59E0B', val: '#78350F' },
  red:   { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', dot: '#EF4444', val: '#7F1D1D' },
}

function RatioCard({ label, value, ratioKey }: { label: string; value: number; ratioKey: string }) {
  const status = getRatioStatus(ratioKey, value)
  const s = RATIO_STYLES[status]
  return (
    <div className="rounded-xl p-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      <div className="flex items-start justify-between gap-1 mb-2">
        <p className="text-[11px] font-medium leading-tight" style={{ color: s.text }}>{label}</p>
        <span className="h-2 w-2 rounded-full shrink-0 mt-0.5" style={{ background: s.dot }} />
      </div>
      <p className="text-2xl font-bold font-display" style={{ color: s.val }}>{value.toFixed(2)}</p>
    </div>
  )
}

const RATIO_GROUPS = [
  { label: 'Liquidity', keys: ['current_ratio', 'quick_ratio', 'cash_ratio'] },
  { label: 'Leverage & Coverage', keys: ['debt_equity', 'tol_tnw', 'debt_to_assets', 'interest_coverage', 'dscr'] },
  { label: 'Profitability', keys: ['ebitda_margin', 'operating_margin', 'net_margin', 'roe', 'roa', 'roce'] },
  { label: 'Efficiency', keys: ['asset_turnover', 'inventory_days', 'debtor_days', 'creditor_days', 'operating_cycle', 'cash_conversion_cycle'] },
]

function fmt(n: number | undefined | null): string {
  if (n == null || n === 0) return '—'
  return `₹${n.toLocaleString('en-IN')} Cr`
}

const OPERATOR_LABELS: Record<string, string> = {
  gte: '≥', lte: '≤', gt: '>', lt: '<',
}

// ── Section header component ───────────────────────────────────────────────
function SectionHeader({ title, unit }: { title: string; unit?: string }) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4"
      style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
    >
      <span className="font-semibold text-foreground text-sm">{title}</span>
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}

// ── KPI tile ───────────────────────────────────────────────────────────────
function KpiTile({
  label, value, accent = false
}: {
  label: string; value: string; accent?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: accent ? 'oklch(0.97 0.010 248)' : 'oklch(0.978 0.006 78)',
        border: `1px solid ${accent ? 'oklch(0.88 0.015 248)' : 'oklch(0.895 0.010 78)'}`,
      }}
    >
      <p className="text-[11px] text-muted-foreground mb-1.5 font-medium">{label}</p>
      <p className="text-lg font-bold font-display text-foreground">{value}</p>
    </div>
  )
}

// ── Credit Signal Score ─────────────────────────────────────────────────────
function computeCreditSignal(ratios: RatioData | null): { score: number; band: 'Strong' | 'Adequate' | 'Weak' | 'Stressed'; color: string; bg: string; border: string } {
  if (!ratios) return { score: 0, band: 'Weak', color: '#92400E', bg: '#FFFBEB', border: '#FDE68A' }
  let score = 0; let total = 0
  const add = (val: number | undefined, low: number, high: number, hib = true) => {
    if (val == null) return
    total += 10
    const v = hib ? (val >= high ? 10 : val >= low ? 6 : 2) : (val <= low ? 10 : val <= high ? 6 : 2)
    score += v
  }
  add(ratios.current_ratio, 1.0, 1.33)
  add(ratios.debt_equity, 1.5, 2.0, false)
  add(ratios.interest_coverage, 1.5, 2.5)
  add(ratios.dscr, 1.0, 1.25)
  add(ratios.ebitda_margin, 8, 15)
  add(ratios.roe, 10, 15)
  const pct = total > 0 ? Math.round((score / total) * 10) : 0
  if (pct >= 8) return { score: pct, band: 'Strong',   color: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' }
  if (pct >= 6) return { score: pct, band: 'Adequate', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' }
  if (pct >= 4) return { score: pct, band: 'Weak',     color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA' }
  return         { score: pct, band: 'Stressed',color: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' }
}

// ── Public Intel Panel (listed companies only) ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PublicIntelPanel({ pub, ratios, borrowerId }: { pub: any; ratios: RatioData | null; borrowerId: string }) {
  if (!pub?.is_listed) return null
  const stock   = pub.stock   || {}
  const screener= pub.screener|| {}
  const peers   = pub.peers   || []
  const signal  = computeCreditSignal(ratios)
  const priceUp = (stock.change_pct ?? 0) >= 0

  return (
    <div className="space-y-4 cg-fade-up">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: '#0D1B2A' }}>
            <BarChart3 className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="font-semibold text-foreground text-sm">Public Intelligence</span>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'oklch(0.96 0.015 248)', border: '1px solid oklch(0.88 0.020 248)', color: 'oklch(0.40 0.060 248)' }}
          >
            {pub.symbol} · {stock.exchange || 'Listed'}
          </span>
        </div>
        <Link
          href={`/api/borrowers/${borrowerId}/public-data`}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Stock price card */}
        {stock.price && (
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <p className="text-[11px] text-muted-foreground font-medium mb-1">Stock Price</p>
            <p className="text-2xl font-bold font-display text-foreground">₹{stock.price.toFixed(2)}</p>
            <div className="flex items-center gap-1 mt-1">
              {priceUp
                ? <TrendingUp className="h-3 w-3 text-green-500" />
                : <TrendingDown className="h-3 w-3 text-red-500" />}
              <span className={`text-xs font-medium ${priceUp ? 'text-green-600' : 'text-red-600'}`}>
                {priceUp ? '+' : ''}{stock.change_pct?.toFixed(2)}%
              </span>
            </div>
            {stock.week_52_high && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                52W: ₹{stock.week_52_low} – ₹{stock.week_52_high}
              </p>
            )}
          </div>
        )}

        {/* Market cap */}
        {(stock.market_cap_cr || screener.market_cap_cr) && (
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <p className="text-[11px] text-muted-foreground font-medium mb-1">Market Cap</p>
            <p className="text-2xl font-bold font-display text-foreground">
              ₹{((stock.market_cap_cr || screener.market_cap_cr || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr
            </p>
            {stock.pe_ratio && (
              <p className="text-xs text-muted-foreground mt-1">P/E: {stock.pe_ratio.toFixed(1)}x</p>
            )}
          </div>
        )}

        {/* Credit signal */}
        {ratios && (
          <div className="rounded-xl p-4" style={{ background: signal.bg, border: `1px solid ${signal.border}` }}>
            <p className="text-[11px] font-medium mb-1" style={{ color: signal.color, opacity: 0.8 }}>Credit Signal</p>
            <p className="text-2xl font-bold font-display" style={{ color: signal.color }}>{signal.score}/10</p>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1.5 inline-block"
              style={{ background: signal.color + '18', color: signal.color }}
            >
              {signal.band}
            </span>
          </div>
        )}

        {/* Promoter holding */}
        {screener.promoter_holding != null && (
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <p className="text-[11px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
              <Users className="h-3 w-3" /> Promoter Holding
            </p>
            <p className="text-2xl font-bold font-display text-foreground">{screener.promoter_holding}%</p>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${screener.promoter_holding}%`,
                  background: screener.promoter_holding >= 50 ? '#15803D' : screener.promoter_holding >= 30 ? '#B45309' : '#B91C1C',
                }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {screener.promoter_holding >= 50 ? 'High — strong alignment' : screener.promoter_holding >= 30 ? 'Moderate' : 'Low — watch governance'}
            </p>
          </div>
        )}
      </div>

      {/* Peer comparison table */}
      {peers.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-3"
            style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
          >
            <span className="font-semibold text-foreground text-sm">Peer Comparison</span>
            <span className="text-xs text-muted-foreground">Screener.in</span>
          </div>
          <div className="overflow-x-auto">
            <table className="cg-table">
              <thead>
                <tr>
                  {Object.keys(peers[0]).slice(0, 6).map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {peers.map((peer: Record<string, string>, i: number) => (
                  <tr key={i}>
                    {Object.values(peer).slice(0, 6).map((v, j) => (
                      <td key={j} className={j === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
interface PageProps { params: Promise<{ id: string }> }

export default async function BorrowerDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const [{ data: borrower }, { data: uploads }, { data: covenants }] = await Promise.all([
    supabase.from('borrowers').select('*').eq('id', id).single(),
    supabase.from('financial_uploads').select('*').eq('borrower_id', id).order('financial_year', { ascending: false }),
    supabase.from('covenants').select('*').eq('borrower_id', id),
  ])

  if (!borrower) notFound()

  const b             = borrower as Borrower
  const uploadList    = (uploads as FinancialUpload[]) ?? []
  const covenantList  = (covenants as Covenant[]) ?? []
  const latestUpload  = uploadList.find(u => u.status === 'complete' && u.ratios)
  const ratios        = latestUpload?.ratios as RatioData | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin           = latestUpload?.extracted_data as any | null
  const memoUploads   = uploadList.filter(u => u.memo_content)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const research      = (fin as any)?._research as {
    brief?: string
    sources?: { title: string; url: string }[]
    queries_run?: string[]
    round_summaries?: string[]
    research_completeness_score?: number
    dimension_scores?: Record<string, number>
  } | null
  const hasResearch   = !!(research?.brief)
  const breaches      = covenantList.filter(c => c.is_breached)

  const initials   = b.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const hue        = (b.name.charCodeAt(0) * 19 + b.name.charCodeAt(1 % b.name.length) * 7) % 360
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicData = (b as any).public_data || null

  return (
    <div className="space-y-6 cg-fade-in">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
        <Link href="/borrowers">
          <ArrowLeft className="h-4 w-4 mr-1" /> Borrowers
        </Link>
      </Button>

      {/* Header card */}
      <div
        className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-scale-in"
      >
        <div
          className="px-7 py-6 flex items-start justify-between gap-4"
          style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
        >
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0 shadow-sm"
              style={{
                background: `hsl(${hue}, 22%, 91%)`,
                color: `hsl(${hue}, 38%, 32%)`,
              }}
            >
              {initials}
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold text-foreground leading-tight">{b.name}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {b.cin && (
                  <code
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md tracking-wide"
                    style={{ background: 'oklch(0.95 0.007 80)', border: '1px solid oklch(0.88 0.009 78)', color: 'oklch(0.45 0.030 248)' }}
                  >
                    {b.cin}
                  </code>
                )}
                {b.industry && (
                  <span
                    className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                    style={{ background: 'oklch(0.97 0.015 248)', border: '1px solid oklch(0.90 0.020 248)', color: 'oklch(0.40 0.050 248)' }}
                  >
                    {b.industry}
                  </span>
                )}
                {b.loan_type && (
                  <span
                    className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                    style={{ background: 'oklch(0.97 0.010 78)', border: '1px solid oklch(0.89 0.010 78)', color: 'oklch(0.42 0.030 248)' }}
                  >
                    {b.loan_type}
                  </span>
                )}
                {b.loan_amount != null && (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ background: 'oklch(0.96 0.012 72)', border: '1px solid oklch(0.88 0.016 72)', color: 'oklch(0.50 0.12 72)' }}
                  >
                    ₹{b.loan_amount} Cr
                  </span>
                )}
                {b.symbol && (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full font-mono"
                    style={{ background: '#0D1B2A', color: '#B8860B', border: '1px solid #2A3A4A' }}
                  >
                    {b.symbol}
                  </span>
                )}
                {breaches.length > 0 && (
                  <span className="badge-breach">
                    ⚠ {breaches.length} covenant breach{breaches.length > 1 ? 'es' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <DeleteBorrowerButton id={b.id} name={b.name} />
            <Button variant="outline" size="sm" asChild className="text-xs font-medium">
              <Link href={`/borrowers/${b.id}/covenants`}>
                <Settings className="h-3.5 w-3.5 mr-1.5" /> Covenants
              </Link>
            </Button>
            {b.symbol && <AutoAnalyzeButton borrowerId={b.id} symbol={b.symbol} />}
            <RunResearchButton borrowerId={b.id} />
            <Button
              size="sm"
              asChild
              className="text-xs font-medium"
              style={b.symbol ? { background: 'oklch(0.978 0.006 78)', color: 'oklch(0.25 0.03 248)', border: '1px solid var(--border)' } : { background: '#0D1B2A', color: '#fff' }}
            >
              <Link href={`/borrowers/${b.id}/upload`}>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload
              </Link>
            </Button>
          </div>
        </div>

        {/* Quick stats bar */}
        {latestUpload && (
          <div
            className="grid grid-cols-3 divide-x divide-border"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            {[
              { label: 'Latest FY', value: `FY ${latestUpload.financial_year}` },
              { label: 'Uploads', value: `${uploadList.length} statement${uploadList.length !== 1 ? 's' : ''}` },
              { label: 'Covenants', value: `${covenantList.length} active${breaches.length > 0 ? ` · ${breaches.length} breached` : ''}` },
            ].map(item => (
              <div key={item.label} className="px-6 py-3">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{item.label}</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Public Intelligence Panel — listed companies only */}
      {publicData?.is_listed && (
        <PublicIntelPanel pub={publicData} ratios={ratios} borrowerId={b.id} />
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-card border border-border rounded-xl p-1 gap-0.5 h-auto">
          {[
            { value: 'overview', label: 'Overview' },
            { value: 'financials', label: `Financials${uploadList.length > 0 ? ` (${uploadList.length})` : ''}` },
            { value: 'covenants', label: `Covenants${covenantList.length > 0 ? ` (${covenantList.length})` : ''}` },
            { value: 'memos', label: `Memos${memoUploads.length > 0 ? ` (${memoUploads.length})` : ''}` },
            { value: 'research', label: hasResearch ? 'Research ●' : 'Research' },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-lg text-xs font-medium px-4 py-2 data-[state=active]:bg-[#0D1B2A] data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="mt-4 space-y-5">
          {!ratios ? (
            <div className="bg-card rounded-xl border border-border shadow-sm text-center py-20">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-7 w-7 text-muted-foreground opacity-40" />
              </div>
              <p className="font-semibold text-foreground mb-1">No financial data yet</p>
              <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                Upload a financial statement to see ratios, balance sheet, and analysis.
              </p>
              <Button asChild style={{ background: '#0D1B2A', color: '#fff' }}>
                <Link href={`/borrowers/${b.id}/upload`}>
                  <Upload className="h-4 w-4 mr-2" /> Upload Financials
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Based on FY {latestUpload?.financial_year} data
              </p>

              {/* P&L Summary */}
              {fin?.profit_loss && (
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <SectionHeader title="P&L Summary" unit="₹ Crores" />
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Revenue from Operations', value: fin.profit_loss.revenue?.revenue_from_operations },
                        { label: 'Total Income', value: fin.profit_loss.revenue?.total_income },
                        { label: 'EBITDA', value: fin.profit_loss.profit_metrics?.ebitda, accent: true },
                        { label: 'Profit After Tax', value: fin.profit_loss.profit_metrics?.profit_after_tax, accent: true },
                      ].map(({ label, value, accent }) => (
                        <KpiTile key={label} label={label} value={fmt(value)} accent={accent} />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Finance Costs', value: fin.profit_loss.expenses?.finance_costs },
                        { label: 'Depreciation & Amortisation', value: fin.profit_loss.expenses?.depreciation_amortization },
                        { label: 'Tax Expense', value: fin.profit_loss.profit_metrics?.tax_expense },
                      ].map(({ label, value }) => (
                        <KpiTile key={label} label={label} value={fmt(value)} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Balance Sheet */}
              {fin?.balance_sheet && (() => {
                const bs  = fin.balance_sheet
                const ca  = bs.assets?.current_assets
                const nca = bs.assets?.non_current_assets
                const cl  = bs.liabilities?.current_liabilities
                const ncl = bs.liabilities?.non_current_liabilities
                const eq  = bs.equity

                const ROW_HEADER = {
                  background: 'oklch(0.960 0.009 78)',
                  fontWeight: 600,
                  fontSize: '10px',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.07em',
                  color: 'oklch(0.48 0.030 248)',
                }
                const ROW_TOTAL = {
                  background: 'oklch(0.975 0.006 78)',
                  fontWeight: 600,
                  fontSize: '12px',
                  color: 'oklch(0.22 0.040 248)',
                }
                const FOOTER_ROW = {
                  background: '#0D1B2A',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '12px',
                }

                const Row = ({ label, val, indent }: { label: string; val: number | undefined | null; indent?: boolean }) =>
                  val ? (
                    <tr style={{ borderBottom: '1px solid oklch(0.928 0.009 78)' }}>
                      <td style={{ padding: '6px 12px 6px ' + (indent ? '20px' : '12px'), color: 'oklch(0.42 0.025 248)', fontSize: 12 }}>{label}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 500, color: 'oklch(0.25 0.035 248)', fontSize: 12 }}>{fmt(val)}</td>
                    </tr>
                  ) : null

                return (
                  <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                    <SectionHeader
                      title={`Balance Sheet${bs.current_year ? ` — FY ${bs.current_year}` : ''}`}
                      unit="₹ Crores"
                    />
                    <div className="p-5">
                      {/* KPI row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                        <KpiTile label="Total Assets" value={fmt(bs.assets?.total_assets)} accent />
                        <KpiTile label="Net Worth" value={fmt(eq?.total_equity)} accent />
                        <KpiTile label="Total Debt" value={fmt((cl?.short_term_borrowings ?? 0) + (ncl?.long_term_borrowings ?? 0) + (cl?.current_portion_long_term_debt ?? 0))} />
                        <KpiTile label="Total Liabilities" value={fmt(bs.liabilities?.total_liabilities)} />
                      </div>

                      {/* Two-column detail */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Assets */}
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2 pl-1">Assets</p>
                          <div className="rounded-xl overflow-hidden border border-border">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                <tr><td colSpan={2} style={{ ...ROW_HEADER, padding: '7px 12px' }}>Non-Current Assets</td></tr>
                                <Row label="Property, Plant &amp; Equipment" val={nca?.property_plant_equipment} indent />
                                <Row label="Capital Work-in-Progress" val={nca?.capital_wip} indent />
                                <Row label="Intangible Assets" val={nca?.intangible_assets} indent />
                                <Row label="Investments" val={nca?.investments} indent />
                                <Row label="Other Non-Current Assets" val={nca?.other_non_current_assets} indent />
                                <tr style={{ ...ROW_TOTAL, borderBottom: '1px solid oklch(0.895 0.010 78)' }}>
                                  <td style={{ padding: '7px 12px' }}>Total Non-Current Assets</td>
                                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{fmt(nca?.total_non_current_assets)}</td>
                                </tr>

                                <tr><td colSpan={2} style={{ ...ROW_HEADER, padding: '7px 12px' }}>Current Assets</td></tr>
                                <Row label="Inventories" val={ca?.inventories?.total} indent />
                                <Row label="  — Raw Materials" val={ca?.inventories?.raw_materials} indent />
                                <Row label="  — Work-in-Progress" val={ca?.inventories?.work_in_progress} indent />
                                <Row label="  — Finished Goods" val={ca?.inventories?.finished_goods} indent />
                                <Row label="Trade Receivables" val={ca?.trade_receivables?.total} indent />
                                <Row label="  — Under 6 Months" val={ca?.trade_receivables?.less_than_6_months} indent />
                                <Row label="  — Over 6 Months" val={ca?.trade_receivables?.more_than_6_months} indent />
                                <Row label="Cash &amp; Bank Balances" val={ca?.cash_and_bank} indent />
                                <Row label="Bank Deposits" val={ca?.bank_deposits} indent />
                                <Row label="Loans &amp; Advances" val={ca?.loans_advances} indent />
                                <Row label="Other Current Assets" val={ca?.other_current_assets} indent />
                                <tr style={{ ...ROW_TOTAL, borderBottom: '1px solid oklch(0.895 0.010 78)' }}>
                                  <td style={{ padding: '7px 12px' }}>Total Current Assets</td>
                                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{fmt(ca?.total_current_assets)}</td>
                                </tr>

                                <tr style={{ ...FOOTER_ROW }}>
                                  <td style={{ padding: '9px 12px', letterSpacing: '0.04em' }}>TOTAL ASSETS</td>
                                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>{fmt(bs.assets?.total_assets)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Liabilities + Equity */}
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2 pl-1">Liabilities &amp; Equity</p>
                          <div className="rounded-xl overflow-hidden border border-border">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                <tr><td colSpan={2} style={{ ...ROW_HEADER, padding: '7px 12px' }}>Equity</td></tr>
                                <Row label="Share Capital" val={eq?.share_capital} indent />
                                <Row label="Reserves &amp; Surplus" val={eq?.reserves_surplus} indent />
                                <tr style={{ ...ROW_TOTAL, borderBottom: '1px solid oklch(0.895 0.010 78)' }}>
                                  <td style={{ padding: '7px 12px' }}>Total Equity (Net Worth)</td>
                                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{fmt(eq?.total_equity)}</td>
                                </tr>

                                <tr><td colSpan={2} style={{ ...ROW_HEADER, padding: '7px 12px' }}>Non-Current Liabilities</td></tr>
                                <Row label="Long-term Borrowings" val={ncl?.long_term_borrowings} indent />
                                <Row label="Deferred Tax Liability" val={ncl?.deferred_tax_liability} indent />
                                <Row label="Other Non-Current Liabilities" val={ncl?.other_non_current_liabilities} indent />
                                <tr style={{ ...ROW_TOTAL, borderBottom: '1px solid oklch(0.895 0.010 78)' }}>
                                  <td style={{ padding: '7px 12px' }}>Total Non-Current Liabilities</td>
                                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{fmt(ncl?.total_non_current_liabilities)}</td>
                                </tr>

                                <tr><td colSpan={2} style={{ ...ROW_HEADER, padding: '7px 12px' }}>Current Liabilities</td></tr>
                                <Row label="Short-term Borrowings" val={cl?.short_term_borrowings} indent />
                                <Row label="Trade Payables — MSME" val={cl?.trade_payables?.msme} indent />
                                <Row label="Trade Payables — Others" val={cl?.trade_payables?.others} indent />
                                <Row label="Trade Payables (Total)" val={cl?.trade_payables?.total} indent />
                                <Row label="Current Portion of LT Debt" val={cl?.current_portion_long_term_debt} indent />
                                <Row label="Other Current Liabilities" val={cl?.other_current_liabilities} indent />
                                <Row label="Provisions" val={cl?.provisions} indent />
                                <tr style={{ ...ROW_TOTAL, borderBottom: '1px solid oklch(0.895 0.010 78)' }}>
                                  <td style={{ padding: '7px 12px' }}>Total Current Liabilities</td>
                                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{fmt(cl?.total_current_liabilities)}</td>
                                </tr>

                                <tr style={{ ...FOOTER_ROW }}>
                                  <td style={{ padding: '9px 12px', letterSpacing: '0.04em' }}>TOTAL LIAB. + EQUITY</td>
                                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>{fmt((bs.liabilities?.total_liabilities ?? 0) + (eq?.total_equity ?? 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Ratios */}
              {RATIO_GROUPS.map(group => {
                const available = group.keys.filter(k => ratios[k] != null && ratios[k] !== 0)
                if (available.length === 0) return null
                return (
                  <div key={group.label} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                    <SectionHeader title={`${group.label} Ratios`} />
                    <div className="p-5">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {available.map(key => (
                          <RatioCard key={key} ratioKey={key} label={RATIO_LABELS[key] ?? key} value={ratios[key]!} />
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Cash Flow */}
              {fin?.cash_flow?.operating_activities?.net_cash_from_operating !== 0 && fin?.cash_flow && (
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <SectionHeader title="Cash Flow Summary" unit="₹ Crores" />
                  <div className="p-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Operating', value: fin.cash_flow.operating_activities?.net_cash_from_operating },
                        { label: 'Investing', value: fin.cash_flow.investing_activities?.net_cash_from_investing },
                        { label: 'Financing', value: fin.cash_flow.financing_activities?.net_cash_from_financing },
                        { label: 'Closing Cash', value: fin.cash_flow.closing_cash },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="rounded-xl p-4"
                          style={{
                            background: (value ?? 0) < 0 ? '#FEF2F2' : 'oklch(0.978 0.006 78)',
                            border: `1px solid ${(value ?? 0) < 0 ? '#FECACA' : 'oklch(0.895 0.010 78)'}`,
                          }}
                        >
                          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">{label}</p>
                          <p
                            className="text-lg font-bold font-display"
                            style={{ color: (value ?? 0) < 0 ? '#991B1B' : 'oklch(0.22 0.040 248)' }}
                          >
                            {value != null && value !== 0 ? `₹${value.toLocaleString('en-IN')} Cr` : '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── FINANCIALS ── */}
        <TabsContent value="financials" className="mt-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
            >
              <span className="font-semibold text-foreground text-sm">Financial Uploads</span>
              <Button size="sm" asChild style={{ background: '#0D1B2A', color: '#fff' }} className="text-xs font-medium">
                <Link href={`/borrowers/${b.id}/upload`}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload New
                </Link>
              </Button>
            </div>
            {uploadList.length === 0 ? (
              <div className="text-center py-14 text-muted-foreground">
                <p className="text-sm">No financial statements uploaded yet.</p>
              </div>
            ) : (
              <table className="cg-table">
                <thead>
                  <tr>
                    <th>Financial Year</th>
                    <th>Upload Date</th>
                    <th>Status</th>
                    <th style={{ width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {uploadList.map((upload, i) => (
                    <tr key={upload.id} className="cg-fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
                      <td>
                        <span className="font-semibold text-foreground">FY {upload.financial_year}</span>
                      </td>
                      <td className="text-muted-foreground text-xs">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3" />
                          {new Date(upload.upload_date).toLocaleDateString('en-IN')}
                        </div>
                      </td>
                      <td>
                        {upload.status === 'complete' && <span className="badge-ok">✓ Complete</span>}
                        {upload.status === 'processing' && (
                          <span className="badge-warn">⟳ Processing</span>
                        )}
                        {upload.status === 'failed' && <span className="badge-breach">✗ Failed</span>}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {upload.status === 'complete' && (
                            <Button
                              variant="outline" size="sm" asChild className="text-xs font-medium h-7"
                              style={{ background: 'oklch(0.97 0.015 248)', border: '1px solid oklch(0.90 0.020 248)', color: '#0D1B2A' }}
                            >
                              <Link href={`/borrowers/${b.id}/cam-note/${upload.id}`}>
                                ✎ Edit CAM
                              </Link>
                            </Button>
                          )}
                          {upload.memo_content && (
                            <Button variant="outline" size="sm" asChild className="text-xs font-medium h-7">
                              <Link href={`/borrowers/${b.id}/memos/${upload.id}`}>
                                <FileText className="h-3 w-3 mr-1" /> View Memo
                              </Link>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── COVENANTS ── */}
        <TabsContent value="covenants" className="mt-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
            >
              <span className="font-semibold text-foreground text-sm">Covenants</span>
              <Button variant="outline" size="sm" asChild className="text-xs font-medium">
                <Link href={`/borrowers/${b.id}/covenants`}>
                  <Settings className="h-3.5 w-3.5 mr-1.5" /> Manage
                </Link>
              </Button>
            </div>
            {covenantList.length === 0 ? (
              <div className="text-center py-14">
                <p className="text-sm text-muted-foreground mb-3">No covenants configured.</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/borrowers/${b.id}/covenants`}>Add Covenants</Link>
                </Button>
              </div>
            ) : (
              <table className="cg-table">
                <thead>
                  <tr>
                    <th>Ratio</th>
                    <th>Condition</th>
                    <th>Last Checked</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {covenantList.map(c => (
                    <tr key={c.id}>
                      <td className="font-semibold text-foreground text-[13px]">
                        {RATIO_LABELS[c.ratio_name] ?? c.ratio_name}
                      </td>
                      <td>
                        <code
                          className="text-xs px-2 py-0.5 rounded font-mono font-semibold"
                          style={{ background: 'oklch(0.95 0.007 80)', border: '1px solid oklch(0.88 0.009 78)' }}
                        >
                          {OPERATOR_LABELS[c.operator] ?? c.operator} {c.threshold}
                        </code>
                      </td>
                      <td className="text-muted-foreground text-xs">
                        {c.last_checked_at
                          ? new Date(c.last_checked_at).toLocaleDateString('en-IN')
                          : <span className="italic">Never</span>}
                      </td>
                      <td>
                        {!c.last_checked_at ? (
                          <span
                            className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                            style={{ background: 'oklch(0.95 0.007 80)', color: 'oklch(0.52 0.025 248)', border: '1px solid oklch(0.88 0.009 78)' }}
                          >Not checked</span>
                        ) : c.is_breached ? (
                          <span className="badge-breach">⚠ Breached</span>
                        ) : (
                          <span className="badge-ok">✓ OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── RESEARCH ── */}
        <TabsContent value="research" className="mt-4 space-y-4">
          {!hasResearch ? (
            <div className="bg-card rounded-xl border border-border shadow-sm text-center py-20">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <Search className="h-7 w-7 text-muted-foreground opacity-40" />
              </div>
              <p className="font-semibold text-foreground mb-1">No research data yet</p>
              <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                Run web research to auto-populate company background, industry context, management signals, and risk factors.
              </p>
              <RunResearchButton borrowerId={b.id} />
            </div>
          ) : (
            <>
              {/* Research brief — rendered as structured sections */}
              <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div
                  className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-muted">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <span className="font-semibold text-foreground text-sm">Research Brief</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {research?.research_completeness_score != null && (
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${research.research_completeness_score}%`,
                              background: research.research_completeness_score >= 75 ? '#16a34a'
                                : research.research_completeness_score >= 50 ? '#ca8a04' : '#dc2626',
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {research.research_completeness_score}%
                        </span>
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {research?.sources?.length ?? 0} sources · auto-generated
                    </span>
                  </div>
                </div>
                <div className="p-6">
                  {/* Render each ## section of the brief as a card */}
                  {research!.brief!.split(/\n(?=## )/).map((section, i) => {
                    const lines  = section.trim().split('\n')
                    const header = lines[0].replace(/^##\s*/, '').trim()
                    const body   = lines.slice(1).join('\n').trim()
                    if (!body) return null
                    return (
                      <div key={i} className={i > 0 ? 'mt-6 pt-6' : ''} style={i > 0 ? { borderTop: '1px solid var(--border)' } : {}}>
                        <h3 className="font-semibold text-foreground text-sm mb-2">{header}</h3>
                        {body.split('\n').map((line, j) => {
                          line = line.trim()
                          if (!line) return null
                          const isBullet = line.startsWith('- ') || line.startsWith('* ') || line.match(/^\d+\./)
                          return isBullet ? (
                            <div key={j} className="flex items-start gap-2 text-sm text-muted-foreground mb-1">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                              <span>{line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '')}</span>
                            </div>
                          ) : (
                            <p key={j} className="text-sm text-muted-foreground mb-1.5 leading-relaxed">{line}</p>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Dimension scores */}
              {research?.dimension_scores && Object.keys(research.dimension_scores).length > 0 && (
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}>
                    <span className="font-semibold text-foreground text-sm">Coverage by Dimension</span>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(research.dimension_scores).map(([dim, score]) => {
                      const color = score >= 75 ? '#16a34a' : score >= 50 ? '#ca8a04' : '#dc2626'
                      const bg    = score >= 75 ? '#f0fdf4' : score >= 50 ? '#fefce8' : '#fef2f2'
                      const label = dim.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                      return (
                        <div key={dim} className="rounded-lg p-3" style={{ background: bg, border: `1px solid ${color}22` }}>
                          <p className="text-[10px] font-medium mb-1.5" style={{ color }}>{label}</p>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 flex-1 rounded-full bg-white/60 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
                            </div>
                            <span className="text-[11px] font-bold shrink-0" style={{ color }}>{score}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Sources */}
              {(research!.sources?.length ?? 0) > 0 && (
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div
                    className="px-6 py-4"
                    style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
                  >
                    <span className="font-semibold text-foreground text-sm">
                      Sources ({research!.sources!.length})
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {research!.sources!.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors group"
                      >
                        <span className="text-sm text-foreground group-hover:text-blue-600 truncate pr-4 transition-colors">
                          {src.title || src.url}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Research trace: queries run per round */}
              {(research!.queries_run?.length ?? 0) > 0 && (
                <details className="group">
                  <summary
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
                    style={{ border: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
                  >
                    <span className="font-medium">Research trace</span>
                    <span className="ml-auto font-mono">{research!.queries_run!.length} queries across {(research!.round_summaries?.length ?? 0) + 1} rounds ▸</span>
                  </summary>
                  <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    {research!.round_summaries && research!.round_summaries.length > 0 && (
                      <div className="px-4 py-3 space-y-1" style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}>
                        {research!.round_summaries.map((s, i) => (
                          <p key={i} className="text-xs text-muted-foreground">{s}</p>
                        ))}
                      </div>
                    )}
                    <div className="divide-y divide-border">
                      {research!.queries_run!.map((q, i) => (
                        <div key={i} className="flex items-start gap-2.5 px-4 py-2">
                          <span className="text-[10px] font-mono text-muted-foreground mt-0.5 shrink-0 w-5">{i + 1}</span>
                          <span className="text-xs text-muted-foreground">{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </>
          )}
        </TabsContent>

        {/* ── MEMOS ── */}
        <TabsContent value="memos" className="mt-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div
              className="px-6 py-4"
              style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
            >
              <span className="font-semibold text-foreground text-sm">Credit Appraisal Memos</span>
            </div>
            {memoUploads.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                  <FileText className="h-6 w-6 text-muted-foreground opacity-40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No memos generated yet</p>
                <p className="text-xs text-muted-foreground">
                  Upload a financial statement to auto-generate a CAM memo.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {memoUploads.map((upload, i) => (
                  <div
                    key={upload.id}
                    className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors cg-fade-up"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: 'oklch(0.97 0.015 248)', border: '1px solid oklch(0.90 0.020 248)' }}
                      >
                        <FileText className="h-4 w-4" style={{ color: '#0D1B2A' }} />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">
                          Credit Appraisal Memorandum — FY {upload.financial_year}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(upload.upload_date).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {upload.status === 'complete' && (
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="text-xs font-medium shrink-0 h-7"
                          style={{ background: 'oklch(0.97 0.015 248)', border: '1px solid oklch(0.90 0.020 248)', color: '#0D1B2A' }}
                        >
                          <Link href={`/borrowers/${b.id}/cam-note/${upload.id}`}>
                            ✎ Edit CAM
                          </Link>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="text-xs font-medium shrink-0"
                      >
                        <Link href={`/borrowers/${b.id}/memos/${upload.id}`}>
                          View Memo <ChevronRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
