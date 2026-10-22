'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Msg = { role: 'user' | 'assistant'; content: string };

// Starter prompts shown on the empty screen — tap to send.
const EXAMPLES = [
  'Got X70 front brake pad? How much?',
  'Harga Perodua 5W30 4L',
  'Myvi brake pad rear in stock?',
  'Invoice for WYU6175',
];

export default function AssistantPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [canUse, setCanUse] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: ok } = await supabase.rpc('can_access', { p_feature: 'assistant' });
        setCanUse(ok === true);
      } else setCanUse(false);
    })();
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next }),
      });
      const j = await r.json().catch(() => ({}));
      const reply = r.ok ? (j.reply as string) : (j.error as string) || 'Something went wrong — please try again.';
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Network error — please try again.' }]);
    } finally {
      setBusy(false);
    }
  }, [messages, busy]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  if (authed === null || canUse === null) {
    return <div className="py-16 text-center text-sm text-ink-3">Loading…</div>;
  }
  if (!authed) {
    return <div className="py-16 text-center text-sm text-ink-2">Please <a href="/login" className="font-medium text-accent">sign in</a> to use the assistant.</div>;
  }
  if (!canUse) {
    return (
      <div className="mx-auto max-w-md rounded-card border border-line bg-card p-6 text-center shadow-card">
        <div className="text-base font-semibold text-ink">Assistant not enabled</div>
        <p className="mt-1 text-sm text-ink-2">Your position doesn&apos;t have access to the assistant yet. Ask the owner to turn it on in <span className="font-medium">Settings → Access</span>.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col lg:h-[calc(100dvh-3rem)]">
      {/* Header */}
      <div className="flex items-center gap-2.5 pb-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-weak text-accent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" /><path d="M19 14l.9 2.1 2.1.9-2.1.9L19 20l-.9-2.1-2.1-.9 2.1-.9L19 14Z" /></svg>
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight text-ink">Assistant</h1>
          <p className="text-xs text-ink-3">Ask about parts, prices, stock &amp; invoices — answers come from live data.</p>
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-card border border-line bg-card/40 p-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-ink-2">Hi! Ask me about a part, a price, what&apos;s in stock, or an invoice. I only answer from the shop&apos;s real data.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => send(ex)}
                  className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-2 shadow-sm transition hover:bg-ink/5 hover:text-ink">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === 'user' ? 'bg-accent text-white' : 'border border-line bg-card text-ink shadow-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink-3 shadow-sm">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40" style={{ animationDelay: '120ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40" style={{ animationDelay: '240ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask about a part, price, stock, or invoice…"
          className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>
        </button>
      </div>
      <p className="pt-1.5 text-center text-[11px] text-ink-3">The assistant can make mistakes — double-check anything important.</p>
    </div>
  );
}
