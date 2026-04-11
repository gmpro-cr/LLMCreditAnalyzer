export interface Borrower {
  id: string
  user_id: string
  name: string
  cin: string | null
  industry: string | null
  loan_amount: number | null
  loan_type: string | null
  sanction_date: string | null
  symbol: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public_data: any | null
  created_at: string
}

export interface FinancialUpload {
  id: string
  borrower_id: string
  financial_year: string
  upload_date: string
  extracted_data: Record<string, unknown> | null
  ratios: Record<string, number> | null
  memo_content: string | null
  status: 'processing' | 'complete' | 'failed'
}

export interface Covenant {
  id: string
  borrower_id: string
  ratio_name: string
  operator: 'gt' | 'lt' | 'gte' | 'lte'
  threshold: number
  is_breached: boolean
  last_checked_at: string | null
  waiver_note: string | null
  waiver_approved_by: string | null
}

export interface CovenantResult extends Covenant {
  current_value: number | null
  buffer: number | null
  status: 'ok' | 'near_breach' | 'breach' | 'no_data'
}

export interface RatioData {
  current_ratio?: number
  quick_ratio?: number
  cash_ratio?: number
  debt_equity?: number
  tol_tnw?: number
  debt_to_assets?: number
  interest_coverage?: number
  interest_coverage_ebitda?: number
  dscr?: number
  ebitda_margin?: number
  operating_margin?: number
  net_margin?: number
  roe?: number
  roa?: number
  roce?: number
  asset_turnover?: number
  fixed_asset_turnover?: number
  inventory_days?: number
  debtor_days?: number
  creditor_days?: number
  operating_cycle?: number
  cash_conversion_cycle?: number
  nwc_to_revenue?: number
  ocf_to_sales?: number
  ocf_to_debt?: number
  [key: string]: number | undefined
}

export const RATIO_LABELS: Record<string, string> = {
  current_ratio: 'Current Ratio',
  quick_ratio: 'Quick Ratio',
  cash_ratio: 'Cash Ratio',
  debt_equity: 'Debt / Equity',
  tol_tnw: 'TOL / TNW',
  debt_to_assets: 'Debt / Assets',
  interest_coverage: 'Interest Coverage',
  dscr: 'DSCR',
  ebitda_margin: 'EBITDA Margin (%)',
  operating_margin: 'Operating Margin (%)',
  net_margin: 'Net Profit Margin (%)',
  roe: 'ROE (%)',
  roa: 'ROA (%)',
  roce: 'ROCE (%)',
  asset_turnover: 'Asset Turnover',
  inventory_days: 'Inventory Days',
  debtor_days: 'Debtor Days',
  creditor_days: 'Creditor Days',
  operating_cycle: 'Operating Cycle (days)',
}

export const RATIO_BENCHMARKS: Record<string, { low: number; high: number; higherIsBetter: boolean }> = {
  current_ratio:    { low: 1.0,  high: 1.33, higherIsBetter: true },
  quick_ratio:      { low: 0.8,  high: 1.0,  higherIsBetter: true },
  debt_equity:      { low: 1.5,  high: 2.0,  higherIsBetter: false },
  interest_coverage:{ low: 1.5,  high: 2.5,  higherIsBetter: true },
  dscr:             { low: 1.0,  high: 1.25, higherIsBetter: true },
  tol_tnw:          { low: 2.0,  high: 3.0,  higherIsBetter: false },
  ebitda_margin:    { low: 8.0,  high: 15.0, higherIsBetter: true },
  net_margin:       { low: 3.0,  high: 5.0,  higherIsBetter: true },
  roe:              { low: 10.0, high: 15.0, higherIsBetter: true },
  roa:              { low: 3.0,  high: 5.0,  higherIsBetter: true },
  roce:             { low: 8.0,  high: 12.0, higherIsBetter: true },
  inventory_days:   { low: 45,   high: 60,   higherIsBetter: false },
  debtor_days:      { low: 60,   high: 90,   higherIsBetter: false },
}
