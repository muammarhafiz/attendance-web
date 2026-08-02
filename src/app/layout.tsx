export const dynamic = 'force-dynamic';

import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import NavBar from '@/components/NavBar';
import Container from '@/components/Container';
import RouteKeyed from '@/components/RouteKeyed';
import PwaRegister from '@/components/PwaRegister';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Zordaq Auto Services',
  description: 'Zordaq Auto Services — staff attendance, payroll & Niagawan operations.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.png', apple: '/icon.png' },
  appleWebApp: { capable: true, title: 'Zordaq', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* Restore the theme + sidebar-collapsed preferences before paint (avoids a flash on reload).
            No stored theme → no data-theme attr → the prefers-color-scheme media query follows the OS. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);if(localStorage.getItem('nav_collapsed')==='1')document.documentElement.setAttribute('data-nav-collapsed','1')}catch(e){}" }} />
        {/* Top progress bar + corner spinner on every navigation (fires on click, finishes when the page is ready). */}
        <NextTopLoader color="var(--app-accent)" height={3} showSpinner shadow="0 0 10px var(--app-accent), 0 0 5px var(--app-accent)" zIndex={1600} />
        <PwaRegister />
        <NavBar />
        {/* Clear the fixed sidebar (desktop) and the mobile top bar; app-main lets the collapse CSS drop the padding. */}
        <main className="app-main pt-14 lg:pl-64 lg:pt-0">
          <Container>
            <RouteKeyed>{children}</RouteKeyed>
          </Container>
        </main>
      </body>
    </html>
  );
}
