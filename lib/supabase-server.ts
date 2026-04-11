import { createLocalClient } from '@/lib/db'

export async function createServerSupabaseClient() {
  return createLocalClient()
}
