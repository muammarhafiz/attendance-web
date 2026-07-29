// src/components/settings/WorkshopSettings.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const DEF_RECEIVED = "Hi {name}, we've received your {car} at ZORDAQ Auto Services. We'll keep you updated.";
const DEF_READY = "Hi {name}, your {car} is ready for collection at ZORDAQ Auto Services. Thank you!";

export default function WorkshopSettings() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [received, setReceived] = useState('');
  const [ready, setReady] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('workshop_settings').select('wa_received,wa_ready').eq('id', 1).single();
    setReceived(data?.wa_received ?? DEF_RECEIVED);
    setReady(data?.wa_ready ?? DEF_READY);
    setLoaded(true);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const { error } = await supabase.from('workshop_settings')
      .update({ wa_received: received, wa_ready: ready, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaving(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Saved ✓' });
    setTimeout(() => setMsg(null), 3000);
  };

  const preview = (t: string) => t.replace(/\{name\}/g, 'Ahmad').replace(/\{car\}/g, 'Persona JNP7801');

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-3">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">This page is for admins only.</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-4 rounded-card bg-card shadow-card p-4">
        <div className="text-sm font-medium text-ink-2">Customer WhatsApp messages</div>
        <p className="mt-1 text-xs text-ink-3">
          The wording pre-filled when you tap 📲 WhatsApp on a car. Use <b>{'{name}'}</b> for the customer and{' '}
          <b>{'{car}'}</b> for the vehicle — they’re filled in automatically.
        </p>
      </div>

      {!loaded ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="text-sm font-semibold text-ink-2">While the car is still in the shop</label>
            <p className="mb-1 text-xs text-ink-3">Sent for any car not yet marked Done.</p>
            <textarea value={received} onChange={(e) => setReceived(e.target.value)} rows={3}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-ink-3">Preview: {preview(received)}</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-ink-2">When the car is ready (Done)</label>
            <p className="mb-1 text-xs text-ink-3">Sent once you mark the car Done.</p>
            <textarea value={ready} onChange={(e) => setReady(e.target.value)} rows={3}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-ink-3">Preview: {preview(ready)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={saving}
              className="rounded-md bg-btn px-3 py-2 text-sm font-medium text-btn-ink hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setReceived(DEF_RECEIVED); setReady(DEF_READY); }}
              className="rounded-md border border-line px-3 py-2 text-sm text-ink-2 hover:bg-ink/5">Reset to default</button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
