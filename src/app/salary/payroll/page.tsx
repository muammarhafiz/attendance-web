// src/app/salary/payroll/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Payslip = {
  staff_email: string;
  staff_name: string;
  base_pay: number;
  additions: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
};

type StaffLite = { email: string; name: string };

type RunOk = {
  ok: true;
  payslips: Payslip[];
  staff: StaffLite[];
  totals?: { count: number };
};

type RunErr = {
  ok: false;
  where?: string;
  error: string;
  code?: string;
};

type RunApiRes = RunOk | RunErr;

export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errMsg, setErrMsg] = useState<string>('');

  // Adjustment form
  const [selEmail, setSelEmail] = useState<string>('');
  const [kind, setKind] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [amount, setAmount] = useState<string>('');
  const [label, setLabel] = useState<string>('');

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErrMsg('');
      try {
        const r = await fetch('/salary/api/run', {
          cache: 'no-store',
          credentials: 'include',
        });
        const j = (await r.json()) as RunApiRes;

        if (!r.ok || !j.ok) {
          const msg = !r.ok
            ? `HTTP ${r.status}`
            : (('ok' in j && j.ok === false) && (j.error || j.where))
              ? `${j.where ? j.where + ': ' : ''}${j.error ?? 'Failed'}`
              : 'Unknown error';
          throw new Error(msg);
        }

        if (!mounted) return;
        setRows(j.payslips);
        setStaff(j.staff ?? []);
        setLastRunAt(new Date().toLocaleString());
      } catch (e) {
        if (!mounted) return;
        setErrMsg(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const totalNet = useMemo(
    () => rows.reduce((acc, r) => acc + r.net_pay, 0),
    [rows]
  );

  async function handleAddAdjustment(ev: React.FormEvent) {
    ev.preventDefault();
    setErrMsg('');

    const amt = Number((amount || '').replace(/[, ]/g, ''));
    if (!selEmail) return setErrMsg('Select a staff.');
    if (!Number.isFinite(amt) || amt < 0) return setErrMsg('Amount must be ≥ 0.');

    try {
      // Create manual adjustment
      const r = await fetch('/salary/api/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_email: selEmail,
          kind,
          amount: amt,
          label: label || null,
        }),
      });

      const j = (await r.json()) as { ok: boolean; where?: string; error?: string };

      if (!r.ok || !j.ok) {
        const msg = !r.ok
          ? `HTTP ${r.status}`
          : j.error
            ? `${j.where ? j.where + ': ' : ''}${j.error}`
            : 'Failed to add adjustment';
        throw new Error(msg);
      }

      // Refresh table after successful add
      const runRes = await fetch('/salary/api/run', {
        cache: 'no-store',
        credentials: 'include',
      });
      const runJson = (await runRes.json()) as RunApiRes;
      if (!runRes.ok || !runJson.ok) {
        const msg =
          !runRes.ok
            ? `HTTP ${runRes.status}`
            : (('ok' in runJson && runJson.ok === false) && (runJson.error || runJson.where))
              ? `${runJson.where ? runJson.where + ': ' : ''}${runJson.error ?? 'Failed'}`
              : 'Unknown error';
        throw new Error(`Saved, but failed to refresh table. ${msg}`);
      }

      setRows(runJson.payslips);
      setStaff(runJson.staff ?? []);
      setLastRunAt(new Date().toLocaleString());
      setAmount('');
      setLabel('');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to add adjustment');
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Payroll</h1>

      {/* Adjustment Box */}
      <div className="border rounded-lg p-4 shadow-sm">
        <h2 className="font-medium mb-3">Adjustment</h2>
        <form
          onSubmit={handleAddAdjustment}
          className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
        >
          <div className="flex flex-col">
            <label className="text-sm mb-1">Staff</label>
            <select
              className="border rounded px-2 py-1"
              value={selEmail}
              onChange={(e) => setSelEmail(e.target.value)}
              required
            >
              <option value="">— Select —</option>
              {staff.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name || s.email}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-sm mb-1">Kind</label>
            <select
              className="border rounded px-2 py-1"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'EARN' | 'DEDUCT')}
            >
              <option value="EARN">EARN</option>
              <option value="DEDUCT">DEDUCT</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-sm mb-1">Amount</label>
            <input
              className="border rounded px-2 py-1"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col md:col-span-2">
            <label className="text-sm mb-1">Label (optional)</label>
            <input
              className="border rounded px-2 py-1"
              placeholder="e.g. Commission, Penalty, Bonus…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="md:col-span-5">
            <button
              type="submit"
              className="mt-1 inline-flex items-center gap-2 border rounded px-3 py-1"
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      </div>

      {/* Error banner */}
      {errMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3">
          {errMsg}
        </div>
      )}

      {/* Payroll Table */}
      <div className="border rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Current Period</h2>
          <div className="text-sm text-gray-500">
            {lastRunAt ? `Last updated: ${lastRunAt}` : null}
          </div>
        </div>

        {loading && <div className="text-sm">Loading…</div>}

        {!loading && rows.length === 0 && (
          <div className="text-sm text-gray-600">No rows.</div>
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Base</th>
                  <th className="py-2 pr-2">Additions</th>
                  <th className="py-2 pr-2">Deductions</th>
                  <th className="py-2 pr-2">Gross</th>
                  <th className="py-2 pr-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_email} className="border-b last:border-0">
                    <td className="py-2 pr-2">{r.staff_name}</td>
                    <td className="py-2 pr-2">{r.staff_email}</td>
                    <td className="py-2 pr-2">{formatMYR(r.base_pay)}</td>
                    <td className="py-2 pr-2">{formatMYR(r.additions)}</td>
                    <td className="py-2 pr-2">{formatMYR(r.deductions)}</td>
                    <td className="py-2 pr-2">{formatMYR(r.gross_pay)}</td>
                    <td className="py-2 pr-2 font-medium">{formatMYR(r.net_pay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="py-2 pr-2 font-medium" colSpan={6}>
                    Total Net
                  </td>
                  <td className="py-2 pr-2 font-semibold">
                    {formatMYR(totalNet)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatMYR(n: number): string {
  return `RM ${n.toFixed(2)}`;
}