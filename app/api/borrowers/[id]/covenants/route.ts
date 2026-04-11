import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('covenants')
    .select('*')
    .eq('borrower_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const { ratio_name, operator, threshold } = body

  if (!ratio_name || !operator || threshold == null) {
    return NextResponse.json(
      { error: 'ratio_name, operator, and threshold are required' },
      { status: 400 }
    )
  }

  const validOperators = ['gt', 'lt', 'gte', 'lte']
  if (!validOperators.includes(operator)) {
    return NextResponse.json(
      { error: `operator must be one of: ${validOperators.join(', ')}` },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('covenants')
    .insert({
      borrower_id: id,
      ratio_name,
      operator,
      threshold: Number(threshold),
      is_breached: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { searchParams } = new URL(req.url)
  const covenantId = searchParams.get('covenant_id')
  if (!covenantId) {
    return NextResponse.json({ error: 'covenant_id query param required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('covenants')
    .delete()
    .eq('id', covenantId)
    .eq('borrower_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
