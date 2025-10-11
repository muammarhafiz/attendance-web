'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'

type PayslipRow = { /* ...same as you have... */ }

export default function AdminPayrollDashboard() {
  // NEW: track client auth state
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    // read session from supabase-js (localStorage/cookies)
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
    })
  }, [])

  // …your existing state…

  const pg = useMemo(() => supabase.schema('pay_v2'), [])

  const loadData = async () => {
    setLoading(true); setMsg(null)

    // EARLY EXIT if session missing
    const { data: u } = await supabase.auth.getUser()
    if (!u.user) {
      setMsg('You are not signed in on the client. Please Sign out then Sign in again.')
      setLoading(false)
      return
    }

    // …the rest of your loadData unchanged…
  }

  useEffect(() => { loadData() }, [year, month])

  // …actions unchanged…

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin Payroll Dashboard</h1>
          <p className="text-sm text-gray-500">Period controls & summaries</p>
          {/* NEW: tiny auth badge */}
          <p className="mt-1 text-xs text-gray-500">
            Client auth: {userEmail ? userEmail : 'not signed in'}
          </p>
        </div>
        {/* …rest of your header… */}
      </header>

      {msg && <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{msg}</div>}

      {/* …rest of your page exactly as you have… */}
    </main>
  )
}