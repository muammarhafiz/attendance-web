// src/app/add-part/page.tsx — "part arrived".
// A mechanic keys the item code (from the supplier's barcode sticker) and picks which car;
// the NAS puts the item onto that car's sale invoice in Niagawan. Open to every signed-in
// staff member (owner's decision 2026-06-12).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type OpenInv = { inv: string; sale_id: string; customer: string | null };
type Phase = 'form' | 'saving' | 'done' | 'error';

export default function AddPartPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [cars, setCars] = useState<OpenInv[]>([]);
  const [picked, setPicked] = useState<OpenInv | null>(null);
  const [code, setCode] = useState('');
  const [qty, setQty] = useState(1);
  const [filter, setFilter] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [result, setResult] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
    })();
  }, []);

  const loadCars = useCallback(async () => {
    const { data } = await supabase.rpc('open_invoices_today');
    setCars((data ?? []) as OpenInv[]);
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadCars();
    const t = setInterval(loadCars, 30000);
    return () => clearInterval(t);
  }, [authed, loadCars]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const save = useCallback(async () => {
    if (!picked) { setErrMsg('Sila pilih kereta / Pick the car first.'); return; }
    if (!code.trim()) { setErrMsg('Sila isi kod item / Enter the item code.'); return; }
    setErrMsg(null);
    setPhase('saving');
    const { data: id, error } = await supabase.rpc('queue_add_item', {
      p_inv: picked.inv, p_sale_id: picked.sale_id, p_plate: picked.customer ?? '', p_code: code, p_qty: qty,
    });
    if (error || !id) { setPhase('error'); setErrMsg(error?.message ?? 'failed'); return; }
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      const { data: row } = await supabase.from('additem_requests').select('status,result').eq('id', id).single();
      if (row?.status === 'done') {
        if (pollRef.current) clearInterval(pollRef.current);
        setResult(row.result ?? 'Added.');
        setPhase('done');
      } else if (row?.status === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        setErrMsg(row.result ?? 'Niagawan error');
        setPhase('error');
      } else if (Date.now() - startedAt > 90000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setErrMsg('Taking long — check the invoice in Niagawan shortly.');
        setPhase('error');
      }
    }, 3000);
  }, [picked, code, qty]);

  const nextPart = () => { setCode(''); setQty(1); setResult(null); setErrMsg(null); setPhase('form'); };

  if (authed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in first.</div>;

  if (phase === 'done') {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl">✅</div>
        <h1 className="mt-4 text-xl font-bold text-gray-900">Item masuk invois!</h1>
        <p className="mt-3 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700">{result}</p>
        <button onClick={nextPart} className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-4 text-lg font-semibold text-white hover:bg-blue-700">
          Item seterusnya (kereta sama)
        </button>
        <button onClick={() => { nextPart(); setPicked(null); }} className="mt-2 w-full rounded-xl border border-gray-300 px-6 py-3 text-base text-gray-700 hover:bg-gray-50">
          Kereta lain / Different car
        </button>
      </div>
    );
  }

  const shown = cars.filter((c) => !filter.trim() || String(c.customer ?? c.inv).toUpperCase().includes(filter.trim().toUpperCase()));

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold text-gray-900">🔩 Part Sampai</h1>
      <p className="mt-1 text-sm text-gray-500">Pilih kereta, masukkan kod item — sistem masukkan ke invois.</p>

      {/* 1) pick the car */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">1. Kereta ({cars.length} dalam workshop)</span>
          {cars.length > 6 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="cari plat…" className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          )}
        </div>
        <div className="mt-2 grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto">
          {shown.length === 0 && <div className="text-sm text-gray-400">Tiada invois unpaid hari ini.</div>}
          {shown.map((c) => (
            <button key={c.inv} onClick={() => setPicked(c)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${picked?.inv === c.inv ? 'border-blue-600 bg-blue-50 font-semibold text-blue-900' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'}`}>
              <span className="block truncate">{c.customer || '(no name)'}</span>
              <span className="font-mono text-xs text-gray-400">{c.inv}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2) item code + qty */}
      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">2. Kod item (atas sticker / kotak)</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="cth: MRDB1999" autoCapitalize="characters" autoComplete="off"
            className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 font-mono text-xl uppercase" />
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Kuantiti:</span>
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">−</button>
          <span className="w-10 text-center text-xl font-bold">{qty}</span>
          <button onClick={() => setQty((q) => q + 1)} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">+</button>
        </div>
      </div>

      {errMsg && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg}</div>}

      <button onClick={save} disabled={phase === 'saving'}
        className="mt-5 w-full rounded-xl bg-blue-600 px-6 py-4 text-xl font-bold text-white hover:bg-blue-700 disabled:opacity-60">
        {phase === 'saving' ? 'Memasukkan… (~30s)' : 'MASUKKAN KE INVOIS'}
      </button>
    </div>
  );
}
