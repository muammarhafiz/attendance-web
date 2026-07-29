// src/app/attendance/layout.tsx
import React from 'react';

// The Today / Report / Off-day / requests / Advance / MC tabs now live in the sidebar
// (Attendance expandable area), so this layout is just the heading + the page.
export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight text-ink no-print">Attendance</h1>
      {children}
    </div>
  );
}
