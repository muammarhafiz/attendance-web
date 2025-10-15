'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------- Types ---------- */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string;
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
  earn_breakdown?: any;
  deduct_breakdown?: any;
};

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | string;
};

type ItemRow = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number | string;
};

/* ---------- Dropdown Presets ---------- */
const EARN_CODES = [
  { code: 'COMM', label: 'Commission' },
  { code: 'OT', label: 'Overtime' },
  { code: 'BONUS', label: 'Bonus' },
  { code: 'ALLOW', label: 'Allowance' },
  { code: 'CUSTOM', label: 'Custom…' },
];
const DEDUCT_CODES = [
  { code: 'ADVANCE', label: 'Advance' },
  { code: 'PENALTY', label: 'Penalty' },
  { code: 'CUSTOM', label: 'Custom…' },
];

/* ---------- Helpers ---------- */
function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number | string, currency = false): string {
  const v = asNum(n);
  return currency
    ? v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
}

/* ============================================================
   PAYROLL v2 PAGE
============================================================ */
export default function PayrollV2Page() {
  // Time + state
  const klNow = useMemo(
    () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })),
    []
  );
  const [year, setYear] = useState<number>(klNow.getFullYear());
  const [month, setMonth] = useState<number>(klNow.getMonth() + 1);

  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [absentMap, setAbsentMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);

  // Auth/admin state
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const disabledWrites = !isAdmin;

  // Inline diagnostics
  const [lastAction, setLastAction] = useState<string>('');
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [lastError, setLastError] = useState<string>('');
  const [formMsg, setFormMsg] = useState<{ ok?: string; err?: string }>({});

  // Admin toast feedback
  const [adminToast, setAdminToast] = useState<{ show: boolean; text: string }>({ show: false, text: '' });
  const showAdminToastText = (flag: boolean) => {
    setAdminToast({ show: true, text: flag ? 'You are Admin' : 'You are NOT Admin' });
    setTimeout(() => setAdminToast({ show: false, text: '' }), 2500);
  };

  /* ---------- Auth Init ---------- */
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser();
      const em = data.user?.email ?? null;
      setEmail(em);

      if (em) {
        const { data: ok, error } = await supabase.rpc('is_admin', {});
        const flag = !error && ok === true;
        setIsAdmin(flag);
        showAdminToastText(flag);
      } else {
        setIsAdmin(false);
        showAdminToastText(false);
      }
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const em = session?.user?.email ?? null;
      setEmail(em);
      const { data: ok2, error: e2 } = await supabase.rpc('is_admin', {});
      const flag = !e2 && ok2 === true;
      setIsAdmin(flag);
      showAdminToastText(flag);
    });

    return () => { sub?.subscription?.unsubscribe?.(); };
  }, []);

  /* ---------- Load Period + Summary ---------- */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Period info (try v_periods_min first, else pay_v2.periods)
      let per: PeriodRow | null = null;
      {
        const { data, error } = await supabase
          .from('v_periods_min')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle();
        if (error && error.message.includes('relation "v_periods_min"')) {
          const alt = await supabase
            .from('pay_v2.periods')
            .select('id, year, month, status')
            .eq('year', year)
            .eq('month', month)
            .maybeSingle();
          per = alt.data ?? null;
        } else {
          per = data ?? null;
        }
      }
      setPeriod(per);

      // 2) Summary view
      const { data: vData, error: vErr } = await supabase
        .from('v_payslip_admin_summary_v2')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .order('staff_name', { ascending: true });
      if (vErr) throw vErr;
      setRows(vData ?? []);

      // 3) Absent map (normalize lowercase keys)
      const { data: abs, error: absErr } = await supabase.rpc('absent_days_from_report', { p_year: year, p_month: month });
      if (!absErr && Array.isArray(abs)) {
        const map: Record<string, number> = {};
        for (const r of abs as { staff_email: string; days_absent: number }[]) {
          map[(r.staff_email || '').toLowerCase()] = r.days_absent ?? 0;
        }
        setAbsentMap(map);
      } else {
        setAbsentMap({});
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to load payroll data: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ---------- Status Pill ---------- */
  const statusPill = useMemo(() => {
    const st = period?.status ?? '';
    const cls =
      st === 'LOCKED' ? 'bg-yellow-100 text-yellow-800' :
      st === 'FINALIZED' ? 'bg-blue-100 text-blue-800' :
      'bg-green-100 text-green-800';
    return (
      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
        {st || '—'}
      </span>
    );
  }, [period]);

  /* ============================================================
     DETAILS MODAL
  ============================================================ */
  const [show, setShow] = useState(false);
  const [sel, setSel] = useState<SummaryRow | null>(null);
  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);
  const [unpaidAdjAmt, setUnpaidAdjAmt] = useState(0);
  const [unpaidExtraAmt, setUnpaidExtraAmt] = useState(0);

  const unpaidFinal = useMemo(() => {
    if (!sel) return 0;
    return Math.max(0, asNum(sel.unpaid_auto) + unpaidExtraAmt - unpaidAdjAmt);
  }, [sel, unpaidAdjAmt, unpaidExtraAmt]);

  const openDetails = async (row: SummaryRow) => {
    setSel(row);
    setShow(true);
    setFormMsg({});
    await loadManualAndUnpaid(row.staff_email);
  };

  const loadManualAndUnpaid = useCallback(
    async (emailAddr: string) => {
      if (!period) return;

      // Manual items
      const { data, error } = await supabase.rpc('list_manual_items', {
        p_year: year, p_month: month, p_email: emailAddr,
      });
      if (!error) {
        const rows = (data as ItemRow[]) ?? [];
        setEarnItems(rows.filter(r => r.kind === 'EARN'));
        setDeductItems(rows.filter(r => r.kind === 'DEDUCT'));
      } else {
        setEarnItems([]); setDeductItems([]);
      }

      // Unpaid plumbing
      if (period?.id) {
        const { data: plumb } = await supabase
          .from('pay_v2.items')
          .select('code, amount')
          .eq('period_id', period.id)
          .eq('staff_email', emailAddr.toLowerCase())
          .in('code', ['UNPAID_ADJ','UNPAID_EXTRA']);
        let adj = 0, extra = 0;
        (plumb ?? []).forEach(r => {
          const c = (r.code ?? '').toUpperCase();
          if (c === 'UNPAID_ADJ') adj = asNum(r.amount);
          if (c === 'UNPAID_EXTRA') extra = asNum(r.amount);
        });
        setUnpaidAdjAmt(adj);
        setUnpaidExtraAmt(extra);
      }
    },
    [period, year, month]
  );

  /* ============================================================
     RENDER
  ============================================================ */
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Payroll v2</h1>

      {/* Top controls */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="text-sm text-gray-600">
          <div>Period: <b>{year}-{String(month).padStart(2,'0')}</b></div>
          <div className="flex items-center gap-2">
            <span>Status:</span>{statusPill}
            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${isAdmin ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
              {isAdmin ? 'Admin' : 'Not admin'}
            </span>
          </div>
        </div>
        <div className="ml-auto flex gap-2 items-end">
          <input type="number" className="w-24 border rounded px-2 py-1" value={year} onChange={e=>setYear(Number(e.target.value))}/>
          <input type="number" className="w-20 border rounded px-2 py-1" min={1} max={12} value={month} onChange={e=>setMonth(Number(e.target.value))}/>
          <button onClick={refresh} className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50">Refresh</button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm border-collapse min-w-[980px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Base</th>
              <th className="px-3 py-2">Earn</th>
              <th className="px-3 py-2">Manual Deduct</th>
              <th className="px-3 py-2">Unpaid</th>
              <th className="px-3 py-2">Total Deduct</th>
              <th className="px-3 py-2">Net</th>
              <th className="px-3 py-2">Absent (days)</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="py-6 text-center text-gray-500">No data</td></tr>
            ) : rows.map(r=>{
              const key = r.staff_email.toLowerCase();
              const abs = absentMap[key] ?? 0;
              return (
                <tr key={r.staff_email} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{r.staff_name ?? r.staff_email}</td>
                  <td className="px-3 py-2 text-right">RM {fmt(r.base_wage)}</td>
                  <td className="px-3 py-2 text-right">RM {fmt(r.total_earn)}</td>
                  <td className="px-3 py-2 text-right">RM {fmt(r.manual_deduct)}</td>
                  <td className="px-3 py-2 text-right">RM {fmt(r.unpaid_auto)} <span className="text-xs text-gray-500">· {abs}d</span></td>
                  <td className="px-3 py-2 text-right">RM {fmt(r.total_deduct)}</td>
                  <td className="px-3 py-2 text-right font-semibold">RM {fmt(r.net_pay)}</td>
                  <td className="px-3 py-2 text-center">{abs}</td>
                  <td className="px-3 py-2">
                    <button className="border rounded px-2 py-1 text-xs hover:bg-gray-50" onClick={()=>openDetails(r)}>Details</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Details Modal */}
      {show && sel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3"
          onClick={e=>{ if(e.target===e.currentTarget) setShow(false); }}>
          <div className="bg-white rounded shadow-lg w-full max-w-3xl">
            <div className="border-b px-4 py-3 flex justify-between items-center">
              <div className="font-semibold">{sel.staff_name ?? sel.staff_email}</div>
              <a href={`/payroll/slip?year=${year}&month=${month}&email=${encodeURIComponent(sel.staff_email)}`}
                 target="_blank" rel="noopener noreferrer"
                 className="border rounded px-2 py-1 text-xs hover:bg-gray-50">Print Payslip</a>
            </div>

            <div className="p-4 text-sm">
              <p className="mb-2">Auto UNPAID: RM {fmt(sel.unpaid_auto)} · {(absentMap[sel.staff_email.toLowerCase()] ?? 0)}d</p>

              {/* Earnings */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded">
                  <div className="bg-gray-50 border-b px-3 py-2 font-semibold text-sm">Earnings</div>
                  <div className="p-2 max-h-64 overflow-auto">
                    {earnItems.length === 0 ? <div className="text-gray-500">None</div> :
                      <ul>{earnItems.map(it=>(
                        <li key={it.id} className="flex justify-between py-1">
                          <span>{it.label ?? it.code}</span>
                          <span>RM {fmt(it.amount)}</span>
                        </li>
                      ))}</ul>}
                  </div>
                </div>

                {/* Deductions */}
                <div className="border rounded">
                  <div className="bg-gray-50 border-b px-3 py-2 font-semibold text-sm">Deductions</div>
                  <div className="p-2 max-h-64 overflow-auto">
                    <div className="flex justify-between border-b py-1 mb-1">
                      <span>Unpaid (Final)</span>
                      <span>RM {fmt(unpaidFinal)}</span>
                    </div>
                    {deductItems.length === 0 ? <div className="text-gray-500">None</div> :
                      <ul>{deductItems.map(it=>(
                        <li key={it.id} className="flex justify-between py-1">
                          <span>{it.label ?? it.code}</span>
                          <span>RM {fmt(it.amount)}</span>
                        </li>
                      ))}</ul>}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t px-4 py-3 text-right">
              <button className="border rounded px-3 py-1 text-sm hover:bg-gray-50" onClick={()=>setShow(false
