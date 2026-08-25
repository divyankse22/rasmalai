import localFont from 'next/font/local';

/*
 * The two faces, self-hosted.
 *
 * The files are committed under `./fonts/` rather than fetched by `next/font/google`, because
 * `theme.css` promises the build stays deterministic and offline-friendly — and the Google loader
 * needs the network at build time. Both families are OFL-licensed (see the LICENSE files beside
 * the woff2s), copied out of `@fontsource/poppins` and `@fontsource-variable/inter`; those two
 * packages are devDependencies purely to record provenance and to make re-copying easy.
 *
 * Only 600/700/800 of Poppins ship: `font-display` is used with `font-semibold` and `font-bold`
 * across 34 files, and 800 exists for the hero heading. There is no variable Poppins, so each
 * weight is its own file. Inter is a single variable file covering the whole 100–900 range.
 *
 * These are consumed via `--font-display` / `--font-body` in `theme.css`. Nothing imports this
 * module except `layout.tsx`, which keeps `next/font` out of every component test.
 */

export const display = localFont({
  src: [
    { path: './fonts/poppins-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/poppins-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/poppins-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
  fallback: ['ui-rounded', 'SF Pro Rounded', 'Nunito', 'system-ui', 'sans-serif'],
});

export const body = localFont({
  src: [{ path: './fonts/inter-latin-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'sans-serif'],
});
