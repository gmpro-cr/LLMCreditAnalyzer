import { NextResponse } from 'next/server'

export const maxDuration = 60

/**
 * POST /api/python-proxy/export-docx
 * Proxy to Python /export-docx — forwards the request and returns the .docx blob.
 */
export async function POST(req: Request) {
  const body = await req.json()
  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  try {
    const res = await fetch(`${pythonUrl}/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: (err as { detail?: string }).detail || 'Export failed' }, { status: 500 })
    }

    const blob    = await res.blob()
    const headers = new Headers()
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    headers.set('Content-Disposition', res.headers.get('Content-Disposition') ?? 'attachment; filename="CAM.docx"')

    return new NextResponse(blob, { headers })
  } catch (e) {
    console.error('[export-docx proxy]', e)
    return NextResponse.json({ error: 'Python service unavailable' }, { status: 503 })
  }
}
