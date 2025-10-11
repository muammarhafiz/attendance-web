// src/lib/supabase-browser.ts
'use client';

import { createBrowserClient } from '@supabase/ssr'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Create browser client (reads auth cookie automatically in Next 13/14/15)
export const supabase = createBrowserClient(url, key)