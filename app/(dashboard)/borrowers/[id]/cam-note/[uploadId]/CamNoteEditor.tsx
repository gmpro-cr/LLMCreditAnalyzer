'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Save, RefreshCw, Download, CheckCircle, AlertCircle, Plus, Trash2, ChevronDown, ChevronRight, Loader2, Lock, Unlock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── Types ──────────────────────────────────────────────────────────────────

type ConfidenceLevel = 'high' | 'medium' | 'low'

interface RiskFlag {
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  ratio_key?: string
  value?: number
}

interface TextSection {
  content: string
  user_edited: boolean
  ai_generated?: boolean
  pep_checked?: boolean
  pep_notes?: string
  confidence?: ConfidenceLevel
  confidence_reason?: string
  reviewed?: boolean
  low_verified?: boolean
  locked?: boolean
}

interface BankRow {
  name: string
  limit_cr: string
  outstanding_cr: string
  type: string
}

interface BankingSection {
  arrangement_type: 'sole' | 'multiple' | 'consortium'
  banks: BankRow[]
  remarks: string
  user_edited: boolean
  ai_generated: false
}

interface ProposedStructure {
  facility_type: string
  amount_cr: string
  tenor_months: string
  pricing_rate: string
  security_primary: string
  security_collateral: string
  covenants: string
  conditions_precedent: string
  user_edited: boolean
  ai_generated: false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CamSection = TextSection | BankingSection | ProposedStructure | Record<string, any>

interface CamSections {
  executive_summary?:   TextSection
  company_background?:  TextSection
  group_structure?:     TextSection
  management_profile?:  TextSection
  business_model?:      TextSection
  industry_analysis?:   TextSection
  financial_analysis?:  TextSection
  working_capital?:     TextSection
  banking_arrangement?: BankingSection
  proposed_structure?:  ProposedStructure
  account_conduct?:     TextSection
  key_issues?:          TextSection
  recommendation?:      TextSection
  [key: string]: CamSection | undefined
}

interface Props {
  borrowerId: string
  uploadId: string
  companyName: string
  industry: string
  financialYear: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractedData: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ratios: Record<string, any>
  camSections: CamSections | null
  memoContent: string
  riskFlags?: RiskFlag[]
}

// ── Section definitions ────────────────────────────────────────────────────

const AI_SECTION_KEYS = [
  'executive_summary',
  'company_background',
  'group_structure',
  'management_profile',
  'business_model',
  'industry_analysis',
  'financial_analysis',
  'working_capital',
  'key_issues',
  'recommendation',
]

const SECTION_META: Record<string, { label: string; icon: string; manual?: boolean; description: string }> = {
  executive_summary:    { label: 'Executive Summary',     icon: '📋', description: '1-page synthesis for credit committee' },
  company_background:   { label: 'Company Background',    icon: '🏢', description: 'Incorporation, business segments, milestones' },
  group_structure:      { label: 'Group Structure',       icon: '🔗', description: 'Parent, subsidiaries, cross-holdings' },
  management_profile:   { label: 'Management Profile',    icon: '👤', description: 'Promoters, directors, PEP check' },
  business_model:       { label: 'Business Model',        icon: '⚙️', description: 'Revenue streams, customers, positioning' },
  industry_analysis:    { label: 'Industry Analysis',     icon: '📊', description: 'Sector trends, competitive dynamics' },
  financial_analysis:   { label: 'Financial Analysis',    icon: '📈', description: 'AI narrative on ratio trends & anomalies' },
  financial_tables:     { label: 'Financial Tables',      icon: '📋', description: '3-year P&L, B/S, ratios — auto computed', manual: true },
  peer_comparison:      { label: 'Peer Comparison',       icon: '⚖️', description: 'Peer financial metrics table', manual: true },
  banking_arrangement:  { label: 'Banking Arrangement',   icon: '🏦', description: 'Sole / Multiple / Consortium banks', manual: true },
  proposed_structure:   { label: 'Proposed Structure',    icon: '🏗️', description: 'Facility type, amount, tenor, security', manual: true },
  working_capital:      { label: 'Working Capital',       icon: '💧', description: 'WC cycle, utilisation, drawing power' },
  account_conduct:      { label: 'Account Conduct',       icon: '📝', description: 'Account history, NPA indicators', manual: true },
  risk_summary:         { label: 'Risk Summary',          icon: '⚠️', description: 'Auto-detected risk flags with severity', manual: true },
  key_issues:           { label: 'Key Issues',             icon: '🚨', description: 'Credit concerns and risk flags' },
  recommendation:       { label: 'Recommendation',        icon: '✅', description: 'Final credit decision and conditions' },
}

const SECTION_ORDER = Object.keys(SECTION_META)

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null): string {
  if (n == null || n === 0) return '—'
  return `₹${n.toLocaleString('en-IN')} Cr`
}

