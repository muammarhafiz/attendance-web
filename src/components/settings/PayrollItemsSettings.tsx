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
const Tick = ({ on }: { on: boolean }) => <span className={on ? 'text-emerald-600' : 'text-gray-300'}>{on ? '✓' : '—'}</span>;

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
    if (!d) return <span className="text-gray-300">—</span>;
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: d.bg }} title={it.law_note || ''}>{d.label}</span>;
  }
  if (it.kind !== 'EARN' || (!it.law_epf && !it.law_socso && !it.law_eis)) return <span className="text-gray-300">—</span>;
  const gap =
    (it.law_epf === 'YES' && !it.stat_epf) ||
    (it.law_socso === 'YES' && !it.stat_socso) ||
    (it.law_eis === 'YES' && !it.stat_eis);
  return (
    <span className="inline-flex items-center gap-1" title={it.law_note || ''}>
      <LawBadge label="EPF" val={it.law_epf} />
      <LawBadge label="SOC" val={it.law_socso} />
      <LawBadge label="EIS" val={it.law_eis} />
      {gap && <span title="Law says subject, but currently not charged" className="text-amber-600">⚠</span>}
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

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const set = (patch: Partial<ItemType>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Payroll Items</h2>
        <span className="text-sm text-gray-500">Define the earning &amp; deduction types used across payroll.</span>
        <button onClick={() => setEditing(blankForm('REMUNERATION'))}
          className="ml-auto rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black">+ Payroll Item</button>
      </div>

      {msg && <div className={`mb-3 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        CATEGORIES.map((c) => {
          const rows = grouped[c.key] ?? [];
          if (!rows.length) return null;
          return (
            <section key={c.key} className="mb-6 overflow-x-auto rounded-lg border border-gray-200">
              <div className="border-b bg-gray-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-600">{c.label}</div>
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead className="bg-white text-left text-xs uppercase tracking-wide text-gray-400">
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
                    <tr key={it.id} className={`border-t border-gray-100 ${it.enabled ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-gray-900">{it.name}</span>
                        {it.is_custom && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">CUSTOM</span>}
                        {it.is_system && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">SYSTEM</span>}
                        <div className="text-xs text-gray-400">{it.code}</div>
                      </td>
                      <td className="px-3 py-2 text-center"><Tick on={it.per_unit} /></td>
                      <td className="px-3 py-2 text-center"><Tick on={it.in_gross} /></td>
                      <td className="px-3 py-2 text-center"><Tick on={it.in_net} /></td>
                      <td className="px-3 py-2 text-center"><StatDots it={it} /></td>
                      <td className="px-3 py-2 text-center"><LawCell it={it} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{Number(it.pcb_exemption_limit) ? Number(it.pcb_exemption_limit).toLocaleString('en-MY') : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{it.ea_field}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => toggleEnabled(it)} title={it.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${it.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${it.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(it)} className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50">Edit</button>
                        {!it.is_system && <button onClick={() => archive(it)} className="ml-1 rounded border px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50">Archive</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}

      <p className="mt-2 text-xs text-gray-400">
        <b>Statutory (set)</b> = your dots: <span className="font-semibold text-amber-600">EPF</span> · <span className="font-semibold text-rose-600">SOCSO</span> ·
        {' '}<span className="font-semibold text-sky-600">EIS</span> · <span className="font-semibold text-emerald-600">HRDF</span>.
        <br /><b>By law</b> = the standard KWSP/PERKESO treatment (<span className="font-semibold text-green-700">YES</span> / <span className="font-semibold text-amber-600">DEPENDS</span> / <span className="font-semibold text-slate-400">NO</span>);
        {' '}<span className="text-amber-600">⚠</span> means the law treats it as subject but it&apos;s currently switched off. Final classification depends on how a payment is structured — confirm with your accountant.
        <br />For <b>deductions</b>, By law shows the <b>Employment Act 1955 §24</b> status: <span className="font-semibold text-green-700">✓ allowed</span> / <span className="font-semibold text-amber-600">⚠ conditions</span> / <span className="font-semibold text-red-600">✕ not a lawful deduction</span> (hover for the rule).
        <br />PCB-exemption &amp; EA-field are stored for the future PCB / EA-form features and don&apos;t affect pay yet.
      </p>

      {/* Add / Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={(e) => { if (e.target === e.currentTarget && !saving) setEditing(null); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">{editing.id ? 'Edit payroll item' : 'New payroll item'}</div>
              <button onClick={() => setEditing(null)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-gray-50">Close</button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <input value={editing.name ?? ''} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-md border px-2 py-1.5" placeholder="e.g. Travel Allowance" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Code</label>
                  <input value={editing.code ?? ''} disabled={!!editing.id}
                    onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                    className="w-full rounded-md border px-2 py-1.5 disabled:bg-gray-100 disabled:text-gray-500" placeholder="TRAVEL_ALLOW" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                  <select value={editing.category} onChange={(e) => { const cat = e.target.value; set({ category: cat, kind: DEDUCT_CATS.has(cat) ? 'DEDUCT' : 'EARN', in_gross: !DEDUCT_CATS.has(cat) }); }}
                    className="w-full rounded-md border px-2 py-1.5">
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
                  <select value={editing.kind} onChange={(e) => set({ kind: e.target.value as 'EARN' | 'DEDUCT' })} className="w-full rounded-md border px-2 py-1.5">
                    <option value="EARN">Earning</option><option value="DEDUCT">Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">EA field</label>
                  <select value={editing.ea_field} onChange={(e) => set({ ea_field: e.target.value })} className="w-full rounded-md border px-2 py-1.5">
                    {EA_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                {([['per_unit', 'Per unit'], ['in_gross', 'Part of gross'], ['in_net', 'Part of net']] as const).map(([k, lbl]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!editing[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<ItemType>)} />{lbl}</label>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-gray-600">Subject to statutory</div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                  {([['stat_epf', 'EPF'], ['stat_socso', 'SOCSO'], ['stat_eis', 'EIS'], ['stat_hrdf', 'HRDF']] as const).map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!editing[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<ItemType>)} />{lbl}</label>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-gray-400">These don&apos;t change pay yet — engine wiring is a later step.</div>
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">PCB exemption limit (RM/yr)</label>
                  <input type="number" value={Number(editing.pcb_exemption_limit) || 0} onChange={(e) => set({ pcb_exemption_limit: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-right tabular-nums" />
                </div>
                <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={editing.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />Enabled</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
