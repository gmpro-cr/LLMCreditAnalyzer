import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  if (q.length < 2) return NextResponse.json([])

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'
  try {
    const res = await fetch(`${pythonUrl}/search-companies?q=${encodeURIComponent(q)}&limit=8`, {
      next: { revalidate: 60 }, // cache 60s per query
    })
    if (!res.ok) return NextResponse.json([])
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json([])
  }
}
