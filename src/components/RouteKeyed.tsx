'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function RouteKeyed({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Forces a full unmount/remount of the page when the route changes
  return <div key={pathname}>{children}</div>;
}