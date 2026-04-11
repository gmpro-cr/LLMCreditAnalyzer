import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

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

  const { memo_content, company_name } = await req.json()
  if (!memo_content) {
    return NextResponse.json({ error: 'memo_content is required' }, { status: 400 })
  }

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  const res = await fetch(`${pythonUrl}/export-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memo_content,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      company_name: company_name || (borrower as any).name,
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }

  const blob = await res.arrayBuffer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeName = (company_name || (borrower as any).name || 'Borrower').replace(/[^a-zA-Z0-9]/g, '_')

  return new NextResponse(blob, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="CAM_${safeName}.docx"`,
    },
  })
}
