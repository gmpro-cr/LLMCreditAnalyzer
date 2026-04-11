import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const maxDuration = 300

type Params = { params: Promise<{ id: string; uploadId: string }> }

/**
 * POST /api/borrowers/:id/cam-note/:uploadId/generate
 * Generate (or regenerate) AI-drafted CAM sections via Python service.
 * Body: { regenerate?: string }  — if set, regenerate only that section key
 */
export async function POST(req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()
  const body = await req.json().catch(() => ({}))
  const regenerate: string | undefined = body.regenerate

  // Fetch upload
  const { data: upload, error } = await supabase
    .from('financial_uploads')
    .select('id, financial_year, extracted_data, ratios')
    .eq('id', uploadId)
    .eq('borrower_id', id)
    .single()

  if (error || !upload) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  // Fetch borrower name
  const { data: borrower } = await supabase
    .from('borrowers')
    .select('name')
    .eq('id', id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext           = ((upload as any).extracted_data ?? {}) as Record<string, any>
  const ratios        = (upload as any).ratios ?? {}
  const companyName   = (borrower as any)?.name ?? 'Unknown Borrower'
  const researchBrief = ext._research?.brief ?? ''

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  try {
    const pyRes = await fetch(`${pythonUrl}/cam/draft-sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        financials:     ext,
        ratios,
        company_name:   companyName,
        research_brief: researchBrief,
        ...(regenerate ? { regenerate } : {}),
      }),
      signal: AbortSignal.timeout(280_000),
    })

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as { detail?: string }).detail || 'Section generation failed' },
        { status: 500 }
      )
    }

    const { sections } = await pyRes.json()

    // Merge into existing cam_sections (preserve user edits on non-regenerated sections)
    const existingCam = ext.cam_sections ?? {}
    let newCam: Record<string, unknown>

    if (regenerate) {
      // Only update the one section, preserve user edits on others
      newCam = { ...existingCam, ...sections }
    } else {
      // Full generation — scaffold everything but don't overwrite user_edited sections
      newCam = {}
      for (const [key, val] of Object.entries(sections as Record<string, unknown>)) {
        const existing = (existingCam as Record<string, any>)[key]
        // Don't overwrite sections the user has already edited
        if (existing?.user_edited) {
          newCam[key] = existing
        } else {
          newCam[key] = val
        }
      }
    }

    // Save back to Supabase
    await supabase
      .from('financial_uploads')
      .update({ extracted_data: { ...ext, cam_sections: newCam } })
      .eq('id', uploadId)

    return NextResponse.json({ sections: newCam })
  } catch (e) {
    console.error('[CAM Generate]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
