import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import CamNoteEditor from './CamNoteEditor'

interface PageProps {
  params: Promise<{ id: string; uploadId: string }>
}

export default async function CamNotePage({ params }: PageProps) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const [{ data: borrower }, { data: upload }] = await Promise.all([
    supabase.from('borrowers').select('id, name, industry').eq('id', id).single(),
    supabase
      .from('financial_uploads')
      .select('id, financial_year, extracted_data, ratios, memo_content, status')
      .eq('id', uploadId)
      .eq('borrower_id', id)
      .single(),
  ])

  if (!borrower || !upload) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b   = borrower as any
  const u   = upload   as any
  const ext = u.extracted_data ?? {}

  // Fetch risk flags from Python service (best-effort; empty on failure)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let riskFlags: any[] = []
  try {
    const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'
    const pyRes = await fetch(`${pythonUrl}/risk-flags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratios: u.ratios ?? {}, financials: ext }),
      signal: AbortSignal.timeout(5000),
    })
    if (pyRes.ok) {
      const data = await pyRes.json()
      riskFlags = data.flags ?? []
    }
  } catch {
    // Python service unavailable — proceed without risk flags
  }

  return (
    <CamNoteEditor
      borrowerId={id}
      uploadId={uploadId}
      companyName={b.name}
      industry={b.industry ?? ''}
      financialYear={u.financial_year}
      extractedData={ext}
      ratios={u.ratios ?? {}}
      camSections={ext.cam_sections ?? null}
      memoContent={u.memo_content ?? ''}
      riskFlags={riskFlags}
    />
  )
}
