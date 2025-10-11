// src/app/payroll/admin/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'

type PayslipRow = {
  staff_email: string
  staff_name: string | null
  total_earn: string
  total_deduct: string
  net_pay: string
}

export default function AdminPayrollDashboard() {
  const now = useMemo(() => new Date(), [])
  const [year, setYear] = useState<number>(now.getFullYear())
  const [month, setMonth] = useState<number>(now.getMonth() + 1)

  const [status, setStatus] = useState<'OPEN' | 'LOCKED' | 'N/A'>('N/A')
  const [rows, setRows] = useState<PayslipRow[]>([])
  const [companyTotals, setCompanyTotals] = useState<{ earn: string; deduct: string; net: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Scope all PostgREST calls to the pay_v2 schema
  const pg = supabase

  const yyyymm = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month])

  // Load period status + summary
  const loadData = async () => {
    setLoading(true)
    setMsg(null)

    // 1) Period status (may be null if not created yet)
    const { data: period, error: pErr } = await pg
      .from('periods')
      .select('id, year, month, status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle()

    if (pErr) {
      setMsg(`Failed to read period: ${pErr.message}`)
      setLoading(false)
      return
    }
    setStatus((period?.status as 'OPEN' | 'LOCKED') ?? 'N/A')

    // 2) Per-staff summary (view)
    const { data: list, error: lErr } = await pg
      .from('v_payslip_with_names')
      .select('staff_email, staff_name, total_earn, total_deduct, net_pay')
      .eq('year', year)
      .eq('month', month)
      .order('staff_email', { ascending: true })

    if (lErr) {
      setMsg(`Failed to load summary: ${lErr.message}`)
      setRows([])
      setCompanyTotals(null)
      setLoading(false)
      return
    }

    setRows((list ?? []) as PayslipRow[])

    // 3) Company totals (aggregate)
    const { data: totals, error: tErr } = await pg
      .from('v_payslip_with_names')
      .select('total_earn, total_deduct, net_pay')
      .eq('year', year)
      .eq('month', month)

    if (tErr) {
      setMsg(`Failed to load totals: ${tErr.message}`)
      setCompanyTotals(null)
      setLoading(false)
      return
    }

    const sum = (
      arr: { total_earn: string; total_deduct: string; net_pay: string }[],
      key: 'total_earn' | 'total_deduct' | 'net_pay'
    ) => arr.reduce((acc, r) => acc + Number(r[key] ?? 0), 0)

    const t = (totals ?? []) as { total_earn: string; total_deduct: string; net_pay: string }[]
    setCompanyTotals({
      earn: sum(t, 'total_earn').toFixed(2),
      deduct: sum(t, 'total_deduct').toFixed(2),
      net: sum(t, 'net_pay').toFixed(2),
    })

    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  // --- Actions (admin only) ---
  const callBuild = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await pg.rpc('build_period', { p_year: year, p_month: month })
    if (error) setMsg(`Build failed: ${error.message}`)
    else setMsg(`Build complete for ${yyyymm} (${Array.isArray(data) ? data.length : 0} rows affected)`)
    setBusy(false)
    await loadData()
  }

  const callLock = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await pg.rpc('lock_period', { p_year: year, p_month: month })
    if (error) setMsg(`Lock failed: ${error.message}`)
    else setMsg(`Locked period ${yyyymm} (id=${data})`)
    setBusy(false)
    await loadData()
  }

  const callUnlock = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await pg.rpc('unlock_period', { p_year: year, p_month: month })
    if (error) setMsg(`Unlock failed: ${error.message}`)
    else setMsg(`Unlocked period ${yyyymm} (id=${data})`)
    setBusy(false)
    await loadData()
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin Payroll Dashboard</h1>
          <p className="text-sm text-gray-500">Period controls & summaries</p>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              value={year}
              min={2020}
              max={2100}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              value={month}
              min={1}
              max={12}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>

          <div className="ml-4">
            <div className="text-xs text-gray-600">Status</div>
            <div className={`text-sm font-semibold ${status === 'LOCKED' ? 'text-red-600' : 'text-green-700'}`}>
              {status}
            </div>
          </div>
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={callBuild}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Build {yyyymm}
        </button>
        <button
          onClick={callLock}
          disabled={busy || status === 'LOCKED'}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Lock {yyyymm}
        </button>
        <button
          onClick={callUnlock}
          disabled={busy || status === 'OPEN'}
          className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Unlock {yyyymm}
        </button>

        <button
          onClick={loadData}
          disabled={busy}
          className="ml-auto rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </section>

      {msg && (
        <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {msg}
        </div>
      )}

      <section className="mb-3">
        <h2 className="mb-2 text-lg font-medium">Per-staff summary ({yyyymm})</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Staff Name</th>
                  <th className="border-b px-3 py-2">Email</th>
                  <th className="border-b px-3 py-2 text-right">Total Earn</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_email}>
                    <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                    <td className="border-b px-3 py-2">{r.staff_email}</td>
                    <td className="border-b px-3 py-2 text-right">{Number(r.total_earn).toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{Number(r.total_deduct).toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right font-medium">{Number(r.net_pay).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-lg font-medium">Company total</h2>
        {companyTotals ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Earn</div>
              <div className="text-lg font-semibold">RM {companyTotals.earn}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Deduct</div>
              <div className="text-lg font-semibold">RM {companyTotals.deduct}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Net Pay</div>
              <div className="text-lg font-semibold">RM {companyTotals.net}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">—</div>
        )}
      </section>
    </main>
  )
}