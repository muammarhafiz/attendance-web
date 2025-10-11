// src/app/api/payroll/unlock/route.ts
import { NextResponse } from 'next/server'
import { createClientServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic' // avoid any caching

type Body = { year?: number; month?: number }

function bad(msg: string, code = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: code })
}

export async function POST(req: Request) {
  const { year, month } = (await req.json().catch(() => ({}))) as Body
  if (!year || !month) return bad('Missing { year, month } in body.', 400)

  try {
    const sb = createClientServer(req).schema('pay_v2')
    const { data, error } = await sb.rpc('unlock_period', {
      p_year: year,
      p_month: month,
    })

    if (error) {
      // If the function raised "Admins only" (42501), surface 403 for clarity
      const status = error.code === '42501' ? 403 : 500
      return bad(`unlock_period failed: ${error.message}`, status)
    }

    return NextResponse.json({ ok: true, period_id: data, year, month })
  } catch (e: any) {
    return bad(e?.message ?? 'Unexpected error', 500)
  }
}