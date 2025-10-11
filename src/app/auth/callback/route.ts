// src/app/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClientServer } from '@/lib/supabaseServer'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/'

  // Create server-side supabase client (reads/writes cookies)
  const supabase = createClientServer(req)

  if (code) {
    // Exchange the OAuth "code" for a session (sets auth cookies)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      // If something goes wrong, send the user back to login with a message
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
    }
  }

  // Go back to the requested page (or home)
  return NextResponse.redirect(new URL(next, url.origin))
}