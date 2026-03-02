'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/* ============================================================
   Types
============================================================ */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string; // auto UNPAID (from attendance)
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

type StaffRow = {
  email: string;
  full_name: string | null;
  name: string | null;
  position: string | null;
  nric: string | null;
  phone: string | null;
};

type ManualItem = {
  id: string;
  kind: string; // 'EARN' | 'DEDUCT' | ...
  code: string | null;
  label: string | null;
  amount: number | string;
};

/* ============================================================
   Helpers
============================================================ */
function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function cur(x: number | string | null | undefined): string {
  const v = asNum(x);
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ymText(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function isPlumbingCode(code?: string | null) {
  const c = (code || '').toUpperCase();
  return c === 'UNPAID_ADJ' || c === 'UNPAID_EXTRA' || c === 'UNPAID';
}

function safeUpper(x?: string | null) {
  return (x || '').toUpperCase();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/* ============================================================
   Page (A5 + Fit 1 page)
============================================================ */
export default function PayslipPage() {
  const sp = useSearchParams();
  const year = Number(sp.get('year') || 0);
  const month = Number(sp.get('month') || 0);
  const email = (sp.get('email') || '').trim().toLowerCase();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');

  const [sum, setSum] = useState<SummaryRow | null>(null);
  const [staff, setStaff] = useState<StaffRow | null>(null);

  const [manualEarn, setManualEarn] = useState<ManualItem[]>([]);
  const [manualDeduct, setManualDeduct] = useState<ManualItem[]>([]);

  // plumbing amounts
  const [unpaidAdj, setUnpaidAdj] = useState<number>(0); // EARN/UNPAID_ADJ
  const [unpaidExtra, setUnpaidExtra] = useState<number>(0); // DEDUCT/UNPAID_EXTRA

  const periodLabel = useMemo(() => ymText(year, month), [year, month]);

  const unpaidAuto = useMemo(() => asNum(sum?.unpaid_auto), [sum]);

  // Final Unpaid shown on payslip: ONE number, ONE place (Deductions)
  const unpaidFinal = useMemo(() => Math.max(0, unpaidAuto + unpaidExtra - unpaidAdj), [unpaidAuto, unpaidExtra, unpaidAdj]);

  // Display totals (so payslip stays consistent even if plumbing exists)
  const displayTotalEarn = useMemo(() => {
    // Remove UNPAID_ADJ from displayed earnings (it's not a real earning)
    const totalEarn = asNum(sum?.total_earn);
    return Math.max(0, totalEarn - unpaidAdj);
  }, [sum, unpaidAdj]);

  const displayTotalDeduct = useMemo(() => {
    // Replace (auto unpaid + unpaid extra) with ONE unpaidFinal line.
    const totalDeduct = asNum(sum?.total_deduct);
    const deductWithoutUnpaid = totalDeduct - unpaidAuto - unpaidExtra;
    return Math.max(0, deductWithoutUnpaid + unpaidFinal);
  }, [sum, unpaidAuto, unpaidExtra, unpaidFinal]);

  const displayNetPay = useMemo(() => Math.max(0, displayTotalEarn - displayTotalDeduct), [displayTotalEarn, displayTotalDeduct]);

  // Fit-to-A5 scaling
  useEffect(() => {
    const fit = () => {
      const content = document.getElementById('payslip-content') as HTMLElement | null;
      const inner = document.getElementById('a5-inner') as HTMLElement | null;
      if (!content || !inner) return;

      // reset first
      content.style.transform = 'scale(1)';

      const cw = content.scrollWidth;
      const ch = content.scrollHeight;
      const iw = inner.clientWidth;
      const ih = inner.clientHeight;

      if (!cw || !ch || !iw || !ih) return;

      const sW = iw / cw;
      const sH = ih / ch;

      // Choose the tighter scale to fit both, but don’t shrink too aggressively
      const scale = clamp(Math.min(sW, sH), 0.78, 1);

      content.style.transformOrigin = 'top left';
      content.style.transform = `scale(${scale})`;
    };

    // Fit now and after data loads/updates
    const t = setTimeout(fit, 50);

    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', fit);
    };
  }, [sum, staff, manualEarn, manualDeduct, unpaidAdj, unpaidExtra]);

  useEffect(() => {
    (async () => {
      setErr('');
      if (!year || !month || !email) {
        setErr('Missing query params. Expected year, month, email.');
        return;
      }

      setLoading(true);
      try {
        // 1) Summary row (public view)
        const { data: sData, error: sErr } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .eq('staff_email', email)
          .maybeSingle();

        if (sErr) throw sErr;
        if (!sData) {
          setSum(null);
          setStaff(null);
          setManualEarn([]);
          setManualDeduct([]);
          setUnpaidAdj(0);
          setUnpaidExtra(0);
          setErr(`No payslip data for ${email} in ${periodLabel}.`);
          return;
        }
        setSum(sData as SummaryRow);

        // 2) Staff details for header
        const { data: stData, error: stErr } = await supabase
          .from('staff')
          .select('email, full_name, name, position, nric, phone')
          .eq('email', email)
          .maybeSingle();

        if (stErr) throw stErr;
        setStaff((stData as StaffRow) ?? null);

        // 3) Manual items (exclude BASE/UNPAID/STAT_* server-side; still re-filter)
        const { data: items, error: iErr } = await supabase.rpc('list_manual_items', {
          p_year: year,
          p_month: month,
          p_email: email,
        });
        if (iErr) throw iErr;

        const list = (items as ManualItem[]) ?? [];
        const earn = list
          .filter((r) => safeUpper(r.kind) === 'EARN' && !isPlumbingCode(r.code))
          .sort((a, b) => (safeUpper(a.code) + (a.label || '')).localeCompare(safeUpper(b.code) + (b.label || '')));
        const ded = list
          .filter((r) => safeUpper(r.kind) === 'DEDUCT' && !isPlumbingCode(r.code))
          .sort((a, b) => (safeUpper(a.code) + (a.label || '')).localeCompare(safeUpper(b.code) + (b.label || '')));

        setManualEarn(earn);
        setManualDeduct(ded);

        // 4) Plumbing from pay_v2.items (UNPAID_ADJ / UNPAID_EXTRA)
        // Need period_id. Fetch via v_periods_min (public view).
        const { data: per, error: perErr } = await supabase
          .from('v_periods_min')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle();

        if (perErr) throw perErr;

        if (per?.id) {
          const { data: plumb, error: pErr } = await supabase
            .schema('pay_v2')
            .from('items')
            .select('kind, code, amount')
            .eq('period_id', per.id)
            .eq('staff_email', email)
            .in('code', ['UNPAID_ADJ', 'UNPAID_EXTRA']);

          if (pErr) throw pErr;

          let adj = 0;
          let extra = 0;

          (plumb ?? []).forEach((r: any) => {
            const c = safeUpper(r.code);
            if (c === 'UNPAID_ADJ') adj = asNum(r.amount);
            if (c === 'UNPAID_EXTRA') extra = asNum(r.amount);
          });

          setUnpaidAdj(adj);
          setUnpaidExtra(extra);
        } else {
          setUnpaidAdj(0);
          setUnpaidExtra(0);
        }
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [year, month, email, periodLabel]);

  const staffName = useMemo(() => {
    return staff?.full_name?.trim() || staff?.name?.trim() || sum?.staff_name?.trim() || email || '—';
  }, [staff, sum, email]);

  const pos = staff?.position || '—';
  const nric = staff?.nric || '—';
  const phone = staff?.phone || '—';

  const base = asNum(sum?.base_wage);

  const epfEmp = asNum(sum?.epf_emp);
  const socsoEmp = asNum(sum?.socso_emp);
  const eisEmp = asNum(sum?.eis_emp);

  const epfEr = asNum(sum?.epf_er);
  const socsoEr = asNum(sum?.socso_er);
  const eisEr = asNum(sum?.eis_er);

  const unpaidHasAnyAdjustment = unpaidAdj !== 0 || unpaidExtra !== 0;

  // Optional: don’t show negative/meaningless lines if there is no data
  const hasData = !!sum;

  return (
    <div className="payslip-page">
      <style>{`
/* ============================================================
   A5 + 1-page fit framework
============================================================ */
:root{
  --a5-w: 148mm;
  --a5-h: 210mm;
  --print-margin: 6mm;
  --inner-w: calc(var(--a5-w) - (var(--print-margin) * 2));
  --inner-h: calc(var(--a5-h) - (var(--print-margin) * 2));
}

.payslip-page{
  min-height: 100vh;
  background: #f3f4f6;
  padding: 16px;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: #111827;
}

.no-print{}

/* Screen preview sheet */
.a5-sheet{
  width: var(--a5-w);
  min-height: var(--a5-h);
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 8px 24px rgba(0,0,0,.08);
  position: relative;
  margin: 0 auto;
}

#a5-inner{
  position: absolute;
  left: var(--print-margin);
  top: var(--print-margin);
  width: var(--inner-w);
  height: var(--inner-h);
  overflow: hidden; /* ensures single-page */
}

#a5-toolbar{
  width: var(--a5-w);
  margin: 0 auto 10px auto;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap: 10px;
}

.btn{
  border: 1px solid #d1d5db;
  background: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover{ background:#f9fafb; }
.btn-primary{
  background:#2563eb;
  color:#fff;
  border-color:#2563eb;
}
.btn-primary:hover{ background:#1d4ed8; }

.small-muted{
  font-size: 12px;
  color:#6b7280;
}

.mono{
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.card{
  /* content wrapper inside scaled area */
  width: var(--inner-w);
  /* height is auto; scaling will fit */
}

.h1{
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.h2{
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 6px 0;
  color:#374151;
}

.hr{
  height:1px;
  background:#e5e7eb;
  border:none;
  margin:10px 0;
}

.grid2{
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.block{
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
}

.kv{
  display:flex;
  justify-content:space-between;
  gap: 10px;
  font-size: 12px;
  margin: 2px 0;
}
.kv b{ color:#111827; }

.table{
  width:100%;
  border-collapse: collapse;
  font-size: 12px;
}
.table th, .table td{
  border: 1px solid #e5e7eb;
  padding: 6px 6px;
  vertical-align: top;
}
.table th{
  background:#f9fafb;
  text-align:left;
  font-weight:700;
}
.right{ text-align:right; }
.note{
  font-size: 10px;
  color:#6b7280;
  margin-top: 2px;
}

.badge{
  display:inline-block;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background:#ecfeff;
  color:#155e75;
  border:1px solid #a5f3fc;
}

.footer{
  margin-top: 10px;
  text-align:center;
  font-size: 10px;
  color:#6b7280;
}

/* Print rules */
@media print {
  @page{
    size: A5 portrait;
    margin: 0;
  }

  html, body{
    margin:0 !important;
    padding:0 !important;
    background:#fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .no-print{ display:none !important; }

  .payslip-page{
    padding:0 !important;
    background:#fff !important;
    min-height: auto !important;
  }

  .a5-sheet{
    width: var(--a5-w) !important;
    height: var(--a5-h) !important;
    min-height: var(--a5-h) !important;
    border:none !important;
    box-shadow:none !important;
    margin:0 !important;
  }

  #a5-inner{
    overflow:hidden !important;
  }

  *{
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
}
`}</style>

      {/* Toolbar (screen only) */}
      <div id="a5-toolbar" className="no-print">
        <div className="small-muted">Payslip preview · {periodLabel}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => history.back()}>
            Back
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      {/* A5 Sheet */}
      <div className="a5-sheet">
        <div id="a5-inner">
          {/* scaled content */}
          <div id="payslip-content" className="card">
            {/* Company header */}
            <div style={{ textAlign: 'center' }}>
              <div className="h1">
                Zordaq Auto Services <span style={{ fontSize: 10, fontWeight: 500 }}>(KT0429873-U)</span>
              </div>
              <div className="small-muted">
                NO 1, JALAN INDUSTRI PUTRA 1, PRESINT 14, 62050 WILAYAH PERSEKUTUAN PUTRAJAYA
              </div>
              <div className="small-muted">Phone: 017-9333995 · Email: zordaqputrajaya@gmail.com</div>
            </div>

            <hr className="hr" />

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>PAYSLIP</div>
                <div className="small-muted">
                  Period: <b>{periodLabel}</b>
                </div>
                <div className="small-muted">
                  Status: <span className="badge">OPEN</span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div className="small-muted">Generated</div>
                <div className="mono" style={{ fontSize: 11 }}>
                  {new Date().toLocaleString('en-GB')}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10 }} className="grid2">
              {/* Employee */}
              <div className="block">
                <div className="h2">Employee</div>
                <div className="kv">
                  <span>NAME</span>
                  <b>{staffName}</b>
                </div>
                <div className="kv">
                  <span>POSITION</span>
                  <b>{pos}</b>
                </div>
                <div className="kv">
                  <span>NRIC</span>
                  <b>{nric}</b>
                </div>
                <div className="kv">
                  <span>PHONE</span>
                  <b>{phone}</b>
                </div>
                <div className="note">{email || '—'}</div>
              </div>

              {/* Summary */}
              <div className="block">
                <div className="h2">Summary</div>
                <div className="kv">
                  <span>Base</span>
                  <b className="mono">RM {cur(base)}</b>
                </div>
                <div className="kv">
                  <span>Total Earn</span>
                  <b className="mono">RM {cur(displayTotalEarn)}</b>
                </div>
                <div className="kv">
                  <span>Total Deduct</span>
                  <b className="mono">RM {cur(displayTotalDeduct)}</b>
                </div>
                <div className="kv">
                  <span>Net Pay</span>
                  <b className="mono" style={{ fontSize: 13 }}>
                    RM {cur(displayNetPay)}
                  </b>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10 }} className="grid2">
              {/* Earnings */}
              <div className="block">
                <div className="h2">Earnings</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="right">Amount (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Base salary</td>
                      <td className="right mono">{cur(base)}</td>
                    </tr>

                    {manualEarn.map((it) => (
                      <tr key={it.id}>
                        <td>{it.label || it.code || '—'}</td>
                        <td className="right mono">{cur(it.amount)}</td>
                      </tr>
                    ))}

                    <tr>
                      <td style={{ fontWeight: 700, background: '#f9fafb' }}>Total earnings</td>
                      <td style={{ fontWeight: 700, background: '#f9fafb' }} className="right mono">
                        {cur(displayTotalEarn)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Deductions */}
              <div className="block">
                <div className="h2">Deductions</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="right">Amount (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Unpaid Leave (ONE LINE ONLY) */}
                    <tr>
                      <td>
                        Unpaid leave
                        <div className="note">
                          {unpaidHasAnyAdjustment ? (
                            <>
                              auto {cur(unpaidAuto)}
                              {unpaidAdj !== 0 ? <> – adj {cur(unpaidAdj)}</> : null}
                              {unpaidExtra !== 0 ? <> + extra {cur(unpaidExtra)}</> : null}
                            </>
                          ) : (
                            <>auto {cur(unpaidAuto)}</>
                          )}
                        </div>
                      </td>
                      <td className="right mono">{cur(unpaidFinal)}</td>
                    </tr>

                    {manualDeduct.map((it) => (
                      <tr key={it.id}>
                        <td>{it.label || it.code || '—'}</td>
                        <td className="right mono">{cur(it.amount)}</td>
                      </tr>
                    ))}

                    <tr>
                      <td>EPF (Emp)</td>
                      <td className="right mono">{cur(epfEmp)}</td>
                    </tr>
                    <tr>
                      <td>SOCSO (Emp)</td>
                      <td className="right mono">{cur(socsoEmp)}</td>
                    </tr>
                    <tr>
                      <td>EIS (Emp)</td>
                      <td className="right mono">{cur(eisEmp)}</td>
                    </tr>

                    <tr>
                      <td style={{ fontWeight: 700, background: '#f9fafb' }}>Total deductions</td>
                      <td style={{ fontWeight: 700, background: '#f9fafb' }} className="right mono">
                        {cur(displayTotalDeduct)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Net Pay + Employer contribs */}
            <div style={{ marginTop: 10 }} className="grid2">
              <div className="block">
                <div className="h2">Net Pay</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>
                  RM {cur(displayNetPay)}
                </div>
                <div className="note">This is the amount payable to the employee.</div>
              </div>

              <div className="block">
                <div className="h2">Employer contributions (info)</div>
                <div className="kv">
                  <span>EPF (Er)</span>
                  <b className="mono">RM {cur(epfEr)}</b>
                </div>
                <div className="kv">
                  <span>SOCSO (Er)</span>
                  <b className="mono">RM {cur(socsoEr)}</b>
                </div>
                <div className="kv">
                  <span>EIS (Er)</span>
                  <b className="mono">RM {cur(eisEr)}</b>
                </div>
              </div>
            </div>

            <div className="footer">This is a computer-generated payslip. No signature is required.</div>

            {/* Error hint inside print (optional small) */}
            {!hasData && err && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#b91c1c' }}>
                Error: {err}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading/error toast (screen only) */}
      {loading && (
        <div className="no-print" style={{ position: 'fixed', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', padding: '8px 10px', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', fontSize: 13 }}>
            Loading…
          </div>
        </div>
      )}
      {err && (
        <div className="no-print" style={{ position: 'fixed', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239', padding: '8px 10px', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', fontSize: 13 }}>
            {err}
          </div>
        </div>
      )}
    </div>
  );
}