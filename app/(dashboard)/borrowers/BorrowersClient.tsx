'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Building2, Plus, ChevronRight, Calendar, Briefcase,
  MoreHorizontal, Eye, Trash2, Loader2, AlertTriangle,
} from 'lucide-react'
import type { Borrower } from '@/types'

interface Props {
  borrowers: Borrower[]
}

export default function BorrowersClient({ borrowers }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<Borrower | null>(null)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/borrowers/${deleteTarget.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground leading-tight">
            Borrowers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {borrowers.length} borrower{borrowers.length !== 1 ? 's' : ''} in portfolio
          </p>
        </div>
        <Button asChild className="shadow-sm bg-slate-900 text-white hover:bg-slate-800">
          <Link href="/borrowers/new">
            <Plus className="h-4 w-4 mr-2" /> Add Borrower
          </Link>
        </Button>
      </div>

      {/* ── Table card ─────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-fade-up cg-delay-1">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-muted">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm">All Borrowers</span>
          </div>
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full font-medium">
            {borrowers.length} total
          </span>
        </div>

        {borrowers.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Building2 className="h-8 w-8 text-muted-foreground opacity-40" />
            </div>
            <p className="font-semibold text-foreground text-base mb-1">No borrowers added yet</p>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
              Start by adding your first SME borrower to the portfolio.
            </p>
            <Button asChild className="bg-slate-900 text-white hover:bg-slate-800">
              <Link href="/borrowers/new">
                <Plus className="h-4 w-4 mr-2" /> Add Borrower
              </Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="cg-table">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Industry</th>
                <th>Loan Type</th>
                <th>Loan Amount</th>
                <th>Sanction Date</th>
                <th style={{ width: 56 }}></th>
              </tr>
            </thead>
            <tbody>
              {borrowers.map((b, i) => {
                const initials = b.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                const hue = (b.name.charCodeAt(0) * 19 + b.name.charCodeAt(1 % b.name.length) * 7) % 360
                return (
                  <tr key={b.id} className="cg-fade-up group" style={{ animationDelay: `${0.05 + i * 0.03}s` }}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: `hsl(${hue}, 22%, 91%)`, color: `hsl(${hue}, 38%, 32%)` }}
                        >
                          {initials}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground text-[13px]">{b.name}</p>
                          {b.cin && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5 tracking-wide">{b.cin}</p>
                          )}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {(b as any).symbol && (
                            <span
                              className="text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded mt-0.5 inline-block"
                              style={{ background: '#0D1B2A', color: '#B8860B' }}
                            >
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {(b as any).symbol}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {b.industry ? (
                        <div className="flex items-center gap-1.5">
                          <Briefcase className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">{b.industry}</span>
                        </div>
                      ) : <span className="text-muted-foreground italic text-xs">N/A</span>}
                    </td>
                    <td>
                      {b.loan_type ? (
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                          style={{ background: 'oklch(0.95 0.007 80)', color: 'oklch(0.40 0.035 248)', border: '1px solid oklch(0.88 0.009 78)' }}
                        >
                          {b.loan_type}
                        </span>
                      ) : <span className="text-muted-foreground italic text-xs">N/A</span>}
                    </td>
                    <td>
                      {b.loan_amount != null
                        ? <span className="font-semibold text-foreground">₹{b.loan_amount} Cr</span>
                        : <span className="text-muted-foreground italic text-xs">N/A</span>}
                    </td>
                    <td>
                      {b.sanction_date ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                          <Calendar className="h-3 w-3" />
                          {new Date(b.sanction_date).toLocaleDateString('en-IN')}
                        </div>
                      ) : <span className="text-muted-foreground italic text-xs">N/A</span>}
                    </td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-lg opacity-60 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem asChild>
                            <Link href={`/borrowers/${b.id}`} className="flex items-center gap-2 cursor-pointer">
                              <Eye className="h-3.5 w-3.5" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                            onClick={() => setDeleteTarget(b)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Delete confirmation dialog ──────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md" showCloseButton={!deleting}>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-50 border border-red-200">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <DialogTitle className="text-base">Delete Borrower</DialogTitle>
            </div>
            <DialogDescription className="text-sm leading-relaxed pl-[52px]">
              This will permanently delete{' '}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span>{' '}
              and all associated data — financial uploads, ratios, memos, and covenants.
              <br /><br />
              <span className="font-medium text-red-600">This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmDelete}
              disabled={deleting}
              className="text-xs min-w-[120px] bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Trash2 className="h-3.5 w-3.5" /> Delete Permanently
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
