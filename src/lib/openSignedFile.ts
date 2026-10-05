import { supabase } from '@/lib/supabaseClient';

// Open a private Storage file in a new tab, mobile-safe.
// window.open() called AFTER an await (e.g. createSignedUrl) loses the user-gesture and is
// silently blocked as a popup on phones — so we open the blank tab synchronously inside the
// tap, then point it at the signed URL once it resolves. Falls back to the current tab if the
// popup was blocked, and surfaces errors instead of doing nothing.
export async function openSignedFile(bucket: string, path: string | null, expiresSeconds = 300): Promise<void> {
  if (!path) return;
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresSeconds);
  if (error || !data?.signedUrl) {
    if (w) w.close();
    alert('Could not open the file: ' + (error?.message ?? 'unknown error'));
    return;
  }
  if (w) w.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
