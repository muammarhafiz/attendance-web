// src/app/intake/page.tsx — customer check-in.
// The supervisor opens this on his phone and hands it to the customer. The customer types
// their car + phone, taps save, and the NAS creates the sale invoice in Niagawan within
// ~30 seconds. Supervisors/admins only (the page runs under the supervisor's login).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Phase = 'form' | 'saving' | 'done' | 'error';

export default function IntakePage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [invNo, setInvNo] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<{ last_day: string | null; customer: string; cust_id: string | null; phone: string | null } | null>(null);
  const onFile = !!history?.cust_id; // already a registered Niagawan customer
  const [showDetails, setShowDetails] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const plateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setAllowed(false); return; }
      const { data: w } = await supabase.rpc('can_access', { p_feature: 'intake' });
      setAllowed(w === true);
    })();
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (plateTimer.current) clearTimeout(plateTimer.current); }, []);

  // Returning car? Recognise the plate and pre-fill what we already have on file.
  const checkPlate = useCallback(async (p: string) => {
    if (p.replace(/\s/g, '').length < 4) { setHistory(null); return; }
    const { data } = await supabase.rpc('intake_plate_lookup', { p });
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (row) {
      const h = row as { last_day: string | null; customer: string; cust_id: string | null; phone: string | null };
      setHistory(h);
      if (h.phone) setPhone((cur) => cur || h.phone || ''); // pre-fill phone if we know it
    } else {
      setHistory(null);
    }
  }, []);

  // Live recognition as the plate is typed (debounced, like the Part Arrived search).
  const onPlateChange = useCallback((raw: string) => {
    const v = raw.toUpperCase();
    setPlate(v);
    if (plateTimer.current) clearTimeout(plateTimer.current);
    plateTimer.current = setTimeout(() => checkPlate(v), 300);
  }, [checkPlate]);

  const save = useCallback(async () => {
    if (!plate.trim()) { setErrMsg('Please enter the plate number.'); return; }
    setErrMsg(null);
    setPhase('saving');
    const { data: id, error } = await supabase.rpc('queue_intake', {
      p_plate: plate, p_model: model, p_phone: phone, p_name: '', p_note: note,
    });
    if (error || !id) { setPhase('error'); setErrMsg(error?.message ?? 'failed'); return; }
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
  }, [plate, model, phone, note]);

  const reset = () => { setPlate(''); setModel(''); setPhone(''); setNote(''); setInvNo(null); setErrMsg(null); setHistory(null); setShowDetails(false); setPhase('form'); };

  if (allowed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for supervisors — please sign in with a supervisor account.</div>;

  if (phase === 'done') {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl">✅</div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Thank you!</h1>
        <p className="mt-2 text-gray-600">Your car has been registered.</p>
        {invNo && <div className="mt-4 rounded-lg bg-gray-100 px-4 py-2 font-mono text-lg font-semibold text-gray-800">{invNo}</div>}
        <button onClick={reset} className="mt-8 w-full rounded-xl bg-blue-600 px-6 py-4 text-lg font-semibold text-white hover:bg-blue-700">
          Next customer
        </button>
        <a href="/workshop" className="mt-3 text-sm text-gray-400 underline">← Back to workshop</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <a href="/workshop" className="text-sm text-gray-400 hover:text-gray-600">← Back</a>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Car Check-in</h1>
      <p className="mt-1 text-sm text-gray-500">Please fill in your car details</p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Plate Number *</span>
          <input value={plate} onChange={(e) => onPlateChange(e.target.value)} onBlur={(e) => checkPlate(e.target.value)}
            placeholder="WWW1234" autoCapitalize="characters" autoComplete="off"
            className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 font-mono text-xl uppercase tracking-wide" />
        </label>
        {onFile && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            👋 Welcome back, <span className="font-semibold">{history?.customer}</span>.<br />
            We already have your details — just tap <span className="font-semibold">SAVE</span>.
            <button onClick={() => setShowDetails((v) => !v)} className="ml-1 underline">{showDetails ? 'hide' : 'update details'}</button>
          </div>
        )}
        {(!onFile || showDetails) && (
          <>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Car Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Myvi, Saga, Civic" autoComplete="off"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 text-lg" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Phone Number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0123456789" inputMode="tel" autoComplete="off"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 text-lg" />
            </label>
          </>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Notes / remark (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoComplete="off"
            placeholder="e.g. customer complaint, things to check…"
            className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base" />
          <span className="mt-1 block text-xs text-gray-400">If filled, it&rsquo;s added to the invoice as a line for the cashier to price.</span>
        </label>

        {errMsg && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg}</div>}

        <button onClick={save} disabled={phase === 'saving'}
          className="w-full rounded-xl bg-blue-600 px-6 py-4 text-xl font-bold text-white hover:bg-blue-700 disabled:opacity-60">
          {phase === 'saving' ? 'Registering…' : 'SAVE'}
        </button>
        {phase === 'saving' && <p className="text-center text-sm text-gray-400">Creating the invoice in Niagawan (~30s)…</p>}
      </div>
    </div>
  );
}
