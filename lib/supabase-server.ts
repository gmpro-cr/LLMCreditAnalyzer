import { createLocalClient } from '@/lib/db'

export async function createServerSupabaseClient() {
  // Use real Supabase when env vars are present (production/Vercel),
  // fall back to local SQLite for offline development.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  }
  return createLocalClient()
}
