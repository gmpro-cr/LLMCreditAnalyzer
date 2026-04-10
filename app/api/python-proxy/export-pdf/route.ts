import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  try {
    const pyRes = await fetch(`${pythonUrl}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as { detail?: string }).detail || 'PDF export failed' },
        { status: 500 }
      )
    }

    const blob = await pyRes.blob()
    const filename = `CAM_export.pdf`
    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
