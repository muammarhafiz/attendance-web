'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import PayrollTabs from '@/components/PayrollTabs';

/* ---------- types ---------- */
type Period = { id: string; year: number; month: number; status: 'OPEN' | 'LOCKED' | 'FINALIZED' | string };
type Summary = {
  staff_name: string | null; staff_email: string;
  total_earn: number | string; base_wage: number | string; manual_deduct: number | string;
  unpaid_auto: number | string; epf_emp: number | string; socso_emp: number | string; eis_emp: number | string;
  epf_er: number | string; socso_er: number | string; eis_er: number | string;
  total_deduct: number | string; net_pay: number | string;
};
type Item = { id: string; kind: string; code: string | null; label: string | null; amount: number | string };

const EARN_CODES = [
  { code: 'COMM', label: 'Commission' }, { code: 'OT', label: 'Overtime' },
  { code: 'BONUS', label: 'Bonus' }, { code: 'ALLOW', label: 'Allowance' }, { code: 'CUSTOM', label: 'Custom…' },
];
const DEDUCT_CODES = [
  { code: 'ADVANCE', label: 'Advance' }, { code: 'PENALTY', label: 'Penalty' }, { code: 'CUSTOM', label: 'Custom…' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const n = (x: number | string | null | undefined) => {
  if (x == null) return 0;
  const v = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
};
const rm = (x: number | string) => `RM ${n(x).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isPlumbing = (code?: string | null) => ['UNPAID_ADJ', 'UNPAID_EXTRA'].includes((code || '').toUpperCase());

// try pay_v2 schema first, then public
async function payRpc(fn: string, args: Record<string, unknown>) {
  const r1 = await supabase.schema('pay_v2').rpc(fn, args);
  if (!r1.error) return { data: r1.data, error: null as null | { message: string } };
  const r2 = await supabase.rpc(fn, args);
  return { data: r2.data, error: r2.error };
}

export default function PayrollV3Page() {
  const today = useMemo(() => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return { y: Number(p.find((x) => x.type === 'year')?.value), m: Number(p.find((x) => x.type === 'month')?.value) };
  }, []);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [year, setYear] = useState(today.y);
  const [month, setMonth] = useState(today.m);

  const [period, setPeriod] = useState<Period | null>(null);
  const [rows, setRows] = useState<Summary[]>([]);
  const [absent, setAbsent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [divisor, setDivisor] = useState<string>('26'); // unpaid-leave daily-rate divisor (26 or 25)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: per }, { data: sum }, { data: abs }] = await Promise.all([
        supabase.from('v_periods_min').select('id,year,month,status').eq('year', year).eq('month', month).maybeSingle(),
        supabase.from('v_payslip_admin_summary_v2').select('*').eq('year', year).eq('month', month).order('staff_name'),
        supabase.rpc('payroll_absent_days_v2', { p_year: year, p_month: month }),
      ]);
      setPeriod((per as Period) ?? null);
      setRows((sum as Summary[]) ?? []);
      const m: Record<string, number> = {};
      (abs as { staff_email: string; days_absent: number }[] | null)?.forEach((r) => { m[(r.staff_email || '').toLowerCase()] = r.days_absent ?? 0; });
      setAbsent(m);
    } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin, refresh]);

  // Unpaid-leave daily-rate divisor — a global payroll setting (default 26 = EA-1955 ordinary rate of pay).
  useEffect(() => {
    if (!isAdmin) return;
    supabase.schema('pay_v2').from('payroll_settings').select('value').eq('key', 'unpaid_divisor').maybeSingle()
      .then(({ data }) => { const v = (data as { value?: string } | null)?.value; if (v) setDivisor(String(v)); });
  }, [isAdmin]);

  const run = async (label: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(label); setMsg(null);
    const { error } = await fn();
    if (error) setMsg({ kind: 'err', text: `${label} failed: ${error.message}` });
    else { setMsg({ kind: 'ok', text: `${label} done.` }); await refresh(); }
    setBusy('');
  };

  const generate = () => run('Generate', () => payRpc('build_period', { p_year: year, p_month: month }));
  const lock = () => run('Lock', () => payRpc('lock_period', { p_year: year, p_month: month }));
  const unlock = () => run('Unlock', () => payRpc('unlock_period', { p_year: year, p_month: month }));

  // Switch the unpaid-leave daily-rate divisor (26 = EA-1955 standard, or 25). Re-Generate to apply.
  const setUnpaidDivisor = async (v: '26' | '25') => {
    if (v === divisor) return;
    setDivisor(v);
    const { error } = await supabase.schema('pay_v2').from('payroll_settings')
      .update({ value: v, updated_at: new Date().toISOString() }).eq('key', 'unpaid_divisor');
    if (error) { setDivisor(divisor); setMsg({ kind: 'err', text: `Couldn't save: ${error.message}` }); }
    else setMsg({ kind: 'ok', text: `Unpaid-leave daily rate set to monthly ÷ ${v}. Re-Generate the month to apply it.` });
  };

  const finalize = async () => {
    setBusy('Finalize'); setMsg(null);
    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/payroll/finalize?year=${year}&month=${month}`, {
        method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Finalize failed');
      setMsg({ kind: 'ok', text: 'Payslips generated & period locked. View them under Payroll Records.' });
      await refresh();
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(''); }
  };

  const sendPayslips = async () => {
    if (!window.confirm(`Email each staff their own ${MONTHS[month - 1]} ${year} payslip now? Each person only receives their own.`)) return;
    setBusy('Send'); setMsg(null);
    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/payroll/send-payslips?year=${year}&month=${month}`, {
        method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Send failed');
      const failedList = (json.results || []).filter((r: { status: string }) => r.status === 'error').map((r: { email: string }) => r.email).join(', ');
      setMsg({
        kind: json.failed ? 'err' : 'ok',
        text: `Payslips emailed — ${json.sent} sent${json.failed ? ` · ${json.failed} failed: ${failedList}` : ''}.`,
      });
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(''); }
  };

  const sendTest = async () => {
    if (!window.confirm(`Send a TEST payslip to your own email only? No staff will receive anything — this just lets you check the email + PDF.`)) return;
    setBusy('Test'); setMsg(null);
    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/payroll/send-payslips?year=${year}&month=${month}&test=1`, {
        method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Test send failed');
      setMsg({ kind: 'ok', text: `Test sent to ${json.sentTo} (using ${json.usedPayslipOf}'s payslip). Check your inbox.` });
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(''); }
  };

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  const totals = useMemo(() => {
    const s = (k: keyof Summary) => rows.reduce((a, r) => a + n(r[k]), 0);
    const net = s('net_pay');
    const erStat = s('epf_er') + s('socso_er') + s('eis_er');
    return {
      base: s('base_wage'), gross: s('total_earn'), net,
      epf: { er: s('epf_er'), emp: s('epf_emp') }, socso: { er: s('socso_er'), emp: s('socso_emp') }, eis: { er: s('eis_er'), emp: s('eis_emp') },
      erStat, cost: net + erStat,
    };
  }, [rows]);

  // ----- details modal -----
  const [sel, setSel] = useState<Summary | null>(null);
  const [earn, setEarn] = useState<Item[]>([]);
  const [deduct, setDeduct] = useState<Item[]>([]);
  const [addType, setAddType] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [addCode, setAddCode] = useState('COMM');
  const [customCode, setCustomCode] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [mWorking, setMWorking] = useState(false);
  const [mMsg, setMMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const isOpen = period?.status === 'OPEN';

  useEffect(() => { setAddCode(addType === 'DEDUCT' ? 'ADVANCE' : 'COMM'); setCustomCode(''); }, [addType]);

  const loadItems = useCallback(async (email: string) => {
    const { data } = await supabase.rpc('list_manual_items', { p_year: year, p_month: month, p_email: email });
    const list = (data as Item[]) ?? [];
    setEarn(list.filter((r) => r.kind === 'EARN' && !isPlumbing(r.code)));
    setDeduct(list.filter((r) => r.kind === 'DEDUCT' && !isPlumbing(r.code)));
  }, [year, month]);

  const openDetails = async (row: Summary) => { setSel(row); setMMsg(null); await loadItems(row.staff_email); };

  const addItem = async () => {
    if (!sel) return;
    const amt = Number(addAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setMMsg({ kind: 'err', text: 'Amount must be more than 0.' }); return; }
    const code = addCode === 'CUSTOM' ? customCode.trim().toUpperCase() : addCode;
    if (!code) { setMMsg({ kind: 'err', text: 'Please choose a code.' }); return; }
    setMWorking(true); setMMsg(null);
    const def = (addType === 'DEDUCT' ? DEDUCT_CODES : EARN_CODES).find((c) => c.code === code)?.label || code;
    const { error } = await payRpc('add_pay_item', {
      p_year: year, p_month: month, p_email: sel.staff_email, p_kind: addType, p_code: code, p_label: addLabel || def, p_amount: amt,
    });
    if (error) setMMsg({ kind: 'err', text: error.message });
    else { setAddLabel(''); setAddAmt(''); setCustomCode(''); await loadItems(sel.staff_email); await refresh(); setMMsg({ kind: 'ok', text: 'Added.' }); }
    setMWorking(false);
  };

  const editItem = async (it: Item) => {
    const next = prompt('New amount (RM)', String(n(it.amount)));
    if (next == null) return;
    const v = Number(next);
    if (!Number.isFinite(v) || v <= 0) { setMMsg({ kind: 'err', text: 'Invalid amount.' }); return; }
    const label = prompt('Label (optional)', it.label ?? '') ?? undefined;
    setMWorking(true);
    const { error } = await payRpc('update_pay_item', { p_item_id: it.id, p_amount: v, p_label: label ?? null });
    if (error) setMMsg({ kind: 'err', text: error.message });
    else { if (sel) await loadItems(sel.staff_email); await refresh(); }
    setMWorking(false);
  };

  const removeItem = async (it: Item) => {
    if (!confirm('Delete this item?')) return;
    setMWorking(true);
    const { error } = await payRpc('delete_pay_item', { p_item_id: it.id });
    if (error) setMMsg({ kind: 'err', text: error.message });
    else { if (sel) await loadItems(sel.staff_email); await refresh(); }
    setMWorking(false);
  };

  const setUnpaid = async () => {
    if (!sel) return;
    const raw = prompt('Set final Unpaid Leave (RM):', String(n(sel.unpaid_auto)));
    if (raw == null) return;
    const t = Number(raw);
    if (!Number.isFinite(t) || t < 0) { setMMsg({ kind: 'err', text: 'Enter a valid amount.' }); return; }
    setMWorking(true);
    const { error } = await payRpc('set_unpaid_total', { p_year: year, p_month: month, p_email: sel.staff_email, p_target: t });
    if (error) setMMsg({ kind: 'err', text: error.message });
    else { await refresh(); setMMsg({ kind: 'ok', text: 'Unpaid updated.' }); }
    setMWorking(false);
  };

  const printSlip = () => {
    if (!sel) return;
    window.open(`/payroll/slip?year=${year}&month=${month}&email=${encodeURIComponent(sel.staff_email.toLowerCase())}`, '_blank', 'noopener');
  };

  if (authed === null || isAdmin === null) return <div className="mx-auto max-w-6xl p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="mx-auto max-w-6xl p-6 text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="mx-auto max-w-6xl p-6 text-sm text-gray-600">This page is for admins only.</div>;

  const status = period?.status ?? null;
  const statusCls = status === 'LOCKED' ? 'bg-amber-100 text-amber-800' : status === 'FINALIZED' ? 'bg-blue-100 text-blue-800' : status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PayrollTabs />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusCls}`}>{status ?? 'Not generated'}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">◀</button>
          <span className="min-w-[120px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">▶</button>
        </div>
      </div>

      {/* Workflow card */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(status === null || status === 'OPEN') && (
            <button onClick={generate} disabled={!!busy} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50">
              {busy === 'Generate' ? 'Generating…' : status === null ? 'Generate payroll from attendance' : 'Rebuild from attendance'}
            </button>
          )}
          {status === 'OPEN' && (
            <>
              <button onClick={finalize} disabled={!!busy} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'Finalize' ? 'Finalizing…' : 'Finalize & generate payslips'}
              </button>
              <button onClick={lock} disabled={!!busy} className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Lock (no PDFs)</button>
            </>
          )}
          {(status === 'LOCKED' || status === 'FINALIZED') && (
            <>
              <button onClick={unlock} disabled={!!busy} className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Unlock to edit</button>
              <button onClick={sendPayslips} disabled={!!busy} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy === 'Send' ? 'Sending…' : 'Email payslips to staff'}
              </button>
            </>
          )}
          <button onClick={sendTest} disabled={!!busy} title="Sends one payslip to your own email so you can check it before emailing staff." className="rounded-md border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            {busy === 'Test' ? 'Sending test…' : 'Send test to my email'}
          </button>
          <button onClick={refresh} className="ml-auto rounded-md border px-3 py-2 text-sm hover:bg-gray-50">Refresh</button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          <b>Generate</b> pulls each person&apos;s base salary, this month&apos;s unpaid leave (from attendance absences), recurring items &amp; statutory deductions.
          Edit anyone via <b>Details</b>, then <b>Finalize</b> to produce payslip PDFs (and lock the month). Past payslips live under <b>Payroll Records</b>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-xs font-medium text-gray-700">Unpaid-leave daily rate</span>
          {(['26', '25'] as const).map((d) => (
            <button key={d} onClick={() => setUnpaidDivisor(d)} disabled={!!busy}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${divisor === d ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              ÷{d}
            </button>
          ))}
          <span className="text-[11px] text-gray-400">monthly salary ÷ {divisor} per day{divisor === '26' ? ' · EA-1955 standard' : ''} · re-Generate to apply</span>
        </div>
        {msg && <div className={`mt-2 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-gray-600">Staff</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Base</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Gross</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Unpaid</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Deductions</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Net pay</th>
              <th className="px-3 py-2 text-center font-medium text-gray-600">Absent</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Nothing yet — tap &quot;Generate payroll from attendance&quot;.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.staff_email} className="border-t border-gray-100">
                <td className="px-3 py-2"><div className="font-medium text-gray-900">{r.staff_name ?? r.staff_email}</div><div className="text-xs text-gray-400">{r.staff_email}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(r.base_wage)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(r.total_earn)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-600">{n(r.unpaid_auto) ? rm(r.unpaid_auto) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(r.total_deduct)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{rm(r.net_pay)}</td>
                <td className="px-3 py-2 text-center">{absent[(r.staff_email || '').toLowerCase()] || 0}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => openDetails(r)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-gray-50">Details</button></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-right">Totals</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(totals.base)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(totals.gross)}</td>
                <td colSpan={2}></td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(totals.net)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Payment summary */}
      {rows.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Net to all staff', value: totals.net, hint: 'Total take-home' },
            { label: 'EPF (Er + Emp)', value: totals.epf.er + totals.epf.emp, hint: `Er ${rm(totals.epf.er)} · Emp ${rm(totals.epf.emp)}` },
            { label: 'SOCSO + EIS', value: totals.socso.er + totals.socso.emp + totals.eis.er + totals.eis.emp, hint: 'Employer + employee' },
            { label: 'Total payroll cost', value: totals.cost, hint: 'Net + employer statutories' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="text-lg font-bold text-gray-900">{rm(c.value)}</div>
              <div className="text-[11px] text-gray-400">{c.hint}</div>
            </div>
          ))}
        </div>
      )}

      {/* Details modal */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget && !mWorking) setSel(null); }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div><div className="font-semibold">{sel.staff_name ?? sel.staff_email}</div><div className="text-xs text-gray-400">{sel.staff_email}</div></div>
              <div className="flex gap-2">
                <button onClick={printSlip} className="rounded-md border px-2.5 py-1 text-xs hover:bg-gray-50">Print payslip</button>
                <button onClick={() => setSel(null)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-gray-50">Close</button>
              </div>
            </div>

            {!isOpen && <div className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Period is {status}. Unlock it to edit items.</div>}

            <div className="grid gap-3 p-4 md:grid-cols-2">
              <div className="rounded-lg border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Earnings</div>
                <div className="max-h-56 overflow-auto p-3 text-sm">
                  {earn.length === 0 ? <div className="text-gray-400">None.</div> : (
                    <ul className="space-y-2">
                      {earn.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2">
                          <div><div className="font-medium">{it.label ?? it.code}</div><div className="text-xs text-gray-400">{it.code}</div></div>
                          <div className="flex items-center gap-2"><span className="tabular-nums">{rm(it.amount)}</span>
                            {isOpen && <><button onClick={() => editItem(it)} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50">Edit</button>
                            <button onClick={() => removeItem(it)} className="rounded border px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50">✕</button></>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Deductions</div>
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
                  <div className="font-medium">Unpaid leave {isOpen && <button onClick={setUnpaid} className="ml-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50">Edit</button>}</div>
                  <span className="tabular-nums">{rm(sel.unpaid_auto)}</span>
                </div>
                <div className="max-h-44 overflow-auto p-3 text-sm">
                  {deduct.length === 0 ? <div className="text-gray-400">No other deductions.</div> : (
                    <ul className="space-y-2">
                      {deduct.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2">
                          <div><div className="font-medium">{it.label ?? it.code}</div><div className="text-xs text-gray-400">{it.code}</div></div>
                          <div className="flex items-center gap-2"><span className="tabular-nums">{rm(it.amount)}</span>
                            {isOpen && <><button onClick={() => editItem(it)} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50">Edit</button>
                            <button onClick={() => removeItem(it)} className="rounded border px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50">✕</button></>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {isOpen && (
              <div className="border-t px-4 py-3">
                <div className="mb-2 text-sm font-semibold">Add item</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={addType} onChange={(e) => setAddType(e.target.value === 'DEDUCT' ? 'DEDUCT' : 'EARN')} className="rounded-md border px-2 py-1.5 text-sm">
                    <option value="EARN">Earning</option><option value="DEDUCT">Deduction</option>
                  </select>
                  <select value={addCode} onChange={(e) => setAddCode(e.target.value)} className="rounded-md border px-2 py-1.5 text-sm">
                    {(addType === 'DEDUCT' ? DEDUCT_CODES : EARN_CODES).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select>
                  {addCode === 'CUSTOM' && <input value={customCode} onChange={(e) => setCustomCode(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder="CODE" className="w-24 rounded-md border px-2 py-1.5 text-sm" />}
                  <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label" className="flex-1 rounded-md border px-2 py-1.5 text-sm" />
                  <input value={addAmt} onChange={(e) => setAddAmt(e.target.value)} placeholder="0.00" className="w-24 rounded-md border px-2 py-1.5 text-right text-sm tabular-nums" />
                  <button onClick={addItem} disabled={mWorking} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50">Add</button>
                </div>
              </div>
            )}
            {mMsg && <div className={`mx-4 mb-4 rounded-md border p-2 text-sm ${mMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{mMsg.text}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
