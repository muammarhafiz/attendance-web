// src/app/attendance/settings/page.tsx
'use client';

import AttendanceSettings from '@/components/settings/AttendanceSettings';

// Kept for the existing Attendance settings route; the same panel also lives under the
// top-level Settings page (/settings). Both render the shared AttendanceSettings component.
export default function AttendanceSettingsPage() {
  return <AttendanceSettings />;
}
