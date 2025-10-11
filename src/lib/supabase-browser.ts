// src/lib/supabase-browser.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// This helper reads/writes the Supabase auth cookies in the browser
export const supabase = createBrowserClient(url, key, {
  cookies: {
    get(name: string) {
      if (typeof document === 'undefined') return '';
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : '';
    },
    set() {/* no-op in browser */},
    remove() {/* no-op in browser */},
  },
});