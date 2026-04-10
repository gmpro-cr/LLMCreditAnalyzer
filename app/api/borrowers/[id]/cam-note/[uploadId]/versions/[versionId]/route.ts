import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ id: string; uploadId: string; versionId: string }> }

// GET — load a specific version's full snapshot
export async function GET(_req: Request, { params }: Params) {
  const { id, uploadId, versionId } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('memo_versions')
    .select('id, label, snapshot, created_at')
    .eq('id', versionId)
    .eq('upload_id', uploadId)
    .eq('borrower_id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  return NextResponse.json(data)
}
