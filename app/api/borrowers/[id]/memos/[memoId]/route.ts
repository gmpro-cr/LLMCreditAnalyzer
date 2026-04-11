import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; memoId: string }> }
) {
  const { memoId } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('financial_uploads')
    .select('memo_content, status, borrower_id, financial_year, borrowers(name)')
    .eq('id', memoId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Memo not found' }, { status: 404 })
  return NextResponse.json(data)
}
