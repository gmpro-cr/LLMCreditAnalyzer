import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ id: string; uploadId: string }> }

/**
 * GET  /api/borrowers/:id/cam-note/:uploadId  — load cam_sections from extracted_data
 * PATCH /api/borrowers/:id/cam-note/:uploadId  — save updated cam_sections
 */

export async function GET(_req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const { data: upload, error } = await supabase
    .from('financial_uploads')
    .select('id, financial_year, extracted_data, ratios, memo_content')
    .eq('id', uploadId)
    .eq('borrower_id', id)
    .single()

  if (error || !upload) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = (upload as any).extracted_data as any
  const camSections = ext?.cam_sections ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = upload as any
  return NextResponse.json({
    upload_id:      u.id,
    financial_year: u.financial_year,
    cam_sections:   camSections,
    ratios:         u.ratios,
    extracted_data: ext,
    memo_content:   u.memo_content,
  })
}

export async function PATCH(req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const body = await req.json()
  const { cam_sections, section_key, section_data } = body

  // Fetch existing extracted_data
  const { data: upload, error: fetchErr } = await supabase
    .from('financial_uploads')
    .select('extracted_data')
    .eq('id', uploadId)
    .eq('borrower_id', id)
    .single()

  if (fetchErr || !upload) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = ((upload as any).extracted_data ?? {}) as Record<string, any>

  let newCamSections: Record<string, unknown>

  if (cam_sections) {
    // Full replace
    newCamSections = cam_sections
  } else if (section_key && section_data) {
    // Partial update — merge single section
    const existing = ext.cam_sections ?? {}
    newCamSections = { ...existing, [section_key]: section_data }
  } else {
    return NextResponse.json({ error: 'Provide cam_sections or section_key+section_data' }, { status: 400 })
  }

  const { error: updateErr } = await supabase
    .from('financial_uploads')
    .update({ extracted_data: { ...ext, cam_sections: newCamSections } })
    .eq('id', uploadId)
    .eq('borrower_id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, cam_sections: newCamSections })
}
