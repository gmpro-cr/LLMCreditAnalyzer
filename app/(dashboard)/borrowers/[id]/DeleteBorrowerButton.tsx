'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function DeleteBorrowerButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setLoading(true)
    try {
      await fetch(`/api/borrowers/${id}`, { method: 'DELETE' })
      router.push('/borrowers')
    } finally {
      setLoading(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-600 font-medium">Delete {name}?</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={loading}
          className="h-7 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm Delete'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(false)}
          className="h-7 px-3 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setConfirming(true)}
      className="h-8 px-3 text-xs text-muted-foreground hover:text-red-600 hover:bg-red-50"
    >
      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
    </Button>
  )
}
