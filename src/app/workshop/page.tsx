// src/app/workshop/page.tsx — the workshop job board.
// Every signed-in staff PC shows this: cars in the shop as cards moving through
// Waiting -> In progress -> Waiting parts -> Done, plus memos for everyone.
// Supervisors/admins create cards + memos; anyone can move a card's status.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
};

type Memo = { id: number; text: string; created_at: string; active: boolean };
type StaffName = { staff_name: string; staff_position: string };

const COLS: { key: Card['status']; label: string; tint: string; head: string }[] = [
  { key: 'waiting', label: 'Waiting', tint: 'bg-gray-50', head: 'text-gray-600' },
  { key: 'doing', label: 'In progress', tint: 'bg-blue-50/60', head: 'text-blue-700' },
  { key: 'waiting_parts', label: 'Waiting parts', tint: 'bg-amber-50/70', head: 'text-amber-700' },
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

export default function WorkshopBoardPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null); // null = still checking; supervisors/admins only
  const [cards, setCards] = useState<Card[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
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
    const [{ data: c, error: ce }, { data: m }] = await Promise.all([
      supabase.from('job_cards').select('*').is('archived_at', null).order('created_at', { ascending: true }),
      supabase.from('memos').select('*').eq('active', true).order('created_at', { ascending: false }).limit(5),
    ]);
    if (ce) setErr(ce.message);
    else { setCards((c ?? []) as Card[]); setErr(null); }
    setMemos((m ?? []) as Memo[]);
  }, []);

  // Live board: refresh every 15s so every supervisor PC stays current.
  useEffect(() => {
    if (!authed || canWrite !== true) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [authed, canWrite, load]);

  // One refresh for the whole workshop system: pull latest payment status from Niagawan
  // (so paid cars move to Done, new check-ins appear) AND reload the board now. The same
  // sync also refreshes the data the Part Arrived page reads.
  const refreshAll = useCallback(async () => {
    setSyncMsg('Refreshing…');
    await supabase.rpc('request_workshop_sync'); // board-writers trigger a Niagawan sync; others just reload
    await load();
    setSyncMsg('Syncing with Niagawan… paid cars move to Done and new check-ins appear within a few seconds.');
    setTimeout(() => { load(); }, 10000);
    setTimeout(() => { load(); setSyncMsg(null); }, 25000);
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
    const map: Record<string, Card[]> = { waiting: [], doing: [], waiting_parts: [], done: [] };
    const todayStr = new Date().toDateString();
    for (const c of cards) {
      // Done shows only TODAY's completed cars (older ones stay in the data but don't clutter the board).
      if (c.status === 'done') {
        const when = c.done_at ?? c.created_at;
        if (when && new Date(when).toDateString() !== todayStr) continue;
      }
      (map[c.status] ?? map.waiting).push(c);
    }
    return map;
  }, [cards]);

  if (authed === null || (authed && canWrite === null)) return <div className="p-6 text-sm text-gray-500">Checking session…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in to see the workshop board.</div>;
  if (!canWrite) return <div className="p-6 text-sm text-gray-600">The workshop board is for supervisors only.</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Workshop</h1>
        <span className="text-sm text-gray-400">{cards.filter((c) => c.status !== 'done').length} car(s) in the shop</span>
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                      {c.status === 'done' ? `done ${ago(c.done_at)}` : c.status === 'waiting' ? `waiting ${ago(c.created_at)}` : ago(c.started_at ?? c.created_at)}
                    </span>
                  </div>
                  {c.vehicle && <div className="text-xs text-gray-600">{c.vehicle}</div>}
                  {c.problem && <div className="mt-0.5 text-sm text-gray-800">{c.problem}</div>}
                  {c.parts_note && <div className="mt-0.5 text-xs text-amber-700">🔩 {c.parts_note}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.mechanic && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{c.mechanic}</span>}
                    <span className="ml-auto flex gap-1">
                      {c.status === 'waiting' && <button onClick={() => move(c, 'doing')} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700">Start</button>}
                      {c.status === 'doing' && (
                        <>
                          <button onClick={() => move(c, 'waiting_parts')} className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Waiting parts</button>
                          <button onClick={() => move(c, 'done')} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700">Done</button>
                        </>
                      )}
                      {c.status === 'waiting_parts' && <button onClick={() => move(c, 'doing')} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700">Resume</button>}
                      {c.status === 'done' && canWrite && <button onClick={() => archive(c)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50" title="Remove from the board (kept in history)">Clear</button>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Supervisors add job cards and memos. Anyone can move a card: Start → Done (or Waiting parts when stuck). The board refreshes itself every 15 seconds on every PC.
      </p>
    </div>
  );
}
