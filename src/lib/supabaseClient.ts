import { createBrowserClient } from '@supabase/ssr';

// Cookie-based session (via @supabase/ssr) instead of localStorage. iOS wipes localStorage for
// home-screen web apps, which logged people out on every reopen; cookies persist across closes
// (and are readable by the server too). Same `supabase` API as before — a drop-in replacement.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
