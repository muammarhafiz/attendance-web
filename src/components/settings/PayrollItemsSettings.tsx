// src/components/settings/PayrollItemsSettings.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------- types ---------- */
type ItemType = {
  id: string;
  code: string;
  name: string;
  category: string;
  kind: 'EARN' | 'DEDUCT';
  per_unit: boolean;
  in_gross: boolean;
  in_net: boolean;
  stat_epf: boolean;
  stat_socso: boolean;
  stat_eis: boolean;
  stat_hrdf: boolean;
  pcb_exemption_limit: number | string;
  ea_field: string;
  is_custom: boolean;
  is_system: boolean;
  enabled: boolean;
  sort_order: number;
  archived_at: string | null;
  law_epf?: string | null;
  law_socso?: string | null;
  law_eis?: string | null;
  law_note?: string | null;
  law_deduct?: string | null; // EA 1955 s.24 status for deduction items: ALLOWED | CONDITIONS | NOT_ALLOWED
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'REMUNERATION', label: 'Remunerations' },
  { key: 'ALLOWANCE', label: 'Allowances' },
  { key: 'BIK', label: 'Benefits in Kind' },
  { key: 'PERQUISITE', label: 'Other Perquisites' },
  { key: 'TAX_DEDUCTION', label: 'Tax Deductions' },
  { key: 'PAYROLL_DEDUCTION', label: 'Payroll Deductions' },
];

const EA_FIELDS = ['None', 'B.1 (a)', 'B.1 (b)', 'B.1 (c)', 'B.1 (d)', 'B.1 (e)', 'B.1 (f)', 'B.3', 'B.4', 'B.6', 'D.1', 'D.2', 'D.3', 'D.5 (a)', 'D.5 (b)', 'E.1', 'F', 'F / B.1 (c)', 'F / B.3'];
const DEDUCT_CATS = new Set(['TAX_DEDUCTION', 'PAYROLL_DEDUCTION']);

const blankForm = (category: string): Partial<ItemType> => ({
  code: '', name: '', category,
  kind: DEDUCT_CATS.has(category) ? 'DEDUCT' : 'EARN',
  per_unit: false, in_gross: !DEDUCT_CATS.has(category), in_net: true,
  stat_epf: false, stat_socso: false, stat_eis: false, stat_hrdf: false,
  pcb_exemption_limit: 0, ea_field: 'None', enabled: true,
});

const STAT_DEFS: { key: keyof ItemType; color: string; title: string }[] = [
  { key: 'stat_epf', color: '#d97706', title: 'EPF' },
  { key: 'stat_socso', color: '#e11d48', title: 'SOCSO' },
  { key: 'stat_eis', color: '#0284c7', title: 'EIS' },
  { key: 'stat_hrdf', color: '#059669', title: 'HRDF' },
];

function StatDots({ it }: { it: ItemType }) {
  return (
    <span className="inline-flex gap-1">
      {STAT_DEFS.map((d) => (
        <span key={d.title} title={d.title} className="inline-block h-3 w-3 rounded-sm"
          style={{ background: it[d.key] ? d.color : '#e5e7eb' }} />
      ))}
    </span>
  );
}
const Tick = ({ on }: { on: boolean }) => <span className={on ? 'text-good' : 'text-ink-3'}>{on ? '✓' : '—'}</span>;

function LawBadge({ label, val }: { label: string; val?: string | null }) {
  if (!val) return null;
  const bg = val === 'YES' ? '#16a34a' : val === 'DEPENDS' ? '#d97706' : '#e2e8f0';
  const fg = val === 'NO' ? '#64748b' : '#fff';
  return <span className="inline-block rounded px-1 text-[9px] font-bold leading-4" style={{ background: bg, color: fg }} title={`${label} ${val}`}>{label}</span>;
}
// EA 1955 s.24 status badge for deduction items.
const DEDUCT_LAW: Record<string, { bg: string; label: string }> = {
  ALLOWED: { bg: '#16a34a', label: 'EA §24 ✓' },
  CONDITIONS: { bg: '#d97706', label: 'EA §24 ⚠' },
  NOT_ALLOWED: { bg: '#dc2626', label: 'EA §24 ✕' },
};
// "By law": earnings → EPF/SOCSO/EIS treatment (KWSP/PERKESO); deductions → EA 1955 s.24 status.
function LawCell({ it }: { it: ItemType }) {
  if (it.kind === 'DEDUCT') {
    const d = it.law_deduct ? DEDUCT_LAW[it.law_deduct] : null;
    if (!d) return <span className="text-ink-3">—</span>;
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: d.bg }} title={it.law_note || ''}>{d.label}</span>;
  }
  if (it.kind !== 'EARN' || (!it.law_epf && !it.law_socso && !it.law_eis)) return <span className="text-ink-3">—</span>;
  const gap =
    (it.law_epf === 'YES' && !it.stat_epf) ||
    (it.law_socso === 'YES' && !it.stat_socso) ||
    (it.law_eis === 'YES' && !it.stat_eis);
  return (
    <span className="inline-flex items-center gap-1" title={it.law_note || ''}>
      <LawBadge label="EPF" val={it.law_epf} />
      <LawBadge label="SOC" val={it.law_socso} />
      <LawBadge label="EIS" val={it.law_eis} />
      {gap && <span title="Law says subject, but currently not charged" className="text-warn">⚠</span>}
    </span>
  );
}

