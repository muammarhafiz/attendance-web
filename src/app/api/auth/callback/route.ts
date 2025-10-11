import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const cookieStore = cookies()

  // Redirect home after exchange
  const res = NextResponse.redirect(new URL('/', url))

  // Supabase server client that can read/write Auth cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: '', ...options, maxAge: 0 })
        },
      },
    }
  )

  // This reads the auth code from the URL and sets the session cookies
  await supabase.auth.exchangeCodeForSession(url.toString())

  return res
}