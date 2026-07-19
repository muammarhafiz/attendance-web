// src/app/niagawan/settings/page.tsx
'use client';

import AutomationSettings from '@/components/settings/AutomationSettings';

// Kept for the existing Niagawan > Settings tab; the same panel also lives under the
// top-level Settings page (/settings). Both render the shared AutomationSettings component.
export default function NiagawanSettingsPage() {
  return <AutomationSettings />;
}
