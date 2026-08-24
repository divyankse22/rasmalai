'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { SignOutButton } from '@/features/auth/SignOutButton';

/**
 * The sections a signed-in person can reach. Two for now; the lobby and profile join them later,
 * which is the whole reason this is a list rather than two hardcoded links.
 */
const SECTIONS = [
  { href: '/dashboard', label: 'Dashboard', glyph: '💗', blurb: 'The two of you, by the numbers' },
  { href: '/games', label: 'Games', glyph: '🎮', blurb: 'Everything you can play' },
] as const;

/**
 * Hamburger and side drawer.
 *
 * Built for a thumb: a 44px target, `:active` styling rather than hover
 * (`docs/06_UX_AND_STATE_FLOWS.md` forbids hover-only interaction), and it closes on the backdrop,
 * on Escape, and on choosing a section — three ways out, because a drawer you cannot dismiss on a
 * phone is a trap.
 */
export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownAt, setShownAt] = useState(pathname);
  const panelRef = useRef<HTMLDivElement>(null);

  // Route changes come from anywhere — a link in here, the back button, a redirect — so the drawer
  // closes on the path itself rather than on the click that might have caused it. Adjusted during
  // render rather than in an effect: that is React's own guidance for resetting state when an input
  // changes, and it avoids rendering the drawer open on the new page for a frame first.
  if (shownAt !== pathname) {
    setShownAt(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    // Without this the page behind the drawer scrolls under your finger on iOS.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the drawer, so a keyboard or screen reader lands where the eye already is.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-nav-drawer"
          onClick={() => setOpen(true)}
          className="flex size-11 items-center justify-center rounded-pill bg-shell text-ink shadow-soft transition-transform duration-quick ease-bounce active:scale-95 active:bg-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
        >
          {/* Drawn rather than an icon font: three rounded bars cost nothing and match the theme. */}
          <span className="flex flex-col gap-1" aria-hidden="true">
            <span className="block h-0.5 w-5 rounded-pill bg-ink" />
            <span className="block h-0.5 w-5 rounded-pill bg-ink" />
            <span className="block h-0.5 w-5 rounded-pill bg-ink" />
          </span>
        </button>

        <Link
          href="/dashboard"
          className="font-display text-lg font-bold text-berry transition-transform duration-quick ease-bounce active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
        >
          Rasmalai
        </Link>
      </div>

      {/* Always mounted so the slide animation has something to animate, and hidden from assistive
          technology and from the tab order while closed. */}
      <div
        className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-ink/30 transition-opacity duration-soft ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <div
          id="app-nav-drawer"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Sections"
          tabIndex={-1}
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-shell px-5 py-6 shadow-lift transition-transform duration-soft ease-bounce focus-visible:outline-none ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-xl font-bold text-berry">Rasmalai</span>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="flex size-11 items-center justify-center rounded-pill text-xl text-muted transition-transform duration-quick ease-bounce active:scale-95 active:bg-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <nav className="flex flex-col gap-2">
            {SECTIONS.map((section) => {
              const active = pathname === section.href;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-start gap-3 rounded-soft px-3 py-3 transition-transform duration-quick ease-bounce active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry ${
                    active ? 'bg-blush' : 'bg-cream active:bg-blush'
                  }`}
                >
                  <span className="text-xl" aria-hidden="true">
                    {section.glyph}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-display font-semibold text-ink">{section.label}</span>
                    <span className="text-xs text-muted">{section.blurb}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex justify-center">
            <SignOutButton />
          </div>
        </div>
      </div>
    </>
  );
}
