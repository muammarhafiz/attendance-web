// src/app/niagawan/cogs/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Zero = {
  id: number;
  audit_date: string; // YYYY-MM-DD
  inv: string | null;
  inv_date: string | null;
  item: string | null;
  code: string | null;
  price: string | null;
  updated_at: string | null;
};

type Rule = { id: number; match_type: string; value: string; notes: string | null };

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const priceNum = (s: string | null | undefined) => {
  const v = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : 0;
};

function fmtDay(d: string) {
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}

// Mirrors the Apps Script isIgnored_ exactly (case-insensitive).
function isIgnored(row: Zero, rules: Rule[]) {
  const name = String(row.item || '').trim().toLowerCase();
  const code = String(row.code || '').trim().toLowerCase();
  const price = priceNum(row.price);
  for (const r of rules) {
    const t = String(r.match_type || '').trim().toLowerCase();
    const v = String(r.value || '').trim().toLowerCase();
    if (!t || !v) continue;
    if (t === 'code_prefix' && code.startsWith(v)) return true;
    if (t === 'code_exact' && code === v) return true;
    if (t === 'code_contains' && code.includes(v)) return true;
    if (t === 'name_prefix' && name.startsWith(v)) return true;
    if (t === 'name_exact' && name === v) return true;
    if (t === 'name_contains' && name.includes(v)) return true;
    if (t === 'price_max' && price <= (parseFloat(v) || 0)) return true;
  }
  return false;
}

export default function NiagawanCogsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [zeros, setZeros] = useState<Zero[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [day, setDay] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else {
        setIsAdmin(false);
      }
    })();
  }, []);

  const loadRules = useCallback(async () => {
    const { data } = await supabase
      .from('niagawan_cogs_ignore')
      .select('id,match_type,value,notes')
      .order('match_type', { ascending: true });
    setRules((data ?? []) as Rule[]);
  }, []);

  const loadZeros = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('niagawan_cogs_zeros')
      .select('id,audit_date,inv,inv_date,item,code,price,updated_at')
      .order('audit_date', { ascending: false })
      .order('inv', { ascending: true })
      .limit(1000);
    if (error) setErr(error.message);
    else setZeros((data ?? []) as Zero[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadRules();
    loadZeros();
  }, [isAdmin, loadRules, loadZeros]);

  const days = useMemo(() => {
    const s = Array.from(new Set(zeros.map((z) => z.audit_date))).sort().reverse();
    return s;
  }, [zeros]);

  // default to the most recent day once data loads
  useEffect(() => {
    if (!day && days.length) setDay(days[0]);
  }, [days, day]);

  const dayRows = useMemo(() => zeros.filter((z) => z.audit_date === day), [zeros, day]);
  const kept = useMemo(() => dayRows.filter((r) => !isIgnored(r, rules)), [dayRows, rules]);
  const hidden = useMemo(() => dayRows.filter((r) => isIgnored(r, rules)), [dayRows, rules]);

  const stats = useMemo(() => {
    const invs = new Set<string>();
    let value = 0;
    for (const r of kept) {
      if (r.inv) invs.add(r.inv);
      value += priceNum(r.price);
    }
    return { parts: kept.length, invoices: invs.size, value, hidden: hidden.length };
  }, [kept, hidden]);

  const lastSynced = useMemo(() => {
    const t = dayRows.find((r) => r.updated_at)?.updated_at;
    return t ? new Date(t).toLocaleString('en-MY') : '—';
  }, [dayRows]);

  const ignoreRow = useCallback(
    async (row: Zero) => {
      const code = String(row.code || '').trim();
      const item = String(row.item || '').trim();
      const match_type = code ? 'code_exact' : 'name_exact';
      const value = code || item;
      if (!value) return;
      setBusy(row.id);
      const { error } = await supabase
        .from('niagawan_cogs_ignore')
        .insert({ match_type, value, notes: 'added from COGS page' });
      if (!error) await loadRules();
      setBusy(null);
    },
    [loadRules]
  );

  const deleteRule = useCallback(
    async (id: number) => {
      await supabase.from('niagawan_cogs_ignore').delete().eq('id', id);
      await loadRules();
    },
    [loadRules]
  );

  if (authed === null || isAdmin === null) {
    return <div className="text-sm text-gray-500">Checking session…</div>;
  }
  if (authed === false) return <div className="text-sm text-gray-600">Please sign in to view this page.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Parts to chase</h2>
          {days.length > 0 && (
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="text-xs text-gray-400">Last synced: {lastSynced}</span>
      </div>

      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Real parts sold with <strong>no cost entered in Niagawan</strong> for the selected day. Enter their cost in
        Niagawan, then re-sync — fixed items drop off. Labour, services and notes are hidden by your ignore rules.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500">Parts to chase</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{stats.parts}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500">Invoices affected</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{stats.invoices}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500">Sales with no cost</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{rm(stats.value)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-medium text-gray-500">Hidden (rules)</div>
          <div className="mt-1 text-lg font-semibold text-gray-400">{stats.hidden}</div>
        </div>
      </div>

      {err && <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{err}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : kept.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          Nothing to chase for {day ? fmtDay(day) : 'this day'} — every part has a cost (or is covered by an ignore
          rule). 🎉
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-gray-700">Invoice</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Item</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Code</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Price</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {kept.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{r.inv || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{r.item || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{r.code || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-gray-900">{rm(priceNum(r.price))}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => ignoreRow(r)}
                      disabled={busy === r.id}
                      title={
                        r.code
                          ? `Hide all items with code ${r.code}`
                          : `Hide items named "${r.item}"`
                      }
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    >
                      {busy === r.id ? '…' : 'Ignore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hidden items (transparency) */}
      {hidden.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
          >
            {showHidden ? 'Hide' : 'Show'} {hidden.length} line(s) hidden by ignore rules
          </button>
          {showHidden && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <tbody className="divide-y divide-gray-100 bg-gray-50">
                  {hidden.map((r) => (
                    <tr key={r.id} className="text-gray-400">
                      <td className="whitespace-nowrap px-3 py-1.5">{r.inv || '—'}</td>
                      <td className="px-3 py-1.5">{r.item || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.code || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">{rm(priceNum(r.price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Ignore rules manager */}
      <div className="mt-6">
        <button
          onClick={() => setShowRules((s) => !s)}
          className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
        >
          {showRules ? 'Hide' : 'Manage'} ignore rules ({rules.length})
        </button>
        {showRules && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs text-gray-500">
              These rules decide what to hide from the chase list (labour, services, notes). Click “Ignore” on any row
              above to add one; delete here to bring an item back.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="px-2 py-1 font-semibold">Match type</th>
                    <th className="px-2 py-1 font-semibold">Value</th>
                    <th className="px-2 py-1 font-semibold">Notes</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-2 py-1 text-gray-700">{r.match_type}</td>
                      <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-900">{r.value}</td>
                      <td className="px-2 py-1 text-gray-500">{r.notes || ''}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        <button
                          onClick={() => deleteRule(r.id)}
                          className="rounded-md border border-gray-200 px-2 py-0.5 text-rose-600 transition hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
