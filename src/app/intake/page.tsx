// src/app/intake/page.tsx — customer check-in.
// The supervisor opens this on his phone and hands it to the customer. They tap the jobs the
// customer wants (each becomes an invoice line), and the NAS creates the sale invoice in
// Niagawan within ~30 seconds. Supervisors/admins only (the page runs under the supervisor's login).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import BackLink from '@/components/BackLink';

type Phase = 'form' | 'saving' | 'done' | 'error';
type Item = { key: string; name: string; detail: string; diag: boolean; custom: boolean };
type Cand = { last_day: string | null; customer: string; cust_id: string | null; phone: string | null };

// The common workshop jobs, shown as one-tap chips. Editable — add/remove to taste.
const COMMON_JOBS = ['Engine oil', 'Gearbox oil', 'Brake pad', 'Radiator / cooling', 'Aircond', 'Battery', 'Tyre', 'Alignment', 'General service'];
// Diagnostic jobs — flagged "(diagnose)" so the mechanic checks before quoting.
const TROUBLESHOOT = ['Wiring', 'Engine', 'Gearbox', 'Aircond not cold'];

function detailPlaceholder(name: string): string {
  if (name === 'Engine oil') return 'which oil? e.g. 5W-40 fully synthetic';
  if (name === 'Brake pad') return 'front / rear?';
  if (name === 'Tyre') return 'which tyre / size?';
  return 'add detail (optional)';
}

