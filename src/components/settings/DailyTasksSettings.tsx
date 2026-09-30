'use client';
// Settings → Daily tasks: owner defines the recurring tasks that appear on Office → Daily.
// The clerk ticks them off each day (who + when is recorded); tasks marked "needs a file"
// require a PDF/photo upload to complete. Admin-only (RLS on daily_tasks + this tab's gate).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Task = {
  id: number; title: string; instruction: string | null; link_href: string | null;
  responsible: string | null; requires_upload: boolean; active: boolean; sort_order: number;
};

const BLANK = { title: '', instruction: '', link_href: '', responsible: '', requires_upload: false };

export default function DailyTasksSettings() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nt, setNt] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('daily_tasks').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true });
    if (error) { setErr(error.message); return; }
    setErr(null); setTasks((data ?? []) as Task[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!nt.title.trim()) return;
    setBusy(true); setErr(null);
    const max = (tasks ?? []).reduce((m, t) => Math.max(m, t.sort_order), 0);
    const { error } = await supabase.from('daily_tasks').insert({
      title: nt.title.trim(),
      instruction: nt.instruction.trim() || null,
      link_href: nt.link_href.trim() || null,
      responsible: nt.responsible.trim() || null,
      requires_upload: nt.requires_upload,
      sort_order: max + 1,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNt({ ...BLANK });
    await load();
  };

  const patch = async (id: number, p: Partial<Task>) => {
    const { error } = await supabase.from('daily_tasks').update(p).eq('id', id);
    if (error) { setErr(error.message); return; }
    await load();
  };

  const del = async (id: number) => {
    if (!window.confirm('Delete this task? Its completion history (who did it, when) is removed too.')) return;
    const { error } = await supabase.from('daily_tasks').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    await load();
  };

  const move = async (t: Task, dir: -1 | 1) => {
    const list = (tasks ?? []);
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const other = list[j];
    await patch(t.id, { sort_order: other.sort_order });
    await patch(other.id, { sort_order: t.sort_order });
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-sm font-semibold text-ink-2">Daily tasks</h2>
      <p className="mt-1 mb-3 text-xs text-ink-3">Recurring jobs that show up on Office → Daily for the clerk to tick off each day. Turning one off hides it from tomorrow; past completions are kept.</p>
      {err && <div className="mb-3 rounded-md border border-rose-200 bg-bad-soft p-2 text-sm text-bad">{err}</div>}

      {/* Add a task */}
      <div className="mb-4 rounded-card bg-card shadow-card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Add a task</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={nt.title} onChange={(e) => setNt((s) => ({ ...s, title: e.target.value }))} placeholder="Title (e.g. Upload supplier invoices)" className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm" />
          <input value={nt.responsible} onChange={(e) => setNt((s) => ({ ...s, responsible: e.target.value }))} placeholder="Who (e.g. Clerk) — optional" className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm" />
          <input value={nt.instruction} onChange={(e) => setNt((s) => ({ ...s, instruction: e.target.value }))} placeholder="Instruction — optional" className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm sm:col-span-2" />
          <input value={nt.link_href} onChange={(e) => setNt((s) => ({ ...s, link_href: e.target.value }))} placeholder="Link (e.g. /niagawan/purchase) — optional" className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm sm:col-span-2" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={nt.requires_upload} onChange={(e) => setNt((s) => ({ ...s, requires_upload: e.target.checked }))} className="h-4 w-4" />
            Needs a file upload to complete
          </label>
          <button onClick={add} disabled={busy || !nt.title.trim()} className="rounded-lg bg-btn px-3 py-1.5 text-sm font-semibold text-btn-ink hover:opacity-90 disabled:opacity-40">Add task</button>
        </div>
      </div>

      {/* Existing tasks */}
      <div className="space-y-2">
        {tasks === null ? <div className="text-xs text-ink-3">Loading…</div>
          : tasks.length === 0 ? <div className="text-xs text-ink-3">No tasks yet — add one above.</div>
          : tasks.map((t, i) => (
          <div key={t.id} className={`rounded-card bg-card shadow-card p-3 ${t.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input value={t.title} onChange={(e) => patch(t.id, { title: e.target.value })}
                  className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink hover:border-line focus:border-line" />
                <input value={t.instruction ?? ''} onChange={(e) => patch(t.id, { instruction: e.target.value || null })} placeholder="Instruction — optional"
                  className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-3 hover:border-line focus:border-line" />
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={t.requires_upload} onChange={(e) => patch(t.id, { requires_upload: e.target.checked })} className="h-3.5 w-3.5" /> needs file
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={t.active} onChange={(e) => patch(t.id, { active: e.target.checked })} className="h-3.5 w-3.5" /> active
                  </label>
                  {t.link_href && <span className="font-mono text-ink-3">{t.link_href}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => move(t, -1)} disabled={i === 0} className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-30" aria-label="Move up">↑</button>
                <button onClick={() => move(t, 1)} disabled={i === (tasks.length - 1)} className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-30" aria-label="Move down">↓</button>
                <button onClick={() => del(t.id)} className="rounded border border-line px-1.5 py-0.5 text-xs text-bad hover:bg-bad-soft" aria-label="Delete">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
