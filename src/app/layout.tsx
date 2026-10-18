import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteNav } from '@/components/site-nav';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CraftMind AI — Praxium',
  description: 'WhatsApp inquiries → structured specs, studio mockups, BoM breakdowns and quotations for bespoke leather and furniture workshops, with crafter approval.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteNav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