// ── Confidence Badge ────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<ConfidenceLevel, {
  bg: string; border: string; dot: string; text: string; label: string
}> = {
  high:   { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E', text: '#15803D', label: 'High Confidence' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B', text: '#92400E', label: 'Medium — Review Required' },
  low:    { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444', text: '#991B1B', label: 'Low — Edit or Verify' },
}

function ConfidenceBadge({ level, reason }: { level: ConfidenceLevel; reason?: string }) {
  const s = CONFIDENCE_STYLES[level]
  return (
    <div
      title={reason}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full cursor-default"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      <span className="text-[10px] font-semibold tracking-wide" style={{ color: s.text }}>{s.label}</span>
    </div>
  )
}

// ── Financial Tables (read-only, computed from extractedData) ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FinancialTablesSection({ ext, ratios }: { ext: Record<string, any>; ratios: Record<string, any> }) {
  const pl   = ext.profit_loss   ?? {}
  const bs   = ext.balance_sheet ?? {}
  const cf   = ext.cash_flow     ?? {}

  // Multi-year (Screener format)
  const years   = pl.years   ?? []
  const revenue = pl.revenue ?? []
  const pat     = pl.pat     ?? []
  const ebitda  = pl.ebitda  ?? []
  const borrowings = bs.borrowings ?? []
  const networth   = bs.networth   ?? []

  const hasMultiYear = years.length > 0

  const ratioRows = [
    { label: 'Current Ratio',       key: 'current_ratio' },
    { label: 'Debt / Equity',       key: 'debt_equity' },
    { label: 'Interest Coverage',   key: 'interest_coverage' },
    { label: 'DSCR',                key: 'dscr' },
    { label: 'EBITDA Margin %',     key: 'ebitda_margin' },
    { label: 'Net Margin %',        key: 'net_margin' },
    { label: 'ROCE %',              key: 'roce' },
    { label: 'Debtor Days',         key: 'debtor_days' },
    { label: 'Inventory Days',      key: 'inventory_days' },
  ]

  return (
    <div className="space-y-5">
      {hasMultiYear ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'oklch(0.978 0.006 78)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Metric (₹ Cr)</th>
                {years.map((y: string) => (
                  <th key={y} className="text-right px-4 py-2.5 text-xs font-semibold text-foreground">{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Revenue',     data: revenue },
                { label: 'EBITDA',      data: ebitda },
                { label: 'PAT',         data: pat },
                { label: 'Borrowings',  data: borrowings },
                { label: 'Net Worth',   data: networth },
              ].map(row => row.data.length > 0 && (
                <tr key={row.label} style={{ borderBottom: '1px solid oklch(0.940 0.009 78)' }}>
                  <td className="px-4 py-2 text-xs font-medium text-muted-foreground">{row.label}</td>
                  {row.data.map((v: number, i: number) => (
                    <td key={i} className="px-4 py-2 text-right text-xs font-semibold text-foreground">
                      {v != null ? fmt(v) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Single year from structured extract
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Revenue', value: pl.revenue?.revenue_from_operations },
            { label: 'EBITDA',  value: pl.profit_metrics?.ebitda },
            { label: 'PAT',     value: pl.profit_metrics?.profit_after_tax },
            { label: 'Net Worth', value: bs.equity?.total_equity },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg p-3" style={{ background: 'oklch(0.978 0.006 78)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
              <p className="text-base font-bold text-foreground">{fmt(value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Key ratios */}
      {Object.keys(ratios).length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'oklch(0.978 0.006 78)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Ratio</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Value</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Signal</th>
              </tr>
            </thead>
            <tbody>
              {ratioRows.filter(r => ratios[r.key] != null).map(r => {
                const v = ratios[r.key]
                return (
                  <tr key={r.key} style={{ borderBottom: '1px solid oklch(0.940 0.009 78)' }}>
                    <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.label}</td>
                    <td className="px-4 py-1.5 text-right text-xs font-semibold text-foreground">{v.toFixed(2)}</td>
                    <td className="px-4 py-1.5 text-right"></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground italic">
        Financial tables are read-only and auto-computed from extracted data.
      </p>
    </div>
  )
}

// ── Peer Comparison (read-only) ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PeerComparisonSection({ ext }: { ext: Record<string, any> }) {
  const peers  = ext.peers ?? ext.screener_financials?.peers ?? []
  const sfin   = ext.screener_financials ?? ext

  // Company row
  const companyRow = {
    name:    ext.company_info?.name ?? 'Borrower',
    revenue: sfin.profit_loss?.revenue?.slice(-1)?.[0] ?? null,
    pat:     sfin.profit_loss?.pat?.slice(-1)?.[0]     ?? null,
    de:      ext.ratios?.debt_equity ?? null,
    roce:    ext.ratios?.roce         ?? null,
  }

  if (peers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No peer data available. Run Auto-Analyse to fetch listed company peers from Screener.in.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'oklch(0.978 0.006 78)', borderBottom: '1px solid var(--border)' }}>
            {['Company', ...Object.keys(peers[0]).slice(0, 6)].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {peers.map((peer: Record<string, string>, i: number) => (
            <tr key={i} style={{ borderBottom: '1px solid oklch(0.940 0.009 78)' }}>
              <td className="px-4 py-2 text-xs font-semibold text-foreground">{peer.name ?? `Peer ${i + 1}`}</td>
              {Object.values(peer).slice(0, 6).map((v, j) => (
                <td key={j} className="px-4 py-2 text-xs text-muted-foreground">{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Banking Arrangement ────────────────────────────────────────────────────

function BankingArrangementSection({
  section,
  onChange,
}: {
  section: BankingSection
  onChange: (updated: BankingSection) => void
}) {
  const addBank = () => {
    onChange({
      ...section,
      banks: [...section.banks, { name: '', limit_cr: '', outstanding_cr: '', type: 'Term Loan' }],
      user_edited: true,
    })
  }

  const updateBank = (i: number, field: keyof BankRow, value: string) => {
    const banks = section.banks.map((b, idx) => idx === i ? { ...b, [field]: value } : b)
    onChange({ ...section, banks, user_edited: true })
  }

  const removeBank = (i: number) => {
    onChange({ ...section, banks: section.banks.filter((_, idx) => idx !== i), user_edited: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-foreground">Arrangement Type</label>
        <div className="flex gap-2">
          {(['sole', 'multiple', 'consortium'] as const).map(t => (
            <button
              key={t}
              onClick={() => onChange({ ...section, arrangement_type: t, user_edited: true })}
              className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all"
              style={{
                background: section.arrangement_type === t ? '#0D1B2A' : 'oklch(0.978 0.006 78)',
                color: section.arrangement_type === t ? '#fff' : 'oklch(0.42 0.030 248)',
                border: `1px solid ${section.arrangement_type === t ? '#0D1B2A' : 'var(--border)'}`,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Bank table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Banks / Lenders</p>
          <button
            onClick={addBank}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors"
            style={{ border: '1px solid var(--border)', color: 'oklch(0.42 0.030 248)' }}
          >
            <Plus className="h-3 w-3" /> Add Bank
          </button>
        </div>

        {section.banks.length > 0 ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'oklch(0.978 0.006 78)', borderBottom: '1px solid var(--border)' }}>
                  {['Bank / FI Name', 'Facility Type', 'Limit (₹ Cr)', 'Outstanding (₹ Cr)', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.banks.map((bank, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid oklch(0.940 0.009 78)' }}>
                    <td className="px-3 py-2">
                      <input
                        value={bank.name}
                        onChange={e => updateBank(i, 'name', e.target.value)}
                        placeholder="e.g. SBI"
                        className="w-full text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={bank.type}
                        onChange={e => updateBank(i, 'type', e.target.value)}
                        className="text-xs bg-transparent outline-none text-foreground cursor-pointer"
                      >
                        {['Term Loan', 'Cash Credit', 'OD', 'WCDL', 'LC', 'BG', 'ECB', 'NCD'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={bank.limit_cr}
                        onChange={e => updateBank(i, 'limit_cr', e.target.value)}
                        placeholder="0.00"
                        className="w-24 text-xs bg-transparent outline-none text-right text-foreground placeholder:text-muted-foreground/50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={bank.outstanding_cr}
                        onChange={e => updateBank(i, 'outstanding_cr', e.target.value)}
                        placeholder="0.00"
                        className="w-24 text-xs bg-transparent outline-none text-right text-foreground placeholder:text-muted-foreground/50"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeBank(i)} className="text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic py-2">
            No banks added yet. Click "Add Bank" to record lending arrangements.
          </p>
        )}
      </div>

      {/* Remarks */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Remarks</label>
        <textarea
          value={section.remarks}
          onChange={e => onChange({ ...section, remarks: e.target.value, user_edited: true })}
          rows={3}
          placeholder="Any notes on banking arrangement, security, collateral…"
          className="w-full text-sm p-3 rounded-xl bg-muted/30 border border-border outline-none focus:border-foreground/30 resize-none text-foreground placeholder:text-muted-foreground/50 transition-colors"
        />
      </div>
    </div>
  )
}

// ── Text Section Editor ────────────────────────────────────────────────────

function TextSectionEditor({
  sectionKey, section, onChange, onRegenerate, isRegenerating, onMarkReviewed, onVerifyLow,
}: {
  sectionKey: string
  section: TextSection
  onChange: (updated: TextSection) => void
  onRegenerate?: () => void
  isRegenerating?: boolean
  onMarkReviewed?: () => void
  onVerifyLow?: () => void
}) {
  const showPep = sectionKey === 'management_profile'

  return (
    <div className="space-y-3">
      <textarea
        value={section.content}
        onChange={e => !section.locked && onChange({ ...section, content: e.target.value, user_edited: true })}
        rows={10}
        disabled={!!section.locked}
        placeholder={section.ai_generated ? 'AI draft will appear here after generation…' : 'Enter notes here…'}
        className="w-full text-sm p-4 rounded-xl border border-border outline-none focus:border-foreground/30 resize-y text-foreground placeholder:text-muted-foreground/50 transition-colors leading-relaxed"
        style={{ background: 'oklch(0.993 0.003 78)', minHeight: 160 }}
      />

      {showPep && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: section.pep_checked ? '#fef2f2' : 'oklch(0.978 0.006 78)', border: `1px solid ${section.pep_checked ? '#fecaca' : 'var(--border)'}` }}
        >
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pep_check"
              checked={!!section.pep_checked}
              onChange={e => onChange({ ...section, pep_checked: e.target.checked, user_edited: true })}
              className="w-4 h-4 cursor-pointer"
            />
            <label htmlFor="pep_check" className="text-sm font-medium text-foreground cursor-pointer">
              Politically Exposed Person (PEP) indicator present
            </label>
          </div>
          {section.pep_checked && (
            <textarea
              value={section.pep_notes ?? ''}
              onChange={e => onChange({ ...section, pep_notes: e.target.value, user_edited: true })}
              rows={3}
              placeholder="Describe the PEP association, risk level, and mitigation measures…"
              className="w-full text-sm p-3 rounded-lg border border-red-200 outline-none focus:border-red-400 resize-none bg-white text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
          )}
        </div>
      )}

      {onRegenerate && (
        <div className="flex items-center justify-between">
          {section.user_edited && (
            <span className="text-[11px] text-amber-600 font-medium flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Manually edited
            </span>
          )}
          {section.ai_generated && !section.user_edited && (
            <span className="text-[11px] text-green-600 font-medium flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> AI draft
            </span>
          )}
          {!section.content && !section.ai_generated && (
            <span className="text-[11px] text-muted-foreground">Not generated yet</span>
          )}
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ml-auto"
            style={{ background: 'oklch(0.978 0.006 78)', border: '1px solid var(--border)', color: 'oklch(0.42 0.030 248)' }}
          >
            {isRegenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate
          </button>
        </div>
      )}

      {/* Confidence + HITL review row */}
      {section.ai_generated && section.confidence && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{
            background: section.confidence === 'low' ? '#FEF2F2'
              : section.confidence === 'medium' ? '#FFFBEB' : '#F0FDF4',
            border: `1px solid ${section.confidence === 'low' ? '#FECACA'
              : section.confidence === 'medium' ? '#FDE68A' : '#BBF7D0'}`,
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ConfidenceBadge level={section.confidence as ConfidenceLevel} reason={section.confidence_reason} />
            {section.confidence_reason && (
              <span className="text-[11px] text-muted-foreground truncate hidden sm:block">
                {section.confidence_reason}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {section.confidence === 'medium' && !section.reviewed && !section.user_edited && (
              <button
                onClick={onMarkReviewed}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: '#F59E0B', color: '#fff' }}
              >
                <CheckCircle className="h-3.5 w-3.5" /> Mark as Reviewed
              </button>
            )}
            {section.confidence === 'medium' && (section.reviewed || section.user_edited) && (
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#15803D' }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {section.user_edited ? 'Edited by RM' : 'Reviewed'}
              </span>
            )}
            {section.confidence === 'low' && !section.user_edited && !section.low_verified && (
              <button
                onClick={onVerifyLow}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: '#EF4444', color: '#fff' }}
              >
                <AlertCircle className="h-3.5 w-3.5" /> Verify Anyway
              </button>
            )}
            {section.confidence === 'low' && (section.user_edited || section.low_verified) && (
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#15803D' }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {section.user_edited ? 'Edited by RM' : 'Verified'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export Readiness ────────────────────────────────────────────────────────

function computeExportReadiness(sections: CamSections): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const key of AI_SECTION_KEYS) {
    const sec = sections[key] as TextSection | undefined
    if (!sec?.ai_generated) continue
    const conf = sec.confidence as ConfidenceLevel | undefined
    if (conf === 'low' && !sec.user_edited && !sec.low_verified) {
      blockers.push(`"${SECTION_META[key]?.label ?? key}" is Low confidence — edit or verify`)
    } else if (conf === 'medium' && !sec.reviewed && !sec.user_edited) {
      warnings.push(`"${SECTION_META[key]?.label ?? key}" not yet reviewed`)
    }
  }
  return { blockers, warnings }
}

// ── Risk Summary ────────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  high:   { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444', text: '#991B1B', badge: '#FEE2E2', badgeText: '#B91C1C' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B', text: '#92400E', badge: '#FEF3C7', badgeText: '#B45309' },
  low:    { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E', text: '#15803D', badge: '#DCFCE7', badgeText: '#15803D' },
}

function RiskSummarySection({ riskFlags }: { riskFlags: RiskFlag[] }) {
  if (riskFlags.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No risk flags detected. Upload financials and run analysis to generate the risk summary.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-3 flex-wrap mb-4">
        {(['high', 'medium', 'low'] as const).map(sev => {
          const count = riskFlags.filter(f => f.severity === sev).length
          if (!count) return null
          const s = SEVERITY_STYLES[sev]
          return (
            <div key={sev} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: s.badge, color: s.badgeText }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
              {count} {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </div>
          )
        })}
      </div>
      {riskFlags.map((flag, i) => {
        const s = SEVERITY_STYLES[flag.severity]
        return (
          <div key={i} className="rounded-xl p-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.dot }} />
              <span className="text-sm font-semibold" style={{ color: s.text }}>{flag.title}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ml-auto"
                style={{ background: s.badge, color: s.badgeText }}>
                {flag.severity}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-4">{flag.description}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Proposed Facility Structure ────────────────────────────────────────────

function ProposedStructureSection({
  section,
  onChange,
}: {
  section: ProposedStructure
  onChange: (updated: ProposedStructure) => void
}) {
  const update = (field: keyof ProposedStructure, value: string) =>
    onChange({ ...section, [field]: value, user_edited: true })

  const FACILITY_TYPES = ['Term Loan', 'Cash Credit', 'OD', 'WCDL', 'LC', 'BG', 'ECB', 'NCD', "Buyer's Credit"]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Facility Type</label>
          <select
            value={section.facility_type}
            onChange={e => update('facility_type', e.target.value)}
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          >
            <option value="">Select…</option>
            {FACILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount (₹ Cr)</label>
          <input
            value={section.amount_cr}
            onChange={e => update('amount_cr', e.target.value)}
            placeholder="e.g. 25.00"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Tenor (months)</label>
          <input
            value={section.tenor_months}
            onChange={e => update('tenor_months', e.target.value)}
            placeholder="e.g. 84"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Pricing / Rate</label>
          <input
            value={section.pricing_rate}
            onChange={e => update('pricing_rate', e.target.value)}
            placeholder="e.g. MCLR + 1.25%"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
      </div>
      {([
        { field: 'security_primary' as const,     label: 'Primary Security',      rows: 2, placeholder: 'e.g. First charge on fixed assets...' },
        { field: 'security_collateral' as const,  label: 'Collateral Security',    rows: 2, placeholder: 'e.g. Mortgage of property...' },
        { field: 'covenants' as const,            label: 'Financial Covenants',    rows: 3, placeholder: 'e.g. Maintain DSCR ≥ 1.25x; D/E ≤ 2.5x...' },
        { field: 'conditions_precedent' as const, label: 'Conditions Precedent',   rows: 3, placeholder: 'e.g. Submission of audited financials...' },
      ] as const).map(({ field, label, rows, placeholder }) => (
        <div key={field}>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
          <textarea
            value={section[field]}
            onChange={e => update(field, e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full text-sm p-3 rounded-xl border border-border bg-background outline-none focus:border-foreground/30 resize-none"
          />
        </div>
      ))}
    </div>
  )
}

// ── Main Editor ────────────────────────────────────────────────────────────

export default function CamNoteEditor({
  borrowerId,
  uploadId,
  companyName,
  financialYear,
  extractedData,
  ratios,
  camSections: initialSections,
  riskFlags = [],
}: Props) {
  const [sections, setSections] = useState<CamSections>(initialSections ?? {})
  const [activeSection, setActiveSection] = useState<string>('company_background')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [generating, setGenerating] = useState(false)
  const [regeneratingSections, setRegeneratingSections] = useState<Set<string>>(new Set())
  const [generationError, setGenerationError] = useState('')
  const [exportingDocx, setExportingDocx] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<{id: string; label: string; created_at: string}[]>([])
  const [savingVersion, setSavingVersion] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Save (debounced auto-save on section change) ──
  const saveSection = useCallback(async (key: string, data: CamSection) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      setSaveStatus('idle')
      try {
        const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section_key: key, section_data: data }),
        })
        setSaveStatus(res.ok ? 'saved' : 'error')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
      } finally {
        setSaving(false)
      }
    }, 800)
  }, [borrowerId, uploadId])

  const updateSection = useCallback((key: string, data: CamSection) => {
    setSections(prev => ({ ...prev, [key]: data }))
    saveSection(key, data)
  }, [saveSection])

  // ── Generate all AI sections ──
  const handleGenerateAll = async () => {
    setGenerating(true)
    setGenerationError('')
    try {
      const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setGenerationError((err as { error?: string }).error ?? 'Generation failed')
        return
      }
      const { sections: generated } = await res.json()
      setSections(generated)
    } catch (e) {
      setGenerationError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  // ── Regenerate single section ──
  const handleRegenerateSection = async (key: string) => {
    setRegeneratingSections(prev => new Set(prev).add(key))
    try {
      const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: key }),
      })
      if (!res.ok) return
      const { sections: generated } = await res.json()
      if (generated[key]) {
        setSections(prev => ({ ...prev, [key]: generated[key] }))
      }
    } finally {
      setRegeneratingSections(prev => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
    }
  }

  // ── Export to DOCX ──
  const handleExportDocx = async () => {
    const { blockers } = computeExportReadiness(sections)
    if (blockers.length > 0) {
      alert(`Cannot export — resolve these issues first:\n\n• ${blockers.join('\n• ')}`)
      return
    }
    setExportingDocx(true)
    try {
      const content = buildDocxContent()
      const res = await fetch('/api/python-proxy/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_content: content, company_name: companyName }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/\s+/g, '_')}_FY${financialYear}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingDocx(false)
    }
  }

  const handleExportPdf = async () => {
    const { blockers } = computeExportReadiness(sections)
    if (blockers.length > 0) {
      alert(`Cannot export — resolve these issues first:\n\n• ${blockers.join('\n• ')}`)
      return
    }
    setExportingPdf(true)
    try {
      const content = buildDocxContent()
      const res = await fetch('/api/python-proxy/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_content: content, company_name: companyName }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/\s+/g, '_')}_FY${financialYear}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleSaveVersion = async () => {
    const label = window.prompt(
      'Version label (e.g. "Before Credit Committee"):',
      `Draft ${new Date().toLocaleDateString('en-IN')}`
    )
    if (!label) return
    setSavingVersion(true)
    try {
      await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, snapshot: sections }),
      })
    } finally {
      setSavingVersion(false)
    }
  }

  const handleLoadVersions = async () => {
    const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions`)
    if (res.ok) {
      const { versions: v } = await res.json()
      setVersions(v ?? [])
    }
    setShowVersions(true)
  }

  const handleRestoreVersion = async (versionId: string) => {
    if (!window.confirm('Restore this version? Current unsaved changes will be overwritten.')) return
    const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions/${versionId}`)
    if (res.ok) {
      const data = await res.json()
      setSections(data.snapshot)
      setShowVersions(false)
    }
  }

  const buildDocxContent = (): string => {
    const parts: string[] = [`# Credit Appraisal Memorandum — ${companyName} (FY ${financialYear})\n`]
    for (const key of SECTION_ORDER) {
      const meta = SECTION_META[key]
      const sec  = sections[key]
      if (key === 'financial_tables' || key === 'peer_comparison' || key === 'risk_summary') continue
      parts.push(`\n## ${meta.label}\n`)
      if (!sec) {
        parts.push('_(Not completed)_\n')
      } else if (key === 'banking_arrangement') {
        const bk = sec as BankingSection
        parts.push(`Arrangement Type: ${bk.arrangement_type}\n`)
        if (bk.banks.length > 0) {
          parts.push('\n| Bank | Type | Limit (₹ Cr) | Outstanding (₹ Cr) |')
          parts.push('|------|------|-------------|-------------------|')
          bk.banks.forEach(b => parts.push(`| ${b.name} | ${b.type} | ${b.limit_cr} | ${b.outstanding_cr} |`))
        }
        if (bk.remarks) parts.push(`\n${bk.remarks}\n`)
      } else if (key === 'proposed_structure') {
        const ps = sec as ProposedStructure
        if (ps.facility_type) parts.push(`Facility Type: ${ps.facility_type}\n`)
        if (ps.amount_cr) parts.push(`Amount: ₹${ps.amount_cr} Cr\n`)
        if (ps.tenor_months) parts.push(`Tenor: ${ps.tenor_months} months\n`)
        if (ps.pricing_rate) parts.push(`Pricing: ${ps.pricing_rate}\n`)
        if (ps.security_primary) parts.push(`\nPrimary Security:\n${ps.security_primary}\n`)
        if (ps.security_collateral) parts.push(`\nCollateral:\n${ps.security_collateral}\n`)
        if (ps.covenants) parts.push(`\nFinancial Covenants:\n${ps.covenants}\n`)
        if (ps.conditions_precedent) parts.push(`\nConditions Precedent:\n${ps.conditions_precedent}\n`)
      } else {
        const ts = sec as TextSection
        if (ts.content) parts.push(`${ts.content}\n`)
        if (key === 'management_profile' && ts.pep_checked) {
          parts.push(`\n**PEP Status:** Flagged\n${ts.pep_notes ?? ''}\n`)
        }
      }
    }
    return parts.join('\n')
  }

  const hasAnySections = Object.keys(sections).length > 0

  // ── Sidebar ────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col cg-fade-in">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.993 0.003 78)' }}
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2">
            <Link href={`/borrowers/${borrowerId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div>
            <span className="font-semibold text-foreground text-sm">{companyName}</span>
            <span className="text-muted-foreground text-xs ml-2">CAM Note · FY {financialYear}</span>
          </div>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="h-3 w-3" /> Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3 w-3" /> Save failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!hasAnySections && (
            <Button
              size="sm"
              onClick={handleGenerateAll}
              disabled={generating}
              className="text-xs font-medium"
              style={{ background: '#0D1B2A', color: '#fff' }}
            >
              {generating ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate AI Draft</>
              )}
            </Button>
          )}
          {hasAnySections && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateAll}
              disabled={generating}
              className="text-xs font-medium"
            >
              {generating ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Regenerating…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Regenerate All</>
              )}
            </Button>
          )}
          {(() => {
            const { blockers } = computeExportReadiness(sections)
            const blocked = blockers.length > 0
            return (
              <Button
                variant="outline" size="sm"
                onClick={handleExportDocx}
                disabled={exportingDocx}
                className="text-xs font-medium relative"
                style={blocked ? { borderColor: '#EF4444', color: '#991B1B' } : undefined}
                title={blocked ? `${blockers.length} issue(s) blocking export` : 'Export to Word'}
              >
                {exportingDocx ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : blocked ? <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                  : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Export .docx
                {blocked && (
                  <span
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                    style={{ background: '#EF4444', color: '#fff' }}
                  >
                    {blockers.length}
                  </span>
                )}
              </Button>
            )
          })()}
          <Button
            variant="outline" size="sm"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="text-xs font-medium"
          >
            {exportingPdf
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleSaveVersion} disabled={savingVersion} className="text-xs">
            {savingVersion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            {!savingVersion && 'Save Version'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleLoadVersions} className="text-xs">
            <FileText className="h-3.5 w-3.5 mr-1" /> History
          </Button>
        </div>
      </div>

      {generationError && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 shrink-0">
          {generationError}
        </div>
      )}

      {/* Version history panel */}
      {showVersions && (
        <div className="mx-6 mt-3 rounded-xl border border-border shrink-0" style={{ background: 'oklch(0.993 0.003 78)' }}>
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-semibold text-foreground">Version History</span>
            <button onClick={() => setShowVersions(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Close
            </button>
          </div>
          <div className="p-4">
            {versions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No saved versions yet. Click &quot;Save Version&quot; to create one.</p>
            ) : (
              <div className="space-y-2">
                {versions.map(v => (
                  <div key={v.id} className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: 'oklch(0.978 0.006 78)', border: '1px solid var(--border)' }}>
                    <div>
                      <p className="text-xs font-medium text-foreground">{v.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(v.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestoreVersion(v.id)}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
                      style={{ background: '#0D1B2A', color: '#fff' }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasAnySections && !generating && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-5 text-3xl">
              📄
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground mb-2">
              Start the CAM Note
            </h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Generate AI-drafted sections for company background, management profile, industry analysis, key issues, and recommendation — then edit each section manually.
            </p>
            <Button
              onClick={handleGenerateAll}
              disabled={generating}
              style={{ background: '#0D1B2A', color: '#fff' }}
            >
              <Sparkles className="h-4 w-4 mr-2" /> Generate AI Draft
            </Button>
          </div>
        </div>
      )}

      {/* Generating spinner */}
      {generating && !hasAnySections && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Generating CAM sections… this may take 1–2 minutes</p>
          </div>
        </div>
      )}

      {/* Main editor layout */}
      {hasAnySections && (
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <aside
            className="w-56 shrink-0 overflow-y-auto py-3"
            style={{ borderRight: '1px solid var(--border)', background: 'oklch(0.993 0.003 78)' }}
          >
            {SECTION_ORDER.map(key => {
              const meta  = SECTION_META[key]
              const sec   = sections[key] as TextSection | undefined
              const isDone = sec && (
                key === 'financial_tables' || key === 'peer_comparison' ||
                (key === 'banking_arrangement' ? (sec as unknown as BankingSection).banks?.length > 0 : sec.content?.trim())
              )
              const isAI = sec?.ai_generated && !sec?.user_edited

              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className="w-full text-left px-4 py-2.5 transition-all flex items-start gap-2.5 group"
                  style={{
                    background: activeSection === key ? '#0D1B2A' : 'transparent',
                    borderLeft: `2px solid ${activeSection === key ? '#B8860B' : 'transparent'}`,
                  }}
                >
                  <span className="text-base shrink-0 mt-0.5">{meta.icon}</span>
                  <div className="min-w-0">
                    <p
                      className="text-xs font-medium truncate"
                      style={{ color: activeSection === key ? '#fff' : 'oklch(0.35 0.035 248)' }}
                    >
                      {meta.label}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isDone ? (
                        <span className="text-[9px]" style={{ color: isAI ? '#16a34a' : activeSection === key ? '#B8860B' : '#ca8a04' }}>
                          {isAI ? '✦ AI' : '✎ Edited'}
                        </span>
                      ) : (
                        <span className="text-[9px] text-muted-foreground">empty</span>
                      )}
                      {/* Confidence dot */}
                      {(() => {
                        const s = sections[key] as TextSection | undefined
                        const conf = s?.confidence as ConfidenceLevel | undefined
                        if (!conf || !s?.ai_generated) return null
                        const cleared = s.user_edited || s.reviewed || s.low_verified
                        if (cleared) return <CheckCircle className="h-2.5 w-2.5 ml-1" style={{ color: '#22C55E' }} />
                        const dot = conf === 'low' ? '#EF4444' : conf === 'medium' ? '#F59E0B' : '#22C55E'
                        return <span className="h-1.5 w-1.5 rounded-full ml-1 shrink-0" style={{ background: dot }} />
                      })()}
                    </div>
                  </div>
                </button>
              )
            })}
          </aside>

          {/* Editor pane */}
          <main className="flex-1 overflow-y-auto p-6">
            {(() => {
              const meta = SECTION_META[activeSection]
              if (!meta) return null

              return (
                <div className="max-w-3xl mx-auto space-y-4">
                  {/* Section header */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{meta.icon}</span>
                      <h2 className="font-display text-lg font-semibold text-foreground">{meta.label}</h2>
                      {meta.manual && (
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'oklch(0.97 0.010 78)', border: '1px solid oklch(0.89 0.010 78)', color: 'oklch(0.52 0.025 248)' }}
                        >
                          Manual
                        </span>
                      )}
                      {AI_SECTION_KEYS.includes(activeSection) && (
                        <button
                          onClick={() => {
                            const sec = sections[activeSection] as TextSection
                            if (sec) updateSection(activeSection, { ...sec, locked: !sec.locked })
                          }}
                          title={(sections[activeSection] as TextSection)?.locked ? 'Unlock section' : 'Lock section'}
                          className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                        >
                          {(sections[activeSection] as TextSection)?.locked
                            ? <Lock className="h-3.5 w-3.5" />
                            : <Unlock className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>

                  {/* Content */}
                  {activeSection === 'financial_tables' && (
                    <FinancialTablesSection ext={extractedData} ratios={ratios} />
                  )}

                  {activeSection === 'peer_comparison' && (
                    <PeerComparisonSection ext={extractedData} />
                  )}

                  {activeSection === 'risk_summary' && (
                    <RiskSummarySection riskFlags={riskFlags as RiskFlag[]} />
                  )}

                  {activeSection === 'proposed_structure' && (
                    <ProposedStructureSection
                      section={sections.proposed_structure ?? {
                        facility_type: '', amount_cr: '', tenor_months: '',
                        pricing_rate: '', security_primary: '', security_collateral: '',
                        covenants: '', conditions_precedent: '',
                        user_edited: false, ai_generated: false,
                      }}
                      onChange={data => updateSection('proposed_structure', data)}
                    />
                  )}

                  {activeSection === 'banking_arrangement' && (
                    <BankingArrangementSection
                      section={sections.banking_arrangement ?? {
                        arrangement_type: 'sole', banks: [], remarks: '', user_edited: false, ai_generated: false,
                      }}
                      onChange={data => updateSection('banking_arrangement', data)}
                    />
                  )}

                  {activeSection === 'account_conduct' && (
                    <TextSectionEditor
                      sectionKey={activeSection}
                      section={sections[activeSection] as TextSection ?? { content: '', user_edited: false }}
                      onChange={data => updateSection(activeSection, data)}
                    />
                  )}

                  {AI_SECTION_KEYS.includes(activeSection) && (
                    <TextSectionEditor
                      sectionKey={activeSection}
                      section={sections[activeSection] as TextSection ?? { content: '', user_edited: false, ai_generated: false }}
                      onChange={data => updateSection(activeSection, data)}
                      onRegenerate={() => handleRegenerateSection(activeSection)}
                      isRegenerating={regeneratingSections.has(activeSection)}
                      onMarkReviewed={() => updateSection(activeSection, {
                        ...(sections[activeSection] as TextSection),
                        reviewed: true,
                        locked: true,
                      })}
                      onVerifyLow={() => updateSection(activeSection, {
                        ...(sections[activeSection] as TextSection),
                        low_verified: true,
                      })}
                    />
                  )}

                  {/* Nav arrows */}
                  <div className="flex justify-between pt-4 border-t border-border">
                    {(() => {
                      const idx  = SECTION_ORDER.indexOf(activeSection)
                      const prev = SECTION_ORDER[idx - 1]
                      const next = SECTION_ORDER[idx + 1]
                      return (
                        <>
                          {prev ? (
                            <button
                              onClick={() => setActiveSection(prev)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                              {SECTION_META[prev].label}
                            </button>
                          ) : <span />}
                          {next && (
                            <button
                              onClick={() => setActiveSection(next)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {SECTION_META[next].label}
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )
            })()}
          </main>
        </div>
      )}
    </div>
  )
}
