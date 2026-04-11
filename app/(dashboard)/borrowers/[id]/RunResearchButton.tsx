'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Search, Loader2 } from 'lucide-react'

interface Props {
  borrowerId: string
}

export default function RunResearchButton({ borrowerId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const router = useRouter()

  async function handleRun() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/borrowers/${borrowerId}/run-research`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Research failed')
        return
      }
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
        variant="outline"
        onClick={handleRun}
        disabled={loading}
        className="text-xs font-medium"
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Researching…
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Run Research
          </span>
        )}
      </Button>
      {error && <p className="text-[10px] text-red-500 max-w-[200px] text-right">{error}</p>}
      {loading && (
        <p className="text-[10px] text-muted-foreground">Running iterative research loop… ~2 min</p>
      )}
    </div>
  )
}
