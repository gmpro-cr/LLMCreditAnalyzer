import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth — the authenticated user's id (auth.users.id). */
      userId: string;
      /** Set by requireAuth — per-request, user-scoped Supabase client (RLS enforced). */
      db: SupabaseClient;
    }
  }
}

export {};
