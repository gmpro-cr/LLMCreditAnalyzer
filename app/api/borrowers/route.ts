import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('borrowers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const { data, error } = await supabase
    .from('borrowers')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If a BSE/NSE symbol is provided, trigger background public data fetch
  const symbol = body.symbol?.trim()?.toUpperCase()
  if (symbol && data) {
    const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'
    // Fire-and-forget: fetch public data and cache on the borrower record
    ;(async () => {
      try {
        const res = await fetch(`${pythonUrl}/public-data/fetch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            company_name: body.name,
            industry: body.industry || 'Manufacturing',
            process_annual_report: true,
          }),
        })
        if (res.ok) {
          const pub = await res.json()
          // Store public data (stock + screener + peers) on the borrower
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newId = (data as any).id as string
          await supabase
            .from('borrowers')
            .update({ public_data: pub })
            .eq('id', newId)

          // If annual report was processed, save as a financial upload
          if (pub.financials && pub.ratios) {
            await supabase.from('financial_uploads').insert({
              borrower_id: newId,
              financial_year: pub.financials?.company_info?.financial_year || 'Auto-fetched',
              status: 'complete',
              extracted_data: pub.financials,
              ratios: pub.ratios,
              memo_content: pub.memo_content || '',
              upload_date: new Date().toISOString(),
            })
          }
        }
      } catch (e) {
        console.warn('[PublicData] Background fetch failed:', e)
      }
    })()
  }

  return NextResponse.json(data, { status: 201 })
}
