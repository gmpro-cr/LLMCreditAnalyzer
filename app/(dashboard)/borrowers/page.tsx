import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Borrower } from '@/types'
import BorrowersClient from './BorrowersClient'

export default async function BorrowersPage() {
  const supabase = await createServerSupabaseClient()
  const { data: borrowers } = await supabase
    .from('borrowers')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6 cg-fade-in">
      <BorrowersClient borrowers={(borrowers as Borrower[]) ?? []} />
    </div>
  )
}
