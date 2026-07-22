// src/lib/pushServer.ts
// Server-only helpers for sending Web Push (VAPID). Never import from a client component.
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Service-role client — reads subscriptions + secrets, prunes dead endpoints.
export const pushAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export type PushSecrets = {
  vapid_public?: string;
  vapid_private?: string;
  vapid_subject?: string;
  app_base_url?: string;
  push_dispatch_token?: string;
};

export async function loadPushSecrets(): Promise<PushSecrets> {
  const { data } = await pushAdmin
    .from('app_secrets')
    .select('name,value')
    .in('name', ['vapid_public', 'vapid_private', 'vapid_subject', 'app_base_url', 'push_dispatch_token']);
  const m: PushSecrets = {};
  for (const r of (data ?? []) as { name: string; value: string }[]) (m as Record<string, string>)[r.name] = r.value;
  return m;
}

export function configureVapid(s: PushSecrets) {
  webpush.setVapidDetails(s.vapid_subject || 'mailto:zordaqputrajaya@gmail.com', s.vapid_public ?? '', s.vapid_private ?? '');
}

export type SubRow = { endpoint: string; p256dh: string; auth: string };

// Returns { ok, dead } — dead=true means the endpoint is gone (404/410) and should be removed.
export async function sendToSubscription(sub: SubRow, payload: string): Promise<{ ok: boolean; dead: boolean }> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    return { ok: true, dead: false };
  } catch (e: unknown) {
    const code = (e as { statusCode?: number })?.statusCode;
    return { ok: false, dead: code === 404 || code === 410 };
  }
}
