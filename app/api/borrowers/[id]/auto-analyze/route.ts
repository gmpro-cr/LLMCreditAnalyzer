import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const maxDuration = 60

/**
 * POST /api/borrowers/:id/auto-analyze
 * For listed companies: fetch Screener.in financials + run web research + generate CAM memo.
 * No PDF upload required. Saves the generated memo as a financial_uploads record.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: borrower, error } = await supabase
    .from('borrowers')
    .select('id, name, symbol, industry, public_data')
    .eq('id', id)
    .single()

  if (error || !borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = borrower as any
  const symbol: string = (b.symbol || '').toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'No stock symbol set for this borrower. Please set a symbol first.' }, { status: 400 })

  const company_name: string = b.name
  const industry: string = b.industry || 'Manufacturing'
  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  try {
    const res = await fetch(`${pythonUrl}/public-data/generate-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, company_name, industry }),
      // Allow up to 3 minutes (research + memo generation)
      signal: AbortSignal.timeout(300_000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: (err as { detail?: string }).detail || 'Auto-analysis failed' }, { status: 500 })
    }

    const result = await res.json()

    // Save as a financial_uploads record
    const { data: upload, error: uploadErr } = await supabase
      .from('financial_uploads')
      .insert({
        borrower_id: id,
        financial_year: result.financials?.company_info?.financial_year || 'Auto-fetched',
        status: 'complete',
        extracted_data: result.financials,
        ratios: result.ratios,
        memo_content: result.memo_content || '',
        upload_date: new Date().toISOString(),
        source: 'public_data',
      })
      .select()
      .single()

    if (uploadErr) {
      console.warn('[AutoAnalyze] Failed to save upload:', uploadErr)
    }

    // Also cache screener financials on the borrower
    await supabase
      .from('borrowers')
      .update({
        public_data: {
          ...(b.public_data || {}),
          screener_financials: result.financials,
          stock: result.stock,
          is_listed: true,
        },
      })
      .eq('id', id)

    return NextResponse.json({
      upload_id: (upload as { id?: string } | null)?.id,
      memo_content: result.memo_content,
      financials: result.financials,
      ratios: result.ratios,
      stock: result.stock,
      research_used: result.research_used,
    })
  } catch (e) {
    console.error('[AutoAnalyze] Error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
