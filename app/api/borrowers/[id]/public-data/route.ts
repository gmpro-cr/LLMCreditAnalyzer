import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// GET — return cached public data for a borrower
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: borrower, error } = await supabase
    .from('borrowers')
    .select('id, name, symbol, public_data, industry')
    .eq('id', id)
    .single()

  if (error || !borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(borrower)
}

// POST — trigger a fresh public data fetch + optionally refresh stock quote
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const body = await req.json().catch(() => ({}))

  const { data: borrower, error } = await supabase
    .from('borrowers')
    .select('id, name, symbol, industry')
    .eq('id', id)
    .single()

  if (error || !borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = borrower as any
  const symbol = (body.symbol || b.symbol || '').toUpperCase()
  const company_name: string = b.name
  const industry: string = b.industry || 'Manufacturing'

  if (!symbol) return NextResponse.json({ error: 'No symbol set for this borrower' }, { status: 400 })

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  try {
    const res = await fetch(`${pythonUrl}/public-data/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, company_name, industry, process_annual_report: body.process_annual_report ?? false }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.detail || 'Fetch failed' }, { status: 500 })
    }

    const pub = await res.json()

    // Update cached public_data on borrower
    await supabase.from('borrowers').update({ public_data: pub, symbol }).eq('id', id)

    return NextResponse.json(pub)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
