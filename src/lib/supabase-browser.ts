// src/lib/supabase-browser.ts
import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, key, {
  db: { schema: 'pay_v2' },               // << key line
  auth: { persistSession: true, autoRefreshToken: true }
})