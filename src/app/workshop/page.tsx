// src/app/workshop/page.tsx — the workshop job board.
// Every signed-in staff PC shows this: cars in the shop as cards moving through
// Pending Job -> Done, plus memos for everyone.
// Supervisors/admins create cards + memos; anyone can move a card's status.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

type Card = {
  id: string;
  plate: string;
  vehicle: string | null;
  customer: string | null;
  problem: string | null;
  mechanic: string | null;
  status: 'waiting' | 'doing' | 'waiting_parts' | 'done';
  parts_note: string | null;
  created_at: string;
  started_at: string | null;
  done_at: string | null;
  archived_at: string | null;
  sale_inv: string | null;
  sale_id: string | null;
  customer_phone: string | null; // manual override for the WhatsApp button (preferred over check-in/invoice)
};

type Memo = { id: number; text: string; created_at: string; active: boolean };
type StaffName = { staff_name: string; staff_position: string };
type Debt = {
  sale_id: string; sale_inv_no: string | null; vehicle_label: string | null; ptoken: string | null;
  total: number | null; paid: number | null; balance: number | null; status: string | null;
  sale_date: string | null; age_days: number | null;
};
type Contact = { phone: string | null; cust_name: string | null };

const COLS: { key: 'pending' | 'done'; label: string; tint: string; head: string }[] = [
  { key: 'pending', label: 'Pending Job', tint: 'bg-gray-50', head: 'text-gray-600' },
  { key: 'done', label: 'Done', tint: 'bg-emerald-50/60', head: 'text-emerald-700' },
];

function ago(iso: string | null) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const rm = (n: number | null) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Turn a Malaysian phone (any format) into a wa.me number: digits only, international, no leading 0/+.
function waNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('60')) { /* already international */ }
  else if (d.startsWith('0')) d = '60' + d.slice(1);
  else d = '60' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// Pre-filled WhatsApp message for a card, matched to its board status (so we never claim
// "ready" on a car that isn't done). Wording is intentionally simple — easy to adjust.
function waCardText(status: Card['status'], name: string, veh: string): string {
  const msg: Record<Card['status'], string> = {
    waiting: `Hi ${name}, we've received your ${veh} at ZORDAQ Auto Services. We'll keep you updated.`,
    doing: `Hi ${name}, your ${veh} is being worked on at ZORDAQ Auto Services. We'll let you know once it's ready.`,
    waiting_parts: `Hi ${name}, your ${veh} is waiting for parts at ZORDAQ Auto Services. We'll update you soon.`,
    done: `Hi ${name}, your ${veh} is ready for collection at ZORDAQ Auto Services. Thank you!`,
  };
  return msg[status];
}

