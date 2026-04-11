'use client'

import { useEffect, useState, use } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download, CheckCircle, FileText, ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MemoPage({ params }: { params: Promise<{ id: string; memoId: string }> }) {
  const { id, memoId } = use(params)
  const [memoContent, setMemoContent] = useState<string>('')
  const [companyName, setCompanyName] = useState<string>('')
  const [financialYear, setFinancialYear] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/borrowers/${id}/memos/${memoId}`)
      const data = await res.json()

      if (!res.ok || !data) { setError('Memo not found'); setLoading(false); return }
      setMemoContent(data.memo_content || '')
      setStatus(data.status)
      setFinancialYear(data.financial_year || '')
      const borrower = (Array.isArray(data.borrowers) ? data.borrowers[0] : data.borrowers) as { name: string } | null
      setCompanyName(borrower?.name || 'Unknown')
      setLoading(false)
    }
    load()
  }, [id, memoId])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetch(`/api/borrowers/${id}/memos/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_content: memoContent, company_name: companyName }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_${financialYear}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to export. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading memo...</span>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/borrowers/${id}`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Credit Appraisal Memorandum
            </h1>
            <p className="text-sm text-slate-500">
              {companyName}{financialYear ? ` · FY ${financialYear}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status === 'complete' && (
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle className="h-3 w-3 mr-1" /> Complete
            </Badge>
          )}
          <Button onClick={handleExport} disabled={exporting || !memoContent} size="sm">
            {exporting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exporting...</>
            ) : (
              <><Download className="h-4 w-4 mr-2" />Download .docx</>
            )}
          </Button>
        </div>
      </div>

      {/* Memo content */}
      {memoContent ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {/* Watermark bar */}
          <div className="flex items-center justify-between px-8 py-3 border-b border-slate-100 bg-slate-50 rounded-t-xl">
            <span className="text-xs font-semibold text-slate-500 tracking-widest uppercase">
              Confidential — Credit Appraisal Memorandum
            </span>
            <span className="text-xs text-slate-400">CreditGuard AI</span>
          </div>

          <div className="px-10 py-8 cam-memo">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold text-slate-900 mb-1 mt-0 pb-3 border-b-2 border-blue-700">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-bold text-blue-800 mt-8 mb-3 pb-1.5 border-b border-blue-200 uppercase tracking-wide">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold text-slate-800 mt-5 mb-2">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-sm font-semibold text-slate-700 mt-4 mb-1">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-slate-700 leading-relaxed mb-3">{children}</p>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="w-full text-sm border-collapse border border-slate-300 rounded-lg overflow-hidden">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-slate-800 text-white">{children}</thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-slate-200">{children}</tbody>
                ),
                tr: ({ children }) => (
                  <tr className="even:bg-slate-50 hover:bg-blue-50 transition-colors">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2.5 text-slate-700 border-slate-200">{children}</td>
                ),
                hr: () => (
                  <hr className="my-6 border-slate-200" />
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-slate-900">{children}</strong>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-1 mb-3 text-sm text-slate-700">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-1 mb-3 text-sm text-slate-700">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="leading-relaxed">{children}</li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-blue-400 pl-4 italic text-slate-600 my-3">{children}</blockquote>
                ),
              }}
            >
              {memoContent}
            </ReactMarkdown>
          </div>

          <div className="px-8 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Generated by CreditGuard AI · For internal use only
            </span>
            <Button onClick={handleExport} disabled={exporting} variant="outline" size="sm">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .docx
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center text-slate-500">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No memo content available</p>
          <p className="text-sm mt-1">Status: <strong>{status}</strong></p>
        </div>
      )}
    </div>
  )
}
