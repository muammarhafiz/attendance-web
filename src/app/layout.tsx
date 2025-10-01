// src/app/layout.tsx
export const dynamic = 'force-dynamic';

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'Attendance ZP',
  description: 'Staff attendance & reporting',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-white text-neutral-900 m-0`}>
        <NavBar />
        <main className="mx-auto max-w-[1100px] px-4 py-4">
          {children}
        </main>
      </body>
    </html>
  );
}