export default function WorkshopBoardPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null); // null = still checking; supervisors/admins only
  const [cards, setCards] = useState<Card[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({}); // sale_id -> customer phone/name, for the "car ready" WhatsApp button
  const [memos, setMemos] = useState<Memo[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtYear, setDebtYear] = useState(''); // '' = default to newest year present; 'all' = every year
  const [staffNames, setStaffNames] = useState<StaffName[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // new-card form
  const [showForm, setShowForm] = useState(false);
  const [plate, setPlate] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [problem, setProblem] = useState('');
  const [mechanic, setMechanic] = useState('');
  const [partsNote, setPartsNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [newMemo, setNewMemo] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: w } = await supabase.rpc('can_access', { p_feature: 'workshop' });
        setCanWrite(w === true);
        if (w === true) {
          const { data: names } = await supabase.rpc('board_staff_names');
          setStaffNames((names ?? []) as StaffName[]);
        }
      } else setCanWrite(false);
    })();
  }, []);

  const load = useCallback(async () => {
    const [{ data: c, error: ce }, { data: m }, { data: d }] = await Promise.all([
      supabase.from('job_cards').select('*').is('archived_at', null).order('created_at', { ascending: true }),
      supabase.from('memos').select('*').eq('active', true).order('created_at', { ascending: false }).limit(5),
      supabase.from('v_workshop_debts').select('*').order('sale_date', { ascending: true }),
    ]);
    if (ce) setErr(ce.message);
    else { setCards((c ?? []) as Card[]); setErr(null); }
    setMemos((m ?? []) as Memo[]);
    setDebts((d ?? []) as Debt[]);

    // Customer phones for the "car ready" WhatsApp button (joined to a card by Niagawan sale_id).
    // RLS lets board writers (admins/Supervisors) read intake_requests; anyone else just gets no button.
    const saleIds = Array.from(new Set(((c ?? []) as Card[]).map((x) => x.sale_id).filter(Boolean) as string[]));
    if (saleIds.length) {
      // Best phone per sale: check-in phone first, then the Niagawan invoice phone (via a
      // SECURITY DEFINER RPC so the board can use the invoice number without a check-in).
      const { data: ph } = await supabase.rpc('board_card_phones', { p_sale_ids: saleIds });
      const map: Record<string, Contact> = {};
      ((ph ?? []) as { sale_id: string | null; phone: string | null; cust_name: string | null }[]).forEach((r) => {
        if (r.sale_id) map[r.sale_id] = { phone: r.phone, cust_name: r.cust_name };
      });
      setContacts(map);
    } else {
      setContacts({});
    }
  }, []);

  // Live board: refresh every 15s so every supervisor PC stays current.
  useEffect(() => {
    if (authed && canWrite === true) load();
  }, [authed, canWrite, load]);
  // Live board refresh — paused while the tab is hidden (see hook), so a backgrounded
  // supervisor PC stops re-fetching the whole board every 15s. Refreshes on refocus.
  useVisibleInterval(load, 15000, authed && canWrite === true);

  // One refresh for the whole workshop system: pull latest payment status from Niagawan
  // (so paid cars move to Done, new check-ins appear) AND reload the board now. The same
  // sync also refreshes the data the Part Arrived page reads.
  const refreshAll = useCallback(async () => {
    setSyncMsg('Refreshing…');
    await supabase.rpc('request_workshop_sync'); // board-writers trigger a Niagawan sync; others just reload
    // Self-heal: the payment sync bulk-writes invoices in a way that skips the
    // close-on-paid trigger, so paid cars would otherwise stay in Pending. Sweep
    // them to Done now, then again after the sync lands fresh payment status.
    await supabase.rpc('close_paid_job_cards');
    // Also self-heal orphans: a Pending card >2 days old whose invoice has vanished
    // from BOTH the sales table and the all-years Debts snapshot was cancelled or
    // paid-and-aged-out — no longer an active job — so archive it off the board.
    await supabase.rpc('close_stale_orphan_cards');
    await load();
    setSyncMsg('Syncing with Niagawan… paid cars move to Done and new check-ins appear within a few seconds.');
    const heal = async () => { await supabase.rpc('close_paid_job_cards'); await load(); };
    setTimeout(heal, 10000);
    setTimeout(() => { void heal(); setSyncMsg(null); }, 25000);
  }, [load]);

  const move = useCallback(async (card: Card, to: Card['status']) => {
    const patch: Record<string, unknown> = { status: to };
    if (to === 'doing' && !card.started_at) patch.started_at = new Date().toISOString();
    if (to === 'done') patch.done_at = new Date().toISOString();
    const { error } = await supabase.from('job_cards').update(patch).eq('id', card.id);
    if (error) setErr(error.message);
    await load();
  }, [load]);

  const archive = useCallback(async (card: Card) => {
    const { error } = await supabase.from('job_cards').update({ archived_at: new Date().toISOString() }).eq('id', card.id);
    if (error) setErr(error.message);
    await load();
  }, [load]);

  // Remove a card that shouldn't be on the board (cancelled invoice, mistaken/duplicate
  // check-in, no-show). Confirm first since it's a one-tap dismissal; it only archives
  // (kept in history, reversible) and never touches Niagawan.
  const removeCard = useCallback(async (card: Card) => {
    if (!window.confirm(`Remove ${card.plate} from the board?`)) return;
    await archive(card);
  }, [archive]);

  // Attach a customer WhatsApp number to a card — for manual cards or cars with no phone on
  // file. Stored on the card and preferred over the check-in / invoice phone.
  const setCardPhone = useCallback(async (card: Card, prefill?: string | null) => {
    const p = window.prompt(`Customer WhatsApp number for ${card.plate} (e.g. 0123456789):`, prefill ?? card.customer_phone ?? '');
    if (p == null) return;
    const clean = p.replace(/[^\d+]/g, '');
    const { error } = await supabase.from('job_cards').update({ customer_phone: clean || null }).eq('id', card.id);
    if (error) { setErr(error.message); return; }
    // Also push the number into the customer's Niagawan record — but only when we can
    // resolve this card to a SINGLE Niagawan customer (exact check-in link, else a unique
    // plate match). The NAS scraper does the actual write; here we just queue it.
    if (clean) {
      try {
        const { data: cust } = await supabase.rpc('board_card_customer', { p_sale_id: card.sale_id ?? '', p_plate: card.plate });
        const cid = (cust as { customer_id: string }[] | null)?.[0]?.customer_id;
        if (cid) {
          await supabase.rpc('queue_update_phone', { p_customer_id: cid, p_phone: clean });
          setSyncMsg('Number saved — also updating it in Niagawan (a few seconds).');
        } else {
          setSyncMsg('Number saved on the board. (This car isn’t linked to a Niagawan customer, so it stays here only.)');
        }
        setTimeout(() => setSyncMsg(null), 8000);
      } catch { /* Niagawan sync is best-effort; the local number is already saved */ }
    }
    await load();
  }, [load]);

  const createCard = useCallback(async () => {
    if (!plate.trim()) { setErr('Plate number is required.'); return; }
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from('job_cards').insert({
      plate: plate.trim().toUpperCase(),
      vehicle: vehicle.trim() || null,
      problem: problem.trim() || null,
      mechanic: mechanic || null,
      parts_note: partsNote.trim() || null,
      created_by: sess.session?.user?.email ?? null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setPlate(''); setVehicle(''); setProblem(''); setMechanic(''); setPartsNote(''); setShowForm(false);
    await load();
  }, [plate, vehicle, problem, mechanic, partsNote, load]);

  const addMemo = useCallback(async () => {
    if (!newMemo.trim()) return;
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from('memos').insert({ text: newMemo.trim(), created_by: sess.session?.user?.email ?? null });
    if (error) { setErr(error.message); return; }
    setNewMemo('');
    await load();
  }, [newMemo, load]);

  const dismissMemo = useCallback(async (id: number) => {
    await supabase.from('memos').update({ active: false }).eq('id', id);
    await load();
  }, [load]);

  const byCol = useMemo(() => {
    const map: Record<'pending' | 'done', Card[]> = { pending: [], done: [] };
    const todayStr = new Date().toDateString();
    const debtInvs = new Set(debts.map((d) => d.sale_inv_no).filter(Boolean) as string[]);
    const debtToks = debts.map((d) => (d.ptoken || '').toUpperCase()).filter(Boolean);
    const norm = (s: string | null) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const c of cards) {
      if (c.status === 'done') {
        // Done shows only TODAY's completed cars (older ones stay in the data but don't clutter the board).
        const when = c.done_at ?? c.created_at;
        if (when && new Date(when).toDateString() !== todayStr) continue;
        map.done.push(c);
      } else {
        // Everything not done is a Pending Job. An aged unpaid/partial bill (>7 days) belongs in
        // the Debts section instead, so it doesn't clutter the board.
        const np = norm(c.plate), nv = norm(c.vehicle);
        const isDebt = (c.sale_inv != null && debtInvs.has(c.sale_inv)) || debtToks.some((t) => (np && np.includes(t)) || (nv && nv.includes(t)));
        if (isDebt) continue;
        map.pending.push(c);
      }
    }
    return map;
  }, [cards, debts]);

  // Debts grouped by year (default to the newest year so the board isn't flooded by old data).
  const debtView = useMemo(() => {
    const years = Array.from(new Set(debts.map((d) => (d.sale_date || '').slice(0, 4)).filter(Boolean))).sort().reverse();
    const active = debtYear || years[0] || '';
    const shown = active && active !== 'all' ? debts.filter((d) => (d.sale_date || '').startsWith(active)) : debts;
    const total = shown.reduce((s, d) => s + Number(d.balance ?? d.total ?? 0), 0);
    return { years, active, shown, total };
  }, [debts, debtYear]);

  if (authed === null || (authed && canWrite === null)) return <div className="p-6 text-sm text-gray-500">Checking session…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in to see the workshop board.</div>;
  if (!canWrite) return <div className="p-6 text-sm text-gray-600">The workshop board is for supervisors only.</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Workshop</h1>
        <span className="text-sm text-gray-400">{byCol.pending.length} car(s) in the shop</span>
        <span className="ml-auto flex gap-2">
          <button onClick={refreshAll} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">🔄 Refresh</button>
          <a href="/add-part" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-100">🔩 Part arrived</a>
          {canWrite && (
            <>
              <a href="/intake" className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100">📝 Customer check-in</a>
              <a href="/cash-count" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">💵 Cash Book</a>
              <button onClick={() => setShowForm((v) => !v)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
                {showForm ? 'Close' : '+ New job card'}
              </button>
            </>
          )}
        </span>
      </div>

      {syncMsg && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{syncMsg}</div>
      )}

      {/* Memos */}
      {(memos.length > 0 || canWrite) && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          {memos.map((m) => (
            <div key={m.id} className="flex items-start gap-2 py-0.5 text-sm text-yellow-900">
              <span className="select-none">📌</span>
              <span className="min-w-0 flex-1">{m.text}</span>
              {canWrite && <button onClick={() => dismissMemo(m.id)} className="text-xs text-yellow-600 underline">remove</button>}
            </div>
          ))}
          {canWrite && (
            <div className="mt-2 flex gap-2">
              <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMemo()}
                placeholder="Write a memo for everyone…" className="min-w-0 flex-1 rounded-md border border-yellow-300 bg-white px-2 py-1 text-sm" />
              <button onClick={addMemo} className="rounded-md border border-yellow-300 bg-white px-3 py-1 text-sm text-yellow-800 hover:bg-yellow-100">Post</button>
            </div>
          )}
        </div>
      )}

      {/* New card form — designed to take under 30 seconds */}
      {showForm && canWrite && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Plate * (e.g. JNP7801)" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono uppercase" />
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Car (e.g. Persona)" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            <input value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Problem / job" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            <select value={mechanic} onChange={(e) => setMechanic(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">— mechanic —</option>
              {staffNames.map((s) => <option key={s.staff_name} value={s.staff_name}>{s.staff_name}{s.staff_position !== 'Mechanic' ? ` (${s.staff_position})` : ''}</option>)}
            </select>
            <input value={partsNote} onChange={(e) => setPartsNote(e.target.value)} placeholder="Parts to order (optional)" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button onClick={createCard} disabled={saving} className="mt-2 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add to board'}
          </button>
        </div>
      )}

      {err && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{err}</div>}

      {/* The board */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {COLS.map((col) => (
          <div key={col.key} className={`rounded-lg border border-gray-200 ${col.tint} p-2`}>
            <div className={`mb-2 flex items-center justify-between px-1 text-sm font-semibold ${col.head}`}>
              <span>{col.label}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs">{byCol[col.key].length}</span>
            </div>
            <div className="space-y-2">
              {byCol[col.key].length === 0 && <div className="px-1 pb-1 text-xs text-gray-400">—</div>}
              {byCol[col.key].map((c) => (
                <div key={c.id} className="rounded-md border border-gray-200 bg-white p-2 shadow-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-gray-900">{c.plate}</span>
                    <span className="text-[11px] text-gray-400" title={`created ${new Date(c.created_at).toLocaleString('en-MY')}`}>
                      {c.status === 'done' ? `done ${ago(c.done_at)}` : ago(c.created_at)}
                    </span>
                  </div>
                  {c.vehicle && <div className="text-xs text-gray-600">{c.vehicle}</div>}
                  {c.problem && <div className="mt-0.5 text-sm text-gray-800">{c.problem}</div>}
                  {c.parts_note && <div className="mt-0.5 text-xs text-amber-700">🔩 {c.parts_note}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.mechanic && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{c.mechanic}</span>}
                    <span className="ml-auto flex gap-1">
                      {c.status !== 'done' && <button onClick={() => move(c, 'done')} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700">Done</button>}
                      {(() => {
                        // Phone priority: manual override on the card -> check-in / invoice phone.
                        const phone = c.customer_phone || (c.sale_id ? contacts[c.sale_id]?.phone : null);
                        const num = waNumber(phone);
                        if (num) {
                          const name = c.customer || (c.sale_id ? contacts[c.sale_id]?.cust_name : null) || 'there';
                          const veh = [c.vehicle, c.plate].filter(Boolean).join(' ');
                          const text = encodeURIComponent(waCardText(c.status === 'done' ? 'done' : 'waiting', name, veh));
                          return (
                            <>
                              <a href={`https://wa.me/${num}?text=${text}`} target="_blank" rel="noopener noreferrer" className="rounded bg-green-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-green-700" title="Message the customer on WhatsApp">📲 WhatsApp</a>
                              {canWrite && <button onClick={() => setCardPhone(c, phone)} className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-50" title="Edit this customer's number (also updates Niagawan)">✏️</button>}
                            </>
                          );
                        }
                        // No phone anywhere — let a supervisor add one so the WhatsApp button appears.
                        return canWrite ? (
                          <button onClick={() => setCardPhone(c)} className="rounded border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100" title="Add the customer's WhatsApp number">➕ phone</button>
                        ) : null;
                      })()}
                      {c.status === 'done' && canWrite && <button onClick={() => archive(c)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50" title="Remove from the board (kept in history)">Clear</button>}
                      {c.status !== 'done' && canWrite && <button onClick={() => removeCard(c)} className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-rose-50 hover:text-rose-600" title="Remove from the board — for a cancelled / mistaken check-in (kept in history)">✕</button>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Debts — unpaid / partial bills older than 7 days (a plate, not trade). Read-only; clears when paid in Niagawan. */}
      {debts.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-rose-700">
            <span>💸 Debts</span>
            <select value={debtView.active} onChange={(e) => setDebtYear(e.target.value)} className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700">
              {debtView.years.map((y) => <option key={y} value={y}>{y}</option>)}
              <option value="all">All years</option>
            </select>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs">{debtView.shown.length}</span>
            <span className="text-xs font-normal text-gray-400">owed {rm(debtView.total)} · unpaid / partial &gt; 7 days old</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {debtView.shown.map((d) => (
              <div key={d.sale_id} className="rounded-md border border-rose-200 bg-rose-50/60 p-2 shadow-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-gray-900">{d.ptoken || d.vehicle_label}</span>
                  <span className="text-[11px] font-semibold text-rose-600">{d.age_days}d old</span>
                </div>
                {d.vehicle_label && <div className="truncate text-xs text-gray-600">{d.vehicle_label}</div>}
                <div className="mt-1 flex items-baseline justify-between text-xs">
                  <span className="text-gray-500">{d.status === 'partial' ? 'Partial' : 'Unpaid'} · {d.sale_inv_no}</span>
                  <span className="font-semibold text-rose-700">owes {rm(d.balance ?? d.total)}</span>
                </div>
                <div className="text-[11px] text-gray-400">bill {rm(d.total)}{d.status === 'partial' && d.paid != null ? ` · paid ${rm(d.paid)}` : ''} · {d.sale_date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        Supervisors add job cards and memos. Anyone can mark a car Done when it&apos;s ready. The board refreshes itself every 15 seconds on every PC.
      </p>
    </div>
  );
}
