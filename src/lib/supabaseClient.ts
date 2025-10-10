// src/lib/supabaseClient.ts
import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client that manages the session via cookies,
 * so server Route Handlers (using createServerClient) can read them.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);