import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string; uploadId: string }> }

// GET — list all saved versions for this upload (id + label + created_at only)
export async function GET(_req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('memo_versions')
    .select('id, label, created_at')
    .eq('upload_id', uploadId)
    .eq('borrower_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data ?? [] })
}

// POST — save current sections as a named version
export async function POST(req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const label    = (body.label as string) || 'Draft'
  const snapshot = body.snapshot

  if (!snapshot) return NextResponse.json({ error: 'snapshot required' }, { status: 400 })

  const { error } = await supabase
    .from('memo_versions')
    .insert({
      id:          randomUUID(),
      upload_id:   uploadId,
      borrower_id: id,
      label,
      snapshot,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
