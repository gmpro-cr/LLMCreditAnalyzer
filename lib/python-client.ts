const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

export async function extractFinancials(formData: FormData) {
  const res = await fetch(`${PYTHON_URL}/extract`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Extraction failed')
  }
  return res.json()
}

export async function generateMemo(payload: {
  financials: Record<string, unknown>
  ratios: Record<string, number>
  company_name: string
  covenants?: unknown[]
}) {
  const res = await fetch(`${PYTHON_URL}/generate-memo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Memo generation failed')
  }
  return res.json()
}

export async function evaluateCovenants(payload: {
  ratios: Record<string, number>
  covenants: Array<{ ratio_name: string; operator: string; threshold: number }>
}) {
  const res = await fetch(`${PYTHON_URL}/evaluate-covenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Covenant evaluation failed')
  return res.json()
}

export async function exportDocx(payload: { memo_content: string; company_name: string }) {
  const res = await fetch(`${PYTHON_URL}/export-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('DOCX export failed')
  return res.blob()
}
