'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  TrendingUp, ArrowRight, Building2, Plus, ChevronRight,
  MoreHorizontal, Eye, Trash2, Loader2, AlertTriangle
} from 'lucide-react'
import type { Borrower, Covenant } from '@/types'

interface Props {
  borrowerList: Borrower[]
  covenantList: Covenant[]
}

export default function DashboardBorrowersTable({ borrowerList, covenantList }: Props) {
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
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden cg-fade-up cg-delay-2">
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-muted">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground text-sm">Borrower Portfolio</h2>
            <p className="text-xs text-muted-foreground">
              {borrowerList.length} borrower{borrowerList.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-xs font-medium gap-1 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
        >
          <Link href="/borrowers">
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {borrowerList.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
            <Building2 className="h-7 w-7 text-muted-foreground opacity-50" />
          </div>
          <p className="font-semibold text-foreground mb-1">No borrowers yet</p>
          <p className="text-sm text-muted-foreground mb-5">
            Add your first SME borrower to begin monitoring.
          </p>
          <Button asChild size="sm" className="bg-slate-900 text-white hover:bg-slate-800">
            <Link href="/borrowers/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Borrower
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
              <th>Loan Amount</th>
              <th>Covenants</th>
              <th>Added</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {borrowerList.slice(0, 10).map((b, i) => {
              const bCovenants = covenantList.filter(c => c.borrower_id === b.id)
              const bBreaches  = bCovenants.filter(c => c.is_breached)
              const initials   = b.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

              return (
                <tr key={b.id} className="group" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: `hsl(${(b.name.charCodeAt(0) * 17) % 360}, 25%, 90%)`,
                          color: `hsl(${(b.name.charCodeAt(0) * 17) % 360}, 40%, 35%)`,
                        }}
                      >
                        {initials}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-[13px]">{b.name}</p>
                        {b.cin && (
                          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{b.cin}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {b.industry ? <span className="text-muted-foreground">{b.industry}</span> : <span className="text-muted-foreground italic text-xs">N/A</span>}
                  </td>
                  <td>
                    {b.loan_amount ? (
                      <span className="font-semibold text-foreground">
                        ₹{b.loan_amount} Cr
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic text-xs">N/A</span>
                    )}
                  </td>
                  <td>
                    {bCovenants.length === 0 ? (
                      <span className="text-muted-foreground text-xs">None set</span>
                    ) : bBreaches.length > 0 ? (
                      <span className="badge-breach">
                        ⚠ {bBreaches.length} breach{bBreaches.length > 1 ? 'es' : ''}
                      </span>
                    ) : (
                      <span className="badge-ok">
                        ✓ {bCovenants.length} OK
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground text-xs">
                    {new Date(b.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="text-right">
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

      {/* Delete confirmation dialog */}
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
    </div>
  )
}
