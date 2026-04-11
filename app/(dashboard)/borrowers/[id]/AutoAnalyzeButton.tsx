'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2 } from 'lucide-react'

interface Props {
  borrowerId: string
  symbol: string
}

export default function AutoAnalyzeButton({ borrowerId, symbol }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleAnalyze() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/borrowers/${borrowerId}/auto-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Auto-analysis failed')
        return
      }
      // Refresh the page to show the new memo
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        onClick={handleAnalyze}
        disabled={loading}
        className="text-xs font-medium"
        style={{ background: 'linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)', color: '#B8860B' }}
        title={`Auto-generate credit memo from NSE/BSE public data for ${symbol}`}
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Analyzing…
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Auto-Analyze ({symbol})
          </span>
        )}
      </Button>
      {error && (
        <p className="text-[10px] text-red-500 max-w-[200px] text-right">{error}</p>
      )}
      {loading && (
        <p className="text-[10px] text-muted-foreground">
          Fetching financials + running research… ~60s
        </p>
      )}
    </div>
  )
}
