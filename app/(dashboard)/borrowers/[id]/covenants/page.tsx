'use client'
import { useState, useEffect, use } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, ShieldAlert, Shield, XCircle } from 'lucide-react'
import { RATIO_LABELS } from '@/types'
import type { Covenant } from '@/types'

const OPERATOR_OPTIONS = [
  { value: 'gte', label: '>= at least' },
  { value: 'lte', label: '<= at most' },
  { value: 'gt',  label: '>  greater than' },
  { value: 'lt',  label: '<  less than' },
]
const OPERATOR_DISPLAY: Record<string, string> = {
  gte: '≥', lte: '≤', gt: '>', lt: '<',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function CovenantsPage({ params }: PageProps) {
  const { id } = use(params)
  const [covenants, setCovenants] = useState<Covenant[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  const [showDialog, setShowDialog] = useState(false)
  const [ratioName, setRatioName] = useState('')
  const [operator, setOperator] = useState('gte')
  const [threshold, setThreshold] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function fetchCovenants() {
    setLoading(true); setFetchError('')
    try {
      const res = await fetch(`/api/borrowers/${id}/covenants`)
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFetchError(d.error || 'Failed to load.'); return }
      setCovenants(await res.json())
    } catch { setFetchError('Failed to load covenants.') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchCovenants() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddCovenant(e: React.FormEvent) {
    e.preventDefault(); setFormError('')
    if (!ratioName) { setFormError('Please select a ratio.'); return }
    if (!threshold || isNaN(Number(threshold))) { setFormError('Please enter a valid threshold.'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/borrowers/${id}/covenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio_name: ratioName, operator, threshold: Number(threshold) }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFormError(d.error || 'Failed to save.'); setSaving(false); return }
      setShowDialog(false); setRatioName(''); setOperator('gte'); setThreshold('')
      await fetchCovenants()
    } catch { setFormError('An unexpected error occurred.') }
    finally { setSaving(false) }
  }

  async function handleDelete(covenantId: string) {
    setDeletingId(covenantId)
    try {
      const res = await fetch(`/api/borrowers/${id}/covenants?covenant_id=${covenantId}`, { method: 'DELETE' })
      if (res.ok) setCovenants(prev => prev.filter(c => c.id !== covenantId))
    } finally { setDeletingId(null) }
  }

  const sortedRatios = Object.entries(RATIO_LABELS).sort((a, b) => a[1].localeCompare(b[1]))
  const breachedCount = covenants.filter(c => c.is_breached).length

  return (
    <div className="max-w-3xl mx-auto space-y-6 cg-fade-in">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
        <Link href={`/borrowers/${id}`}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Borrower
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground leading-tight">
            Covenant Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Financial covenants monitored on every upload
          </p>
        </div>
        <Button
          onClick={() => { setShowDialog(true); setFormError('') }}
          style={{ background: '#0D1B2A', color: '#fff' }}
        >
          <Plus className="h-4 w-4 mr-2" /> Add Covenant
        </Button>
      </div>

      {/* Stats row */}
      {covenants.length > 0 && (
        <div className="grid grid-cols-3 gap-3 cg-fade-up cg-delay-1">
          {[
            { label: 'Total Covenants', value: covenants.length, color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
            { label: 'OK', value: covenants.length - breachedCount, color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
            { label: 'Breached', value: breachedCount, color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
          ].map(s => (
            <div
              key={s.label}
              className="rounded-xl p-4"
              style={{ background: s.bg, border: `1px solid ${s.border}` }}
            >
              <p className="text-2xl font-bold font-display" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs font-medium mt-1" style={{ color: s.color, opacity: 0.7 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {fetchError && (
        <Alert variant="destructive" className="rounded-xl">
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {/* Covenants table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-fade-up cg-delay-2">
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-white border border-border">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm">
              Active Covenants
              {covenants.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal text-xs">
                  ({covenants.length})
                </span>
              )}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Evaluated on each upload</p>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div
              className="h-5 w-5 border-2 border-t-transparent rounded-full animate-spin mx-auto"
              style={{ borderColor: '#B8860B', borderTopColor: 'transparent' }}
            />
            <p className="text-sm text-muted-foreground mt-3">Loading covenants...</p>
          </div>
        ) : covenants.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="h-7 w-7 text-muted-foreground opacity-40" />
            </div>
            <p className="font-semibold text-foreground mb-1">No covenants configured</p>
            <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
              Add ratio-based covenants to monitor financial health automatically.
            </p>
            <Button variant="outline" onClick={() => setShowDialog(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add First Covenant
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
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {covenants.map((c, i) => (
                <tr key={c.id} className="cg-fade-up" style={{ animationDelay: `${0.05 + i * 0.04}s` }}>
                  <td>
                    <span className="font-semibold text-foreground text-[13px]">
                      {RATIO_LABELS[c.ratio_name] ?? c.ratio_name}
                    </span>
                  </td>
                  <td>
                    <code
                      className="text-xs px-2.5 py-1 rounded-md font-mono font-semibold"
                      style={{ background: 'oklch(0.95 0.007 80)', border: '1px solid oklch(0.88 0.009 78)' }}
                    >
                      {OPERATOR_DISPLAY[c.operator] ?? c.operator} {c.threshold}
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
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                        style={{ background: 'oklch(0.95 0.007 80)', color: 'oklch(0.52 0.025 248)', border: '1px solid oklch(0.88 0.009 78)' }}
                      >
                        Not checked
                      </span>
                    ) : c.is_breached ? (
                      <span className="badge-breach">⚠ Breached</span>
                    ) : (
                      <span className="badge-ok">✓ OK</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                      title="Delete covenant"
                    >
                      {deletingId === c.id ? (
                        <div className="h-3.5 w-3.5 border border-t-transparent border-red-400 rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Covenant Dialog */}
      <Dialog
        open={showDialog}
        onOpenChange={open => { setShowDialog(open); if (!open) setFormError('') }}
      >
        <DialogContent className="sm:max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Add Covenant</DialogTitle>
            <DialogDescription className="text-sm">
              Define a ratio-based covenant monitored on every financial upload.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCovenant}>
            <div className="space-y-4 py-2">
              {formError && (
                <Alert variant="destructive" className="rounded-lg py-2">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{formError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="ratioName" className="text-sm font-medium">
                  Ratio <span className="text-red-500">*</span>
                </Label>
                <Select value={ratioName} onValueChange={setRatioName}>
                  <SelectTrigger id="ratioName" className="h-10">
                    <SelectValue placeholder="Select a ratio…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {sortedRatios.map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="operator" className="text-sm font-medium">Operator <span className="text-red-500">*</span></Label>
                  <Select value={operator} onValueChange={setOperator}>
                    <SelectTrigger id="operator" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATOR_OPTIONS.map(op => (
                        <SelectItem key={op.value} value={op.value}>
                          <code className="font-mono">{op.label}</code>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="threshold" className="text-sm font-medium">Threshold <span className="text-red-500">*</span></Label>
                  <Input
                    id="threshold"
                    type="number"
                    step="0.01"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    placeholder="e.g. 1.25"
                    required
                    className="h-10"
                  />
                </div>
              </div>

              {/* Preview */}
              {ratioName && threshold && (
                <div
                  className="rounded-lg px-4 py-3 text-sm"
                  style={{ background: 'oklch(0.975 0.007 80)', border: '1px solid oklch(0.895 0.010 78)' }}
                >
                  <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Preview</p>
                  <code className="font-mono text-sm text-foreground">
                    {RATIO_LABELS[ratioName] ?? ratioName}{' '}
                    <span style={{ color: '#B8860B' }}>{OPERATOR_DISPLAY[operator]}</span>{' '}
                    <strong>{threshold}</strong>
                  </code>
                </div>
              )}
            </div>

            <DialogFooter className="mt-5 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
                disabled={saving}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="flex-1"
                style={{ background: '#0D1B2A', color: '#fff' }}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : 'Add Covenant'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
