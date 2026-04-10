'use client'
import { useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import {
  ArrowLeft, UploadCloud, FileText, CheckCircle2, XCircle,
  Circle, AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RatioData } from '@/types'
import { RATIO_LABELS, RATIO_BENCHMARKS } from '@/types'

const UPLOAD_STEPS = [
  { label: 'Uploading File', desc: 'Transferring document to server' },
  { label: 'Extracting Balance Sheet', desc: 'Parsing assets & liabilities' },
  { label: 'Extracting P&L Statement', desc: 'Parsing revenue & expenses' },
  { label: 'Computing Ratios', desc: 'Calculating 24 financial metrics' },
  { label: 'Researching Company', desc: 'Searching news, promoters & industry context' },
  { label: 'Analysing Industry Context', desc: 'Gathering competitive intelligence' },
  { label: 'Generating Credit Memo', desc: 'AI writing enriched CAM report' },
  { label: 'Analysis Complete', desc: 'All data saved successfully' },
]

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

interface UploadResult {
  upload_id: string
  ratios: RatioData
  memo_content: string
}

interface PageProps {
  params: Promise<{ id: string }>
}

const TOP_RATIOS = ['current_ratio', 'debt_equity', 'dscr', 'ebitda_margin', 'roe', 'debtor_days']

const RATIO_STATUS_STYLES = {
  green: { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803D', dot: '#22C55E' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', dot: '#F59E0B' },
  red:   { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', dot: '#EF4444' },
}

export default function UploadPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const [financialYear, setFinancialYear] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<UploadResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(f: File | null) {
    if (!f) return
    const isValidType = f.type === 'application/pdf' ||
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      f.name.toLowerCase().endsWith('.xlsx')
    if (!isValidType) { setError('Only PDF or Excel (.xlsx) files are supported.'); return }
    if (f.size > 50 * 1024 * 1024) { setError('File size must be under 50MB.'); return }
    setError('')
    setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFileChange(e.dataTransfer.files[0])
  }

  async function simulateProgress(startStep: number, endStep: number, durationMs: number) {
    const steps = endStep - startStep
    const intervalMs = durationMs / steps
    for (let i = startStep; i <= endStep; i++) {
      setCurrentStep(i)
      setProgress(Math.round((i / (UPLOAD_STEPS.length - 1)) * 100))
      if (i < endStep) await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Please select a PDF or Excel (.xlsx) file.'); return }
    if (!financialYear.trim()) { setError('Please enter a financial year.'); return }

    setError(''); setUploading(true); setCurrentStep(0); setProgress(0)
    // Simulate extract steps (0-3), then research (4-5), then memo (6) with different timings
    const progressPromise = simulateProgress(0, 3, 5000)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('financial_year', financialYear.trim())
    formData.append('company_name', '')

    try {
      const res = await fetch(`/api/borrowers/${id}/upload`, { method: 'POST', body: formData })
      await progressPromise
      await simulateProgress(4, 6, 25000) // research takes ~20-30s

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Upload failed' }))
        setError(data.error || 'Upload failed. Please try again.')
        setUploading(false); setCurrentStep(-1); return
      }
      const data: UploadResult = await res.json()
      setCurrentStep(UPLOAD_STEPS.length - 1)
      setProgress(100)
      setResult(data)
    } catch (err) {
      setError(String(err) || 'An unexpected error occurred.')
      setUploading(false); setCurrentStep(-1)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 cg-fade-in">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
          <Link href={`/borrowers/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Borrower
          </Link>
        </Button>

        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-scale-in">
          {/* Success header */}
          <div
            className="px-7 py-6 flex items-center gap-4"
            style={{ borderBottom: '1px solid #BBF7D0', background: '#F0FDF4' }}
          >
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">Analysis Complete</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Financial statement processed for FY {financialYear}
              </p>
            </div>
          </div>

          <div className="px-7 py-6 space-y-6">
            {/* Key ratios */}
            {result.ratios && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Key Financial Ratios
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {TOP_RATIOS.map(key => {
                    const val = result.ratios[key]
                    if (val == null) return null
                    const status = getRatioStatus(key, val)
                    const s = RATIO_STATUS_STYLES[status]
                    return (
                      <div
                        key={key}
                        className="rounded-lg p-3.5"
                        style={{ background: s.bg, border: `1px solid ${s.border}` }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium" style={{ color: s.text, opacity: 0.8 }}>
                            {RATIO_LABELS[key] ?? key}
                          </p>
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: s.dot }}
                          />
                        </div>
                        <p className="text-xl font-bold font-display" style={{ color: s.text }}>
                          {val.toFixed(2)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div
              className="flex items-center gap-3 pt-4"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              {result.memo_content && (
                <Button asChild style={{ background: '#0D1B2A', color: '#fff' }}>
                  <Link href={`/borrowers/${id}/memos/${result.upload_id}`}>
                    <FileText className="h-4 w-4 mr-2" />
                    View CAM Memo
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null); setFile(null); setFinancialYear('')
                  setCurrentStep(-1); setProgress(0); setUploading(false)
                }}
              >
                Upload Another
              </Button>
              <Button variant="ghost" asChild>
                <Link href={`/borrowers/${id}`}>Back to Borrower</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Upload form ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 cg-fade-in">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
        <Link href={`/borrowers/${id}`}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Borrower
        </Link>
      </Button>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-scale-in">
        {/* Card header */}
        <div
          className="px-7 py-6"
          style={{ borderBottom: '1px solid var(--border)', background: 'oklch(0.978 0.006 78)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
              style={{ background: '#0D1B2A' }}
            >
              <UploadCloud className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold text-foreground">Upload Financial Statement</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                PDF → Balance Sheet · P&L · Ratios · CAM Memo
              </p>
            </div>
          </div>
        </div>

        <div className="px-7 py-7">
          {uploading ? (
            /* ── Progress view ── */
            <div className="space-y-8 py-2">
              {/* Progress bar */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-foreground">
                    {currentStep >= 0 ? UPLOAD_STEPS[currentStep].label : 'Preparing...'}
                  </span>
                  <span
                    className="text-xs font-bold font-mono"
                    style={{ color: '#B8860B' }}
                  >
                    {progress}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${progress}%`,
                      background: 'linear-gradient(90deg, #0D1B2A, #B8860B)',
                    }}
                  />
                </div>
              </div>

              {/* Steps list */}
              <div className="space-y-1">
                {UPLOAD_STEPS.slice(0, -1).map((step, i) => {
                  const done    = i < currentStep
                  const active  = i === currentStep
                  const pending = i > currentStep
                  return (
                    <div
                      key={step.label}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 rounded-lg transition-all',
                        active  ? 'bg-muted' : ''
                      )}
                    >
                      <div className="shrink-0 mt-0.5">
                        {done ? (
                          <CheckCircle2 className="h-4.5 w-4.5 text-green-500" />
                        ) : active ? (
                          <div
                            className="h-4.5 w-4.5 rounded-full border-2 border-t-transparent animate-spin"
                            style={{ borderColor: '#B8860B', borderTopColor: 'transparent' }}
                          />
                        ) : (
                          <Circle className="h-4.5 w-4.5 text-muted-foreground opacity-30" />
                        )}
                      </div>
                      <div>
                        <p
                          className={cn(
                            'text-sm font-medium',
                            done    ? 'text-green-600' :
                            active  ? 'text-foreground' :
                                      'text-muted-foreground'
                          )}
                        >
                          {step.label}
                        </p>
                        {(active || done) && (
                          <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground text-center pb-2">
                Processing may take 1–2 minutes depending on document size.
              </p>
            </div>
          ) : (
            /* ── Form view ── */
            <form onSubmit={handleUpload} className="space-y-5">
              {error && (
                <Alert variant="destructive" className="rounded-lg">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="fy" className="text-sm font-medium">
                  Financial Year <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fy"
                  value={financialYear}
                  onChange={e => setFinancialYear(e.target.value)}
                  placeholder="e.g. 2023-24"
                  required
                  className="h-10 w-40"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Financial Statement PDF or Excel (.xlsx) <span className="text-red-500">*</span>
                </Label>
                <div
                  className={cn(
                    'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200',
                    dragOver
                      ? 'border-[#B8860B] bg-amber-50'
                      : file
                        ? 'border-green-400 bg-green-50'
                        : 'border-border hover:border-muted-foreground/40 bg-muted/30'
                  )}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {file ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mx-auto">
                        <FileText className="h-6 w-6 text-green-600" />
                      </div>
                      <p className="font-semibold text-green-700 text-sm">{file.name}</p>
                      <p className="text-xs text-green-600">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        <span className="text-green-400 ml-2">· Click to replace</span>
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                        <UploadCloud className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Drop PDF or Excel here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">PDF or Excel (.xlsx) · Max 50MB</p>
                      </div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
                />
              </div>

              {/* Info banner */}
              <div
                className="flex items-start gap-3 rounded-lg px-4 py-3 text-xs"
                style={{ background: 'oklch(0.97 0.006 248)', border: '1px solid oklch(0.90 0.015 248)' }}
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                <p className="text-muted-foreground leading-relaxed">
                  The system extracts Balance Sheet, P&L &amp; Cash Flow, computes 24 financial ratios,
                  then <strong>researches the company online</strong> (news, promoters, industry) to write
                  a richer, more contextual Credit Appraisal Memorandum.
                </p>
              </div>

              <div
                className="flex items-center gap-3 pt-4"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <Button
                  type="submit"
                  disabled={!file || !financialYear.trim()}
                  className="px-6"
                  style={{ background: '#0D1B2A', color: '#fff' }}
                >
                  <UploadCloud className="h-4 w-4 mr-2" />
                  Upload &amp; Analyse
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href={`/borrowers/${id}`}>Cancel</Link>
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
