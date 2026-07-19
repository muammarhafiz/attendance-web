// src/app/niagawan/settings/page.tsx
import { redirect } from 'next/navigation';

// Settings now live on the single top-level Settings page (/settings). This old URL forwards there.
export default function NiagawanSettingsRedirect() {
  redirect('/settings');
}