export default function IntakePage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>('form');
  const [invNo, setInvNo] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Cand | null>(null);
  const [candidates, setCandidates] = useState<Cand[] | null>(null); // >1 customer matches this plate (different phones) — ask the clerk which
  const [dupCheckin, setDupCheckin] = useState<{ inv_no: string | null; created_at: string } | null>(null); // already checked in today
  const onFile = !!history?.cust_id; // already a registered Niagawan customer
  const [showDetails, setShowDetails] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const plateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPhone = useRef<string>(''); // last phone we auto-filled from plate recognition — lets us replace it when the plate resolves to a different customer, without clobbering a hand-typed number
  const plateSeq = useRef(0); // monotonic id per plate lookup — a stale (out-of-order) response must not overwrite a newer one
  const idRef = useRef(0); // stable keys for item rows

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setAllowed(false); return; }
      const { data: w } = await supabase.rpc('can_access', { p_feature: 'intake' });
      setAllowed(w === true);
    })();
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (plateTimer.current) clearTimeout(plateTimer.current); }, []);

  // Drop a stale auto-filled number (keep a hand-typed one) — used when the plate no longer resolves
  // to a single customer.
  const clearAutoPhone = useCallback(() => {
    const filled = autoPhone.current;
    setPhone((cur) => (cur !== '' && cur === filled ? '' : cur));
    autoPhone.current = '';
  }, []);

  // Recognise a single matched customer: fill history + phone (never clobber a hand-typed number).
  const recognise = useCallback((h: Cand) => {
    setHistory(h);
    setCandidates(null);
    setPhone((cur) => {
      if (cur === '' || cur === autoPhone.current) { autoPhone.current = h.phone ?? ''; return h.phone ?? ''; }
      return cur;
    });
  }, []);

  // Returning car? The lookup collapses duplicate records by phone: 1 row -> recognise & pre-fill;
  // several rows (same plate, different phones) -> show a picker so the clerk chooses (never auto-fill a
  // guess); 0 rows -> treat as new.
  const checkPlate = useCallback(async (p: string) => {
    if (p.replace(/\s/g, '').length < 4) { setHistory(null); setCandidates(null); setDupCheckin(null); return; }
    const seq = ++plateSeq.current; // this lookup's id
    const [{ data }, { data: dup }] = await Promise.all([
      supabase.rpc('intake_plate_lookup', { p }),
      supabase.rpc('intake_today_checkin', { p }), // already checked in today? -> warn before a 2nd invoice
    ]);
    if (seq !== plateSeq.current) return; // a newer plate lookup started while we awaited — ignore this stale result
    const rows = (Array.isArray(data) ? data : []) as Cand[];
    if (rows.length === 1) {
      recognise(rows[0]);
    } else if (rows.length > 1) {
      // Ambiguous — more than one customer on this plate. Surface them; don't auto-fill a wrong number.
      setCandidates(rows);
      setHistory(null);
      clearAutoPhone();
    } else {
      setHistory(null);
      setCandidates(null);
      clearAutoPhone();
    }
    const drow = Array.isArray(dup) && dup.length ? (dup[0] as { inv_no: string | null; created_at: string }) : null;
    setDupCheckin(drow ? { inv_no: drow.inv_no, created_at: drow.created_at } : null);
  }, [recognise, clearAutoPhone]);

  // Live recognition as the plate is typed (debounced, like the Part Arrived search).
  const onPlateChange = useCallback((raw: string) => {
    const v = raw.toUpperCase();
    setPlate(v);
    if (plateTimer.current) clearTimeout(plateTimer.current);
    plateTimer.current = setTimeout(() => checkPlate(v), 300);
  }, [checkPlate]);

  // --- Items the customer wants (each becomes its own invoice line) ---
  const chipOn = (name: string) => items.some((i) => !i.custom && i.name === name);
  const toggleChip = (name: string, diag: boolean) => {
    setItems((prev) => prev.some((i) => !i.custom && i.name === name)
      ? prev.filter((i) => !(!i.custom && i.name === name))
      : [...prev, { key: 'c' + (idRef.current++), name, detail: '', diag, custom: false }]);
  };
  const addItem = () => setItems((prev) => [...prev, { key: 'x' + (idRef.current++), name: '', detail: '', diag: false, custom: true }]);
  const setItemField = (key: string, field: 'name' | 'detail', value: string) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const save = useCallback(async (force = false) => {
    if (!plate.trim()) { setErrMsg('Please enter the plate number.'); return; }
    // Each item -> one invoice line. Sent newline-separated; the NAS creates a RM0.50 line per entry
    // so the invoice is never an empty RM0 "paid" ghost. "Job" or "Job: detail"; diagnostics tagged.
    const note = items.map((it) => {
      const nm = it.name.trim();
      if (!nm) return '';
      const label = it.diag ? `${nm} (diagnose)` : nm;
      const d = it.detail.trim();
      return d ? `${label}: ${d}` : label;
    }).filter(Boolean).join('\n');
    if (!note) { window.alert('Add at least one item — tap a job above, or use “Add item”.'); return; }
    setErrMsg(null);
    setPhase('saving');
    const { data: id, error } = await supabase.rpc('queue_intake', {
      p_plate: plate, p_model: model, p_phone: phone, p_name: '', p_note: note, p_force: force,
    });
    if (error || !id) {
      const msg = error?.message ?? 'failed';
      // Same staff already checked this car in today — confirm before a 2nd invoice.
      if (msg.includes('DUPLICATE_CHECKIN')) {
        const [inv, at] = (msg.split('DUPLICATE_CHECKIN|')[1] ?? '').split('|');
        setPhase('form');
        if (window.confirm(`⚠️ You already checked in ${plate} today (invoice ${inv || 'in progress'}${at ? `, at ${at}` : ''}).\n\nCheck in again and create a SECOND invoice?`)) {
          return save(true);
        }
        return;
      }
      setPhase('error'); setErrMsg(msg); return;
    }
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      const { data: row } = await supabase.from('intake_requests').select('status,inv_no,note').eq('id', id).single();
      if (row?.status === 'done') {
        if (pollRef.current) clearInterval(pollRef.current);
        setInvNo(row.inv_no ?? null);
        setPhase('done');
      } else if (row?.status === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        setErrMsg(row.note ?? 'Niagawan error');
        setPhase('error');
      } else if (Date.now() - startedAt > 90000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setErrMsg('Taking long — the invoice may still appear in Niagawan shortly.');
        setPhase('error');
      }
    }, 3000);
  }, [plate, model, phone, items]);

  const reset = () => { setPlate(''); setModel(''); setPhone(''); setItems([]); setInvNo(null); setErrMsg(null); setHistory(null); setCandidates(null); setDupCheckin(null); setShowDetails(false); setPhase('form'); autoPhone.current = ''; };

  if (allowed === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for supervisors — please sign in with a supervisor account.</div>;

  if (phase === 'done') {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl">✅</div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Thank you!</h1>
        <p className="mt-2 text-ink-2">Your car has been registered.</p>
        {invNo && <div className="mt-4 rounded-lg bg-ink/5 px-4 py-2 font-mono text-lg font-semibold text-ink-2">{invNo}</div>}
        <button onClick={reset} className="mt-8 w-full rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90">
          Next customer
        </button>
        <div className="mt-3 text-center"><BackLink label="Back to workshop" /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <BackLink />
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Car Check-in</h1>
      <p className="mt-1 text-sm text-ink-3">Tap what the customer wants — add anything extra.</p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink-2">Plate Number *</span>
          <input value={plate} onChange={(e) => onPlateChange(e.target.value)} onBlur={(e) => checkPlate(e.target.value)}
            placeholder="WWW1234" autoCapitalize="characters" autoComplete="off"
            className="mt-1 w-full rounded-lg border border-line px-4 py-1 font-mono text-xl uppercase tracking-wide" />
        </label>
        {candidates && candidates.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-warn-soft px-3 py-2.5 text-sm text-warn">
            <div className="font-medium">More than one customer is on plate <span className="font-semibold">{plate}</span> — which one?</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {candidates.map((c) => (
                <button key={(c.cust_id ?? '') + '|' + (c.phone ?? '')} type="button" onClick={() => recognise(c)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-1.5 text-left hover:bg-ink/5">
                  <span className="min-w-0 truncate font-medium text-ink">{c.customer}</span>
                  <span className="shrink-0 text-xs text-ink-3">{c.phone ?? 'no phone'}</span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-xs text-warn">Pick the one with the right phone — or just fill the details below if it&rsquo;s a new customer.</div>
          </div>
        )}
        {onFile && (
          <div className="rounded-lg border border-emerald-300 bg-good-soft px-3 py-2.5 text-sm text-good">
            👋 Welcome back, <span className="font-semibold">{history?.customer}</span>.<br />
            We already have your details — just add the job below and tap <span className="font-semibold">SAVE</span>.
            <button onClick={() => setShowDetails((v) => !v)} className="ml-1 underline">{showDetails ? 'hide' : 'update details'}</button>
          </div>
        )}
        {(!onFile || showDetails) && (
          <>
            <label className="block">
              <span className="text-sm font-medium text-ink-2">Car Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Myvi, Saga, Civic" autoComplete="off"
                className="mt-1 w-full rounded-lg border border-line px-4 py-1 text-lg" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-2">Phone Number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0123456789" inputMode="tel" autoComplete="off"
                className="mt-1 w-full rounded-lg border border-line px-4 py-1 text-lg" />
            </label>
          </>
        )}

        {/* What the customer wants — one-tap jobs, each becomes an invoice line for the cashier to price */}
        <div>
          <span className="text-sm font-medium text-ink-2">What does the customer want? *</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {COMMON_JOBS.map((name) => (
              <button key={name} type="button" onClick={() => toggleChip(name, false)} aria-pressed={chipOn(name)}
                className={`rounded-full border px-3 py-1.5 text-sm ${chipOn(name) ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-ink/5'}`}>
                {name}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Troubleshoot / diagnose</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TROUBLESHOOT.map((name) => (
              <button key={name} type="button" onClick={() => toggleChip(name, true)} aria-pressed={chipOn(name)}
                className={`rounded-full border px-3 py-1.5 text-sm ${chipOn(name) ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-ink/5'}`}>
                {name}
              </button>
            ))}
          </div>

          {items.length > 0 && (
            <div className="mt-3 divide-y divide-line rounded-lg border border-line">
              {items.map((it) => (
                <div key={it.key} className="p-2.5">
                  <div className="flex items-center gap-2">
                    {it.custom ? (
                      <input value={it.name} onChange={(e) => setItemField(it.key, 'name', e.target.value)}
                        placeholder="item name — e.g. Wiper blade" autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-sm font-medium" />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{it.name}</span>
                    )}
                    {it.diag && <span className="rounded border border-line px-1.5 py-0.5 text-xs font-semibold text-ink-3">diagnose</span>}
                    <button type="button" onClick={() => removeItem(it.key)} aria-label={`Remove ${it.name || 'item'}`}
                      className="shrink-0 rounded px-1 text-lg leading-none text-ink-3 hover:text-bad">×</button>
                  </div>
                  <input value={it.detail} onChange={(e) => setItemField(it.key, 'detail', e.target.value)}
                    placeholder={detailPlaceholder(it.name)} autoComplete="off"
                    className="mt-1.5 w-full rounded-lg border border-line px-2 py-1 text-sm" />
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={addItem}
            className="mt-2.5 w-full rounded-lg border border-dashed border-line py-2.5 text-sm font-semibold text-accent hover:bg-ink/5">
            + Add item
          </button>
          <p className="mt-1.5 text-xs text-ink-3">Each item becomes its own invoice line for the cashier to price.</p>
        </div>

        {dupCheckin && (
          <div className="rounded-lg border border-amber-300 bg-warn-soft px-3 py-2.5 text-sm text-warn">
            ⚠️ <span className="font-semibold">{plate}</span> was already checked in today
            {dupCheckin.created_at ? ` at ${new Date(dupCheckin.created_at).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}` : ''}
            {dupCheckin.inv_no ? <> (invoice <span className="font-mono font-semibold">{dupCheckin.inv_no}</span>)</> : ''}.
            <br />Saving again creates a <span className="font-semibold">second invoice</span> — only continue if you really need one.
          </div>
        )}

        {errMsg && <div className="rounded-lg border border-rose-200 bg-bad-soft px-3 py-2 text-sm text-bad">{errMsg}</div>}

        <button onClick={() => save()} disabled={phase === 'saving'}
          className="w-full rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {phase === 'saving' ? 'Registering…' : 'SAVE'}
        </button>
        {phase === 'saving' && <p className="text-center text-sm text-ink-3">Creating the invoice in Niagawan (~30s)…</p>}
      </div>
    </div>
  );
}
