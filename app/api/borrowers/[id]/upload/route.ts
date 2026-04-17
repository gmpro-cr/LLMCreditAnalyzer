import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: borrower, error: borrowerError } = await supabase
    .from('borrowers')
    .select('id, name')
    .eq('id', id)
    .single()

  if (borrowerError || !borrower) {
    return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const financialYear = formData.get('financial_year') as string
  const companyNameOverride = formData.get('company_name') as string

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!financialYear) return NextResponse.json({ error: 'financial_year is required' }, { status: 400 })

  // Create upload record with processing status
  const { data: upload, error: insertError } = await supabase
    .from('financial_uploads')
    .insert({
      borrower_id: id,
      financial_year: financialYear,
      status: 'processing',
      upload_date: new Date().toISOString(),
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Forward to Python service
  const pyFormData = new FormData()
  pyFormData.append('file', file)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pyFormData.append('company_name', companyNameOverride || (borrower as any).name || '')

  try {
    const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

    // Extract financials
    const pyRes = await fetch(`${pythonUrl}/extract`, {
      method: 'POST',
      body: pyFormData,
    })

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({ detail: 'Python service error' }))
      await supabase
        .from('financial_uploads')
        .update({ status: 'failed' })
        .eq('id', (upload as any).id)
      return NextResponse.json({ error: err.detail || 'Extraction failed' }, { status: 500 })
    }

    const { financials, ratios, company_name } = await pyRes.json()

    // Run autoresearch to enrich the memo with web intelligence
    let researchBrief = ''
    let researchSources: { title: string; url: string }[] = []
    let researchQueries: string[] = []
    let researchRounds:  string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let researchData:    any      = null
    try {
      const industry = financials?.company_info?.industry || 'Manufacturing'
      const researchRes = await fetch(`${pythonUrl}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name, industry }),
        signal: AbortSignal.timeout(120_000),
      })
      if (researchRes.ok) {
        researchData    = await researchRes.json()
        researchBrief   = researchData.brief           || ''
        researchSources = researchData.sources         || []
        researchQueries = researchData.queries_run     || []
        researchRounds  = researchData.round_summaries || []
      }
    } catch (e) {
      // Research is best-effort — don't fail the upload if it errors
      console.warn('Research step failed:', e)
    }

    // Generate credit memo (enriched with research brief)
    const memoRes = await fetch(`${pythonUrl}/generate-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ financials, ratios, company_name, research_brief: researchBrief }),
    })
    const memoData = memoRes.ok
      ? await memoRes.json()
      : { memo_content: '' }

    // Embed research metadata into extracted_data so it persists and can be displayed
    const enrichedFinancials = researchBrief
      ? { ...financials, _research: {
          brief:                       researchBrief,
          sources:                     researchSources,
          queries_run:                 researchQueries,
          round_summaries:             researchRounds,
          research_completeness_score: (researchData as any)?.research_completeness_score ?? 0,
          dimension_scores:            (researchData as any)?.dimension_scores ?? {},
        }}
      : financials

    // Persist results to Supabase
    await supabase
      .from('financial_uploads')
      .update({
        extracted_data: enrichedFinancials,
        ratios,
        memo_content: memoData.memo_content || '',
        status: 'complete',
      })
      .eq('id', (upload as any).id)

    // Re-evaluate existing covenants against new ratios
    const { data: covenants } = await supabase
      .from('covenants')
      .select('*')
      .eq('borrower_id', id)

    if (covenants && (covenants as any).length > 0) {
      const evalRes = await fetch(`${pythonUrl}/evaluate-covenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratios, covenants }),
      })
      if (evalRes.ok) {
        const { results } = await evalRes.json()
        for (const result of results) {
          await supabase
            .from('covenants')
            .update({
              is_breached: result.is_breached,
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', result.id)
        }
      }
    }

    return NextResponse.json({
      upload_id: (upload as any).id,
      financials,
      ratios,
      memo_content: memoData.memo_content,
    })
  } catch (err) {
    await supabase
      .from('financial_uploads')
      .update({ status: 'failed' })
      .eq('id', (upload as any).id)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
