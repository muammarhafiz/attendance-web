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

  // 👇 scope all PostgREST calls to the pay_v2 schema
  const pg = useMemo(() => supabase.schema('pay_v2'), [])

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

    // 3) Company totals (aggregate) – fetch rows and sum client-side
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

    const sum = (arr: any[], key: 'total_earn' | 'total_deduct' | 'net_pay') =>
      arr.reduce((acc, r) => acc + Number(r[key] ?? 0), 0)

    setCompanyTotals({
      earn: sum(totals ?? [], 'total_earn').toFixed(2),
      deduct: sum(totals ?? [], 'total_deduct').toFixed(2),
      net: sum(totals ?? [], 'net_pay').toFixed(2),
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
    // 👇 RPCs also need the pay_v2 schema
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
      {/* …UI unchanged… */}
      {/* paste your existing JSX from here down without changes */}
    </main>
  )
}