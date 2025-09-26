// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,          // e.g. https://abcxyz.supabase.co
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,     // anon public key
  {
    auth: {
      // make sure the session is stored on the browser and kept fresh
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);