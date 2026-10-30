'use client';
// Office → BNPL → Manage services: self-serve add / edit / enable BNPL providers (name + fee model).
// A service starts tracking automatically once its code matches the POS payment method on the sale.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, rm } from '@/components/office/shared';

type Provider = { provider: string; display_name: string; mdr_pct: number; flat_fee: number; sst_pct: number; enabled: boolean };
type Draft = { provider: string; display_name: string; mdr_pct: string; flat_fee: string; sst_pct: string; enabled: boolean };

const INP = 'w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink';
const BLANK: Draft = { provider: '', display_name: '', mdr_pct: '', flat_fee: '', sst_pct: '', enabled: true };
const toDraft = (p: Provider): Draft => ({
  provider: p.provider, display_name: p.display_name,
  mdr_pct: String(p.mdr_pct), flat_fee: String(p.flat_fee), sst_pct: String(p.sst_pct), enabled: p.enabled,
});

// What you keep on a RM100 sale, using the same model as ATOME: gross*(1 - mdr%*(1+sst%)) - flat*(1+sst%).
function netOn100(mdr: number, flat: number, sst: number) {
  const s = 1 + (sst || 0) / 100;
  return 100 * (1 - ((mdr || 0) / 100) * s) - (flat || 0) * s;
}

export default function BnplProvidersPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [list, setList] = useState<Provider[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('bnpl_providers_admin');
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setList((data ?? []) as Provider[]);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const save = useCallback(async (d: Draft, key: string) => {
    setSavingKey(key); setMsg(null);
    const { error } = await supabase.rpc('bnpl_provider_upsert', {
      p_provider: d.provider, p_display_name: d.display_name,
      p_mdr_pct: Number(d.mdr_pct) || 0, p_flat_fee: Number(d.flat_fee) || 0,
      p_sst_pct: Number(d.sst_pct) || 0, p_enabled: d.enabled,
    });
    setSavingKey(null);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setMsg({ kind: 'ok', text: `Saved ${d.display_name || d.provider}.` });
    if (key === '__new__') { setAdding(false); setDraft(BLANK); }
    await load();
  }, [load]);

  if (allowed === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;

  return (
    <OfficeShell title="BNPL services" back backHref="/office/bnpl" backLabel="← BNPL" onRefresh={load}>
      <p className="mb-4 text-sm text-ink-2">
        Add or edit the Buy-Now-Pay-Later services you accept, and their fees. A service begins tracking
        automatically once its <b>code</b> matches the payment method recorded on the sale.
      </p>

      {msg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{msg.text}</div>
      )}

      {adding ? (
        <ProviderForm
          title="New service" draft={draft} setDraft={setDraft} isNew
          saving={savingKey === '__new__'}
          onSave={() => save(draft, '__new__')}
          onCancel={() => { setAdding(false); setDraft(BLANK); }}
        />
      ) : (
        <button
          onClick={() => { setDraft(BLANK); setAdding(true); }}
          className="mb-4 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Add a BNPL service
        </button>
      )}

      {list === null ? (
        <div className="py-6 text-center text-sm text-ink-3">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">No services yet — add your first one above.</div>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <ProviderRow key={p.provider} p={p} saving={savingKey === p.provider} onSave={(d) => save(d, p.provider)} />
          ))}
        </div>
      )}
    </OfficeShell>
  );
}

function ProviderRow({ p, saving, onSave }: { p: Provider; saving: boolean; onSave: (d: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(toDraft(p));
  useEffect(() => { setDraft(toDraft(p)); }, [p]);
  return (
    <div className={`rounded-card bg-card shadow-card p-4 ${p.enabled ? '' : 'opacity-60'}`}>
      <ProviderForm title={draft.display_name || p.provider} draft={draft} setDraft={setDraft} saving={saving} onSave={() => onSave(draft)} />
    </div>
  );
}

function ProviderForm({ title, draft, setDraft, isNew, saving, onSave, onCancel }: {
  title: string; draft: Draft; setDraft: (d: Draft) => void;
  isNew?: boolean; saving: boolean; onSave: () => void; onCancel?: () => void;
}) {
  const set = (k: keyof Draft, v: string | boolean) => setDraft({ ...draft, [k]: v } as Draft);
  const net = netOn100(Number(draft.mdr_pct) || 0, Number(draft.flat_fee) || 0, Number(draft.sst_pct) || 0);
  const outer = isNew ? 'mb-4 rounded-card bg-card shadow-card p-4 border border-accent/40' : '';
  return (
    <div className={outer}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {draft.enabled ? 'Active' : 'Hidden'}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Name">
          <input value={draft.display_name} onChange={(e) => set('display_name', e.target.value)} placeholder="e.g. Grab PayLater" className={INP} />
        </Field>
        <Field label="Code (POS method)">
          <input value={draft.provider} disabled={!isNew} onChange={(e) => set('provider', e.target.value)} placeholder="e.g. grab" className={`${INP} disabled:bg-ink/[0.03]`} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="MDR %">
          <input inputMode="decimal" value={draft.mdr_pct} onChange={(e) => set('mdr_pct', e.target.value)} placeholder="0" className={INP} />
        </Field>
        <Field label="Flat fee (RM)">
          <input inputMode="decimal" value={draft.flat_fee} onChange={(e) => set('flat_fee', e.target.value)} placeholder="0" className={INP} />
        </Field>
        <Field label="SST %">
          <input inputMode="decimal" value={draft.sst_pct} onChange={(e) => set('sst_pct', e.target.value)} placeholder="0" className={INP} />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-ink-3">On a RM100 sale you keep <b className="text-ink-2">{rm(net)}</b></span>
        <div className="ml-auto flex items-center gap-2">
          {onCancel && <button onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2">Cancel</button>}
          <button onClick={onSave} disabled={saving} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : isNew ? 'Add service' : 'Save'}
          </button>
        </div>
      </div>

      {isNew && (
        <p className="mt-2 text-[11px] text-ink-3">
          Tip: the <b>code</b> must match how the sale is recorded in your POS (e.g. ATOME comes in as <code>atome</code>). It can&rsquo;t be changed later.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
