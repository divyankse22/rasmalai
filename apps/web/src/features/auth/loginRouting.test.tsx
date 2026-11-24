import { fireEvent, render, screen } from '@testing-library/react';
import PageError from '@/app/error';
import { NextRequest } from 'next/server';
import type { CookieMethodsServer } from '@supabase/ssr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/auth/callback/route';
import { getDashboard, getMyProfile, getPairingState } from '@/lib/api';
import { updateSession } from '@/lib/supabase/proxy';

const { exchangeCodeForSession, getUser } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  publicEnv: { supabaseUrl: 'https://auth.example', supabasePublishableKey: 'test' },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: { exchangeCodeForSession, getSession: () => ({ data: { session: null } }) },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: CookieMethodsServer },
  ) => ({
    auth: { getUser: () => getUser(cookies) },
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('sign-in routing', () => {
  it('keeps the successful callback on the origin that received the session cookie', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new Request('http://internal.example/auth/callback?code=one-time'));
    expect(exchangeCodeForSession).toHaveBeenCalledWith('one-time');
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('sends a rotated session cookie and cache headers with the landing page redirect', async () => {
    getUser.mockImplementation(async (cookies: CookieMethodsServer) => {
      await cookies.setAll!([{ name: 'session', value: 'refreshed', options: { path: '/' } }], {
        'Cache-Control': 'private, no-store',
      });
      return { data: { user: { id: 'alice' } } };
    });
    const response = await updateSession(new NextRequest('https://app.example/'));
    expect(response.headers.get('location')).toBe('https://app.example/dashboard');
    expect(response.cookies.get('session')?.value).toBe('refreshed');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([401, 503])('keeps HTTP %i out of onboarding and pairing decisions', async (status) => {
    vi.stubGlobal('fetch', () => new Response(null, { status }));
    for (const read of [getDashboard, getMyProfile, getPairingState]) {
      await expect(read()).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it('lets the visitor retry the same page or sign out when a read fails', () => {
    const retry = vi.fn();
    render(<PageError retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form');
    expect(form).toHaveAttribute('action', '/auth/signout');
    expect(form).toHaveAttribute('method', 'post');
  });

  it('still recognizes a successful lookup for a first-time user', async () => {
    vi.stubGlobal('fetch', () => Response.json({ profile: null }));
    await expect(getMyProfile()).resolves.toBeNull();
  });
});
