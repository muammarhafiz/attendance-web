import type { SupabaseClient } from '@supabase/supabase-js';

// --- Gemini pricing (USD per 1,000,000 tokens) ---------------------------------------------------
// Published Flash-tier rate is $0.30 input / $2.50 output per 1M tokens (ai.google.dev, 2026). The
// newer 3.x-flash models are seeded at the same rate and CALIBRATED against the real AI Studio spend.
// To re-calibrate: adjust MYR_PER_USD (or a model's rate) so ai_usage totals match AI Studio's cost.
const USD_PER_1M: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-3.5-flash': { in: 0.30, out: 2.50 },
  'gemini-3.6-flash': { in: 0.30, out: 2.50 },
  'gemini-3.8-flash': { in: 0.30, out: 2.50 },
};
const DEFAULT_USD = { in: 0.30, out: 2.50 };
const MYR_PER_USD = 4.4; // calibrate against AI Studio's billed RM

type Usage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
} | null | undefined;

// Log one Gemini call's token usage + estimated cost. Best-effort: ANY failure here (missing table,
// network) is swallowed so it can NEVER break the actual AI feature. Call it with the service-role
// client (the API routes already have one) right after a successful Gemini response.
export async function logAiUsage(
  admin: SupabaseClient,
  opts: { feature: string; model: string; usage: Usage; caller?: string | null; meta?: Record<string, unknown> }
): Promise<void> {
  try {
    const u = opts.usage || {};
    const inTok = Number(u.promptTokenCount) || 0;
    // "thinking" tokens are billed at the output rate, so fold them into output.
    const outTok = (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
    const total = Number(u.totalTokenCount) || inTok + outTok;
    if (inTok === 0 && outTok === 0) return; // nothing to record
    const p = USD_PER_1M[opts.model] || DEFAULT_USD;
    const costMyr = ((inTok / 1e6) * p.in + (outTok / 1e6) * p.out) * MYR_PER_USD;
    await admin.from('ai_usage').insert({
      feature: opts.feature,
      model: opts.model,
      input_tokens: inTok,
      output_tokens: outTok,
      total_tokens: total,
      cost_myr: Math.round(costMyr * 1e6) / 1e6,
      caller: opts.caller ?? null,
      meta: opts.meta ?? null,
    });
  } catch {
    /* logging must never break the AI call */
  }
}
