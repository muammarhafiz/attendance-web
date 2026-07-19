// src/components/settings/EmailSettings.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Prefs = { req_offday: boolean; req_halfday: boolean; req_advance: boolean; req_mc: boolean };
const TYPES: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: 'req_offday', label: 'Off-day requests', desc: 'Email me when a staff member requests an off day.' },
  { key: 'req_halfday', label: 'Half-day requests', desc: 'Email me when a staff member requests a half day.' },
  { key: 'req_advance', label: 'Salary advance requests', desc: 'Email me when a staff member requests a salary advance.' },
  { key: 'req_mc', label: 'MC submissions', desc: 'Email me when a staff member submits an MC.' },
];

export default function EmailSettings() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notification_prefs')
      .select('req_offday,req_halfday,req_advance,req_mc').eq('id', 1).single();
    if (data) setPrefs(data as Prefs);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const toggle = async (key: keyof Prefs) => {
    if (!prefs) return;
    const prev = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const { error } = await supabase.from('notification_prefs')
      .update({ [key]: next[key], updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { setPrefs(prev); return; }
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
  };

  const sendTest = async () => {
    setTesting(true); setTestMsg(null);
    const { error } = await supabase.rpc('send_test_email');
    setTesting(false);
    setTestMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Test email sent — check the owner inbox in a moment.' });
    setTimeout(() => setTestMsg(null), 6000);
  };

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-800">How email works</div>
        <p className="mt-1 text-xs text-gray-500">
          All emails are sent from <b>zordaqputrajaya@gmail.com</b>. Alerts go to the owner’s inbox; payslips go to each
          staff member. Scraper failure alerts are always on, so you never miss a real problem.
        </p>
      </div>

      <h2 className="text-sm font-semibold text-gray-700">Email me when… (staff requests)</h2>
      <p className="mt-1 mb-3 text-xs text-gray-500">
        Turn off any you don’t want an email for. You’ll still see them in the app’s notification bell.
      </p>

      <div className="space-y-3">
        {TYPES.map((t) => {
          const on = !!prefs?.[t.key];
          return (
            <div key={t.key} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{t.label}</h3>
                  {savedKey === t.key && <span className="text-[10px] font-medium text-emerald-600">saved ✓</span>}
                </div>
                <p className="mt-1 text-xs text-gray-500">{t.desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={on}
                disabled={!prefs}
                onClick={() => toggle(t.key)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-emerald-500' : 'bg-gray-300'} disabled:opacity-50`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={sendTest}
          disabled={testing}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {testing ? 'Sending…' : 'Send test email'}
        </button>
        <span className="text-xs text-gray-500">Fires a test to the owner inbox to confirm email is working.</span>
      </div>
      {testMsg && <div className={`mt-2 text-sm ${testMsg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{testMsg.text}</div>}
    </div>
  );
}
