export const dynamic = 'force-dynamic';

import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
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

export const viewport: Viewport = { themeColor: '#0f172a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* Restore the sidebar-collapsed preference before paint (avoids a flash on reload). */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('nav_collapsed')==='1')document.documentElement.setAttribute('data-nav-collapsed','1')}catch(e){}" }} />
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
