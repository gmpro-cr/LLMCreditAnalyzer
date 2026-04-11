'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'
import { ArrowLeft, Building2, XCircle, Search, CheckCircle2, TrendingUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const INDUSTRIES = [
  'Manufacturing', 'Trading', 'Services', 'Construction',
  'Real Estate', 'Healthcare', 'Education', 'Hospitality',
  'Building Materials', 'Pharmaceuticals', 'Chemicals', 'FMCG',
  'Information Technology', 'Textiles', 'Auto Components', 'Other',
]
const LOAN_TYPES = ['Term Loan', 'Cash Credit', 'Overdraft', 'LC/BG', 'Working Capital']

interface CompanyResult {
  symbol: string
  full_symbol: string
  name: string
  exchange: string
  industry: string
  sector: string
}

export default function NewBorrowerPage() {
  const [name, setName] = useState('')
  const [cin, setCin] = useState('')
  const [industry, setIndustry] = useState('')
  const [loanType, setLoanType] = useState('')
  const [loanAmount, setLoanAmount] = useState('')
  const [sanctionDate, setSanctionDate] = useState('')
  const [symbol, setSymbol] = useState('')
  const [isListed, setIsListed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<CompanyResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  const nameRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  // Debounced search
  const searchCompanies = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/search-companies?q=${encodeURIComponent(q)}`)
      const data: CompanyResult[] = res.ok ? await res.json() : []
      setSuggestions(data)
      setShowDropdown(data.length > 0)
      setActiveIdx(-1)
    } catch {
      setSuggestions([])
    } finally {
      setSearching(false)
    }
  }, [])

  function handleNameChange(val: string) {
    setName(val)
    // If user edited name after selecting a listed company, clear the listed flag
    if (isListed) { setIsListed(false); setSymbol('') }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchCompanies(val), 300)
  }

  function selectCompany(c: CompanyResult) {
    setName(c.name)
    setSymbol(c.symbol)
    setIsListed(true)
    if (c.industry && !industry) setIndustry(c.industry.includes('Building') ? 'Building Materials' : INDUSTRIES.find(i => i.toLowerCase().includes(c.industry.toLowerCase().split(' ')[0])) || 'Manufacturing')
    setSuggestions([])
    setShowDropdown(false)
    setActiveIdx(-1)
    nameRef.current?.blur()
  }

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectCompany(suggestions[activeIdx]) }
    if (e.key === 'Escape') { setShowDropdown(false) }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node) && !nameRef.current?.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const payload: Record<string, unknown> = { name: name.trim() }
    if (cin.trim())    payload.cin = cin.trim().toUpperCase()
    if (industry)      payload.industry = industry
    if (loanType)      payload.loan_type = loanType
    if (loanAmount)    payload.loan_amount = parseFloat(loanAmount)
    if (sanctionDate)  payload.sanction_date = sanctionDate
    if (symbol.trim()) payload.symbol = symbol.trim().toUpperCase()

    const res = await fetch('/api/borrowers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to add borrower'); setLoading(false); return }
    router.push(`/borrowers/${data.id}`)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 cg-fade-in">
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
        <Link href="/borrowers">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Borrowers
        </Link>
      </Button>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-scale-in">
        {/* Card header */}
        <div
          className="px-7 py-6 border-b border-border bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm bg-slate-900">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold text-foreground">Add New Borrower</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Type company name — listed companies auto-detected from NSE/BSE
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="px-7 py-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert variant="destructive" className="rounded-lg">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Company Name with smart autocomplete */}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm font-medium">
                Company Name <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                {/* Input row */}
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    {searching
                      ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                      : isListed
                        ? <TrendingUp className="h-4 w-4 text-yellow-600" />
                        : <Search className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <Input
                    id="name"
                    ref={nameRef}
                    value={name}
                    onChange={e => handleNameChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                    required
                    autoComplete="off"
                    placeholder="e.g. Reliance Industries, Sahyadri Industries..."
                    className="h-10 pl-9 pr-3"
                  />
                  {isListed && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono bg-slate-900 text-yellow-600"
                      >
                        {symbol}
                      </span>
                    </div>
                  )}
                </div>

                {/* Dropdown */}
                {showDropdown && suggestions.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
                    style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                  >
                    <div
                      className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground border-b border-border bg-slate-50/50"
                    >
                      Listed Companies — NSE / BSE
                    </div>
                    {suggestions.map((c, i) => (
                      <button
                        key={c.full_symbol}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); selectCompany(c) }}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                          i === activeIdx ? 'bg-muted' : 'hover:bg-muted/60',
                          i < suggestions.length - 1 ? 'border-b border-border' : ''
                        )}
                      >
                        {/* Symbol badge */}
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold font-mono bg-slate-900 text-yellow-600"
                        >
                          {c.symbol.slice(0, 4)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono">{c.symbol}</span>
                            <span
                              className="text-[9px] font-medium px-1.5 py-0.5 rounded"
                              style={{
                                background: c.exchange === 'NSE' ? '#EFF6FF' : '#FFF7ED',
                                color: c.exchange === 'NSE' ? '#1D4ED8' : '#C2410C',
                              }}
                            >
                              {c.exchange}
                            </span>
                            {c.industry && (
                              <span className="text-[10px] text-muted-foreground truncate">{c.industry}</span>
                            )}
                          </div>
                        </div>
                        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                    <div
                      className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border bg-slate-50/50"
                    >
                      Select to auto-fill details · data from NSE/BSE via Yahoo Finance
                    </div>
                  </div>
                )}
              </div>

              {/* Listed company info banner */}
              {isListed && (
                <div
                  className="flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-xs cg-scale-in bg-green-50 border border-green-200"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-green-700">
                    <strong>Listed company detected.</strong> Stock data, promoter info, and annual report
                    will be fetched automatically from NSE/BSE after saving.
                  </p>
                </div>
              )}
            </div>

            {/* CIN + Industry row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cin" className="text-sm font-medium">
                  CIN <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="cin"
                  value={cin}
                  onChange={e => setCin(e.target.value)}
                  placeholder="U74999MH2010PTC123456"
                  maxLength={21}
                  className="h-10 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="industry" className="text-sm font-medium">
                  Industry <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger id="industry" className="h-10">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map(ind => (
                      <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Loan Type + Amount row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="loanType" className="text-sm font-medium">
                  Loan Type <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select value={loanType} onValueChange={setLoanType}>
                  <SelectTrigger id="loanType" className="h-10">
                    <SelectValue placeholder="Select loan type" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map(lt => (
                      <SelectItem key={lt} value={lt}>{lt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loanAmount" className="text-sm font-medium">
                  Loan Amount (Crores) <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">₹</span>
                  <Input
                    id="loanAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 h-10"
                  />
                </div>
              </div>
            </div>

            {/* Sanction Date */}
            <div className="space-y-1.5">
              <Label htmlFor="sanctionDate" className="text-sm font-medium">
                Sanction Date <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="sanctionDate"
                type="date"
                value={sanctionDate}
                onChange={e => setSanctionDate(e.target.value)}
                className="h-10 w-48"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-3 border-t border-border w-full mt-4">
              <div 
                title={!name.trim() ? "Company Name is required" : ""}
                className="inline-block"
              >
              <Button
                type="submit"
                disabled={loading || !name.trim()}
                className="px-6 bg-slate-900 text-white hover:bg-slate-800"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : (
                  isListed ? 'Add & Fetch Public Data' : 'Add Borrower'
                )}
              </Button>
              </div>
              <Button type="button" variant="outline" asChild>
                <Link href="/borrowers">Cancel</Link>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