export default function PayrollItemsSettings() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<Partial<ItemType> | null>(null);
  const [saving, setSaving] = useState(false);
  // Punctuality allowance settings (pay_v2.payroll_settings key/value).
  const [pEnabled, setPEnabled] = useState(false);
  const [pAmount, setPAmount] = useState('150');
  const [pMaxLate, setPMaxLate] = useState('4');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.schema('pay_v2').from('payroll_item_types')
      .select('*').is('archived_at', null).order('sort_order');
    if (error) setMsg({ kind: 'err', text: error.message });
    else setItems((data as ItemType[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const loadPunc = useCallback(async () => {
    const { data } = await supabase.schema('pay_v2').from('payroll_settings')
      .select('key,value').in('key', ['punctuality_enabled', 'punctuality_amount', 'punctuality_max_late']);
    const rows = (data ?? []) as { key: string; value: string }[];
    const g = (k: string) => rows.find((r) => r.key === k)?.value;
    setPEnabled(['on', 'true', '1', 'yes'].includes(String(g('punctuality_enabled') ?? '').toLowerCase()));
    if (g('punctuality_amount')) setPAmount(String(g('punctuality_amount')));
    if (g('punctuality_max_late')) setPMaxLate(String(g('punctuality_max_late')));
  }, []);
  useEffect(() => { if (isAdmin) loadPunc(); }, [isAdmin, loadPunc]);

  const savePuncKey = async (key: string, value: string) => {
    const { error } = await supabase.schema('pay_v2').from('payroll_settings')
      .update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) { setMsg({ kind: 'err', text: error.message }); return false; }
    return true;
  };
  const togglePunc = async () => {
    const next = !pEnabled; setPEnabled(next);
    if (await savePuncKey('punctuality_enabled', next ? 'on' : 'off'))
      setMsg({ kind: 'ok', text: next ? 'Punctuality allowance ON — re-Generate a month to apply it.' : 'Punctuality allowance turned off.' });
    else setPEnabled(!next);
  };
  const savePuncNumbers = async () => {
    const amt = String(Math.max(0, Math.round((Number(pAmount) || 0) * 100) / 100));
    const max = String(Math.max(0, Math.floor(Number(pMaxLate) || 0)));
    const ok1 = await savePuncKey('punctuality_amount', amt);
    const ok2 = await savePuncKey('punctuality_max_late', max);
    if (ok1 && ok2) { setPAmount(amt); setPMaxLate(max); setMsg({ kind: 'ok', text: 'Punctuality allowance saved — re-Generate a month to apply it.' }); }
  };

  const grouped = useMemo(() => {
    const m: Record<string, ItemType[]> = {};
    for (const c of CATEGORIES) m[c.key] = [];
    for (const it of items) (m[it.category] ??= []).push(it);
    return m;
  }, [items]);

  const toggleEnabled = async (it: ItemType) => {
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)));
    const { error } = await supabase.schema('pay_v2').from('payroll_item_types')
      .update({ enabled: !it.enabled, updated_at: new Date().toISOString() }).eq('id', it.id);
    if (error) { setMsg({ kind: 'err', text: error.message }); load(); }
  };

  const archive = async (it: ItemType) => {
    if (it.is_system) { setMsg({ kind: 'err', text: `"${it.name}" is a system item and can't be archived.` }); return; }
    if (!confirm(`Archive "${it.name}"? It will no longer be selectable when adding pay items.`)) return;
    const { error } = await supabase.schema('pay_v2').from('payroll_item_types')
      .update({ archived_at: new Date().toISOString() }).eq('id', it.id);
    if (error) setMsg({ kind: 'err', text: error.message });
    else { setItems((prev) => prev.filter((x) => x.id !== it.id)); setMsg({ kind: 'ok', text: 'Archived.' }); }
  };

  const save = async () => {
    if (!editing) return;
    const f = editing;
    const name = (f.name || '').trim();
    if (!name) { setMsg({ kind: 'err', text: 'Name is required.' }); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name, category: f.category, kind: f.kind,
      per_unit: !!f.per_unit, in_gross: !!f.in_gross, in_net: !!f.in_net,
      stat_epf: !!f.stat_epf, stat_socso: !!f.stat_socso, stat_eis: !!f.stat_eis, stat_hrdf: !!f.stat_hrdf,
      pcb_exemption_limit: Number(f.pcb_exemption_limit) || 0,
      ea_field: f.ea_field || 'None', enabled: f.enabled !== false,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (f.id) {
      ({ error } = await supabase.schema('pay_v2').from('payroll_item_types').update(payload).eq('id', f.id));
    } else {
      const code = (f.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!code) { setSaving(false); setMsg({ kind: 'err', text: 'Code is required.' }); return; }
      ({ error } = await supabase.schema('pay_v2').from('payroll_item_types')
        .insert({ ...payload, code, is_custom: true, is_system: false, sort_order: 500 }));
    }
    setSaving(false);
    if (error) setMsg({ kind: 'err', text: error.message });
    else { setEditing(null); setMsg({ kind: 'ok', text: 'Saved.' }); await load(); }
  };

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-2">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">This page is for admins only.</div>;

  const set = (patch: Partial<ItemType>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  return (
    <div>
      {/* Punctuality allowance */}
      <div className="mb-6 rounded-card bg-card shadow-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Punctuality allowance</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-2">
              A monthly attendance bonus that staff <b>forfeit if they&apos;re late too often</b>. It counts as wages, so
              EPF/SOCSO/EIS apply. Off by default — turn it on and re-Generate a month to apply it.
            </p>
          </div>
          <button role="switch" aria-checked={pEnabled} onClick={togglePunc}
            className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${pEnabled ? 'bg-good' : 'bg-ink/15'}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-card shadow transition ${pEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        {pEnabled && (
          <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-line pt-3">
            <label className="text-xs font-medium text-ink-2">Amount (RM / month)
              <input type="number" min="0" value={pAmount} onChange={(e) => setPAmount(e.target.value)}
                className="mt-0.5 block w-32 rounded-md border border-line px-2 py-1.5 text-right text-sm tabular-nums" />
            </label>
            <label className="text-xs font-medium text-ink-2">Lose it if late more than…
              <div className="mt-0.5 flex items-center gap-1.5">
                <input type="number" min="0" value={pMaxLate} onChange={(e) => setPMaxLate(e.target.value)}
                  className="w-20 rounded-md border border-line px-2 py-1.5 text-right text-sm tabular-nums" />
                <span className="text-sm text-ink-2">times a month</span>
              </div>
            </label>
            <button onClick={savePuncNumbers} className="rounded-md bg-btn px-3 py-1.5 text-sm font-medium text-btn-ink hover:opacity-90">Save</button>
            <span className="text-[11px] text-ink-3">Every late day counts (no grace).</span>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Payroll Items</h2>
        <span className="text-sm text-ink-2">Define the earning &amp; deduction types used across payroll.</span>
        <button onClick={() => setEditing(blankForm('REMUNERATION'))}
          className="ml-auto rounded-md bg-btn px-3 py-2 text-sm font-medium text-btn-ink hover:opacity-90">+ Payroll Item</button>
      </div>

      {msg && <div className={`mb-3 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-good-soft text-good' : 'border-rose-200 bg-bad-soft text-bad'}`}>{msg.text}</div>}

      {loading ? (
        <div className="text-sm text-ink-2">Loading…</div>
      ) : (
        CATEGORIES.map((c) => {
          const rows = grouped[c.key] ?? [];
          if (!rows.length) return null;
          return (
            <section key={c.key} className="mb-6 overflow-x-auto rounded-card bg-card shadow-card">
              <div className="border-b bg-ink/5 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-2">{c.label}</div>
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead className="bg-card text-left text-xs uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-center font-medium">Per unit</th>
                    <th className="px-3 py-2 text-center font-medium">Gross</th>
                    <th className="px-3 py-2 text-center font-medium">Net</th>
                    <th className="px-3 py-2 text-center font-medium">Statutory (set)</th>
                    <th className="px-3 py-2 text-center font-medium">By law</th>
                    <th className="px-3 py-2 text-right font-medium">PCB exempt.</th>
                    <th className="px-3 py-2 font-medium">EA field</th>
                    <th className="px-3 py-2 text-center font-medium">Enabled</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id} className={`border-t border-line ${it.enabled ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{it.name}</span>
                        {it.is_custom && <span className="ml-2 rounded bg-accent-weak px-1.5 py-0.5 text-[10px] font-semibold text-accent">CUSTOM</span>}
                        {it.is_system && <span className="ml-2 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">SYSTEM</span>}
                        <div className="text-xs text-ink-3">{it.code}</div>
                      </td>
                      <td className="px-3 py-2 text-center"><Tick on={it.per_unit} /></td>
                      <td className="px-3 py-2 text-center"><Tick on={it.in_gross} /></td>
                      <td className="px-3 py-2 text-center"><Tick on={it.in_net} /></td>
                      <td className="px-3 py-2 text-center"><StatDots it={it} /></td>
                      <td className="px-3 py-2 text-center"><LawCell it={it} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{Number(it.pcb_exemption_limit) ? Number(it.pcb_exemption_limit).toLocaleString('en-MY') : '—'}</td>
                      <td className="px-3 py-2 text-ink-2">{it.ea_field}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => toggleEnabled(it)} title={it.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${it.enabled ? 'bg-good' : 'bg-ink/15'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-card transition ${it.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(it)} className="rounded border px-2 py-0.5 text-xs hover:bg-ink/5">Edit</button>
                        {!it.is_system && <button onClick={() => archive(it)} className="ml-1 rounded border px-2 py-0.5 text-xs text-bad hover:bg-bad-soft">Archive</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}

      <p className="mt-2 text-xs text-ink-3">
        <b>Statutory (set)</b> = your dots: <span className="font-semibold text-warn">EPF</span> · <span className="font-semibold text-bad">SOCSO</span> ·
        {' '}<span className="font-semibold text-accent">EIS</span> · <span className="font-semibold text-good">HRDF</span>.
        <br /><b>By law</b> = the standard KWSP/PERKESO treatment (<span className="font-semibold text-good">YES</span> / <span className="font-semibold text-warn">DEPENDS</span> / <span className="font-semibold text-ink-3">NO</span>);
        {' '}<span className="text-warn">⚠</span> means the law treats it as subject but it&apos;s currently switched off. Final classification depends on how a payment is structured — confirm with your accountant.
        <br />For <b>deductions</b>, By law shows the <b>Employment Act 1955 §24</b> status: <span className="font-semibold text-good">✓ allowed</span> / <span className="font-semibold text-warn">⚠ conditions</span> / <span className="font-semibold text-bad">✕ not a lawful deduction</span> (hover for the rule).
        <br />PCB-exemption &amp; EA-field are stored for the future PCB / EA-form features and don&apos;t affect pay yet.
      </p>

      {/* Add / Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget && !saving) setEditing(null); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">{editing.id ? 'Edit payroll item' : 'New payroll item'}</div>
              <button onClick={() => setEditing(null)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-ink/5">Close</button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Name</label>
                <input value={editing.name ?? ''} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-md border px-2 py-1.5" placeholder="e.g. Travel Allowance" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Code</label>
                  <input value={editing.code ?? ''} disabled={!!editing.id}
                    onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                    className="w-full rounded-md border px-2 py-1.5 disabled:bg-ink/5 disabled:text-ink-2" placeholder="TRAVEL_ALLOW" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Category</label>
                  <select value={editing.category} onChange={(e) => { const cat = e.target.value; set({ category: cat, kind: DEDUCT_CATS.has(cat) ? 'DEDUCT' : 'EARN', in_gross: !DEDUCT_CATS.has(cat) }); }}
                    className="w-full rounded-md border px-2 py-1.5">
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
                  <select value={editing.kind} onChange={(e) => set({ kind: e.target.value as 'EARN' | 'DEDUCT' })} className="w-full rounded-md border px-2 py-1.5">
                    <option value="EARN">Earning</option><option value="DEDUCT">Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">EA field</label>
                  <select value={editing.ea_field} onChange={(e) => set({ ea_field: e.target.value })} className="w-full rounded-md border px-2 py-1.5">
                    {EA_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-line bg-ink/5 p-3">
                {([['per_unit', 'Per unit'], ['in_gross', 'Part of gross'], ['in_net', 'Part of net']] as const).map(([k, lbl]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!editing[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<ItemType>)} />{lbl}</label>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-ink-2">Subject to statutory</div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-line bg-ink/5 p-3">
                  {([['stat_epf', 'EPF'], ['stat_socso', 'SOCSO'], ['stat_eis', 'EIS'], ['stat_hrdf', 'HRDF']] as const).map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!editing[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<ItemType>)} />{lbl}</label>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-ink-3">These don&apos;t change pay yet — engine wiring is a later step.</div>
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">PCB exemption limit (RM/yr)</label>
                  <input type="number" value={Number(editing.pcb_exemption_limit) || 0} onChange={(e) => set({ pcb_exemption_limit: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-right tabular-nums" />
                </div>
                <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={editing.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />Enabled</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-ink/5">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-md bg-btn px-3 py-1.5 text-sm font-medium text-btn-ink hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
