import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

/**
 * POST /api/borrowers/:id/run-research
 * Run the Karpathy-style autoresearch loop for any borrower (listed or not).
 * Saves results into the latest upload's extracted_data._research,
 * or into borrower.public_data._research if no upload exists yet.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: borrower, error } = await supabase
    .from('borrowers')
    .select('id, name, industry, public_data')
    .eq('id', id)
    .single()

  if (error || !borrower) {
    return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = borrower as any
  const company_name: string = b.name
  const industry: string     = b.industry || 'Manufacturing'
  const pythonUrl            = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  // Fetch 3-year financial snapshot from latest upload (if any) to ground the research
  const { data: uploads } = await supabase
    .from('financial_uploads')
    .select('id, extracted_data')
    .eq('borrower_id', id)
    .eq('status', 'complete')
    .order('financial_year', { ascending: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestUpload = (uploads as any)?.[0] ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = (latestUpload as any)?.extracted_data as any
  const financials_snapshot = fin ? {
    years:   fin.profit_loss?.years   || [],
    revenue: fin.profit_loss?.revenue || [],
    pat:     fin.profit_loss?.pat     || [],
    debt:    fin.balance_sheet?.borrowings || [],
  } : {}

  try {
    const res = await fetch(`${pythonUrl}/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name, industry, financials_snapshot }),
      signal: AbortSignal.timeout(180_000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as { detail?: string }).detail || 'Research failed' },
        { status: 500 }
      )
    }

    const research = await res.json()
    const _research = {
      brief:                        research.brief                        || '',
      sources:                      research.sources                      || [],
      queries_run:                  research.queries_run                  || [],
      round_summaries:              research.round_summaries              || [],
      research_completeness_score:  research.research_completeness_score  ?? 0,
      dimension_scores:             research.dimension_scores             || {},
    }

    if (latestUpload) {
      // Merge into the latest upload's extracted_data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uploadId = (latestUpload as any).id
      await supabase
        .from('financial_uploads')
        .update({
          extracted_data: { ...(fin || {}), _research },
        })
        .eq('id', uploadId)
    } else {
      // No upload yet — cache on borrower.public_data
      await supabase
        .from('borrowers')
        .update({
          public_data: { ...(b.public_data || {}), _research },
        })
        .eq('id', id)
    }

    return NextResponse.json({ research: _research })
  } catch (e) {
    console.error('[RunResearch] Error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
