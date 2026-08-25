import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { body, display } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rasmalai',
  description: 'A tiny world for two.',
  // The product is private by design: no discovery, no indexing.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately not locking zoom - games handle their own gestures, people still need to pinch.
  maximumScale: 5,
  themeColor: '#fff8f2',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  /*
   * The font variables go on <html>, not <body>.
   *
   * Tailwind v4 emits `@theme` tokens into a `:root { ... }` block, so `--font-display`'s
   * `var(--font-poppins)` is resolved in the context of the <html> element. `next/font` defines
   * that variable inside a generated class; if the class sat on <body>, the variable would not
   * exist at :root, `var()` would resolve to nothing, and every `font-display` utility would fall
   * through to the fallback stack — which looks almost right and is miserable to diagnose.
   */
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
