// src/components/icons.tsx
// Shared monochrome line icons (stroke = currentColor) for the Apple-clean UI.
// Size defaults to 18px; colour comes from the parent's text colour.
import React from 'react';

export type IconName =
  | 'users' | 'wrench' | 'calendar' | 'clipboard' | 'trending'
  | 'bell' | 'receipt' | 'briefcase' | 'phone';

const PATHS: Record<IconName, React.ReactNode> = {
  users: (<><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7.5" r="3.5" /><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.7-3.4" /><path d="M15 4.1a3.5 3.5 0 0 1 0 6.8" /></>),
  wrench: (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />),
  calendar: (<><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17" /><path d="M8 2.5v4M16 2.5v4" /></>),
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><path d="M9 11h6M9 15h4" /></>),
  trending: (<><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>),
  bell: (<><path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17s-2.5-2-2.5-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  receipt: (<><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2Z" /><path d="M8 7.5h8M8 11.5h8" /></>),
  briefcase: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12.5h18" /></>),
  phone: (<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />),
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
