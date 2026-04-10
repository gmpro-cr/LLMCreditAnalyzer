import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  // Get the latest completed upload for this borrower
  const { data: uploads } = await supabase
    .from('financial_uploads')
    .select('extracted_data, ratios')
    .eq('borrower_id', id)
    .eq('status', 'complete')
    .order('upload_date', { ascending: false })

  if (!uploads || (uploads as unknown[]).length === 0) {
    return NextResponse.json({ flags: [], high_count: 0, medium_count: 0, low_count: 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latest = (uploads as any[])[0]
  const ratios     = latest.ratios     ?? {}
  const financials = latest.extracted_data ?? {}

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'
  try {
    const pyRes = await fetch(`${pythonUrl}/risk-flags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratios, financials }),
    })
    if (!pyRes.ok) return NextResponse.json({ flags: [] })
    return NextResponse.json(await pyRes.json())
  } catch {
    return NextResponse.json({ flags: [] })
  }
}
