import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const MINIMAL = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  DATABASE_URL: 'postgresql://postgres:pw@db.example.com:5432/postgres',
};

describe('loadEnv', () => {
  it('applies local development defaults', () => {
    const env = loadEnv(MINIMAL);

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'debug',
      APP_ORIGIN: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      DATABASE_URL: 'postgresql://postgres:pw@db.example.com:5432/postgres',
    });
  });

  it('coerces PORT from the string the platform provides', () => {
    expect(loadEnv({ ...MINIMAL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuses to boot without the Supabase project URL, which sockets cannot be verified without', () => {
    expect(() => loadEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  /*
   * The production incident this guards: APP_ORIGIN was set to the Vercel URL copied out of the
   * address bar, trailing slash included. `cors` echoed it back verbatim, the browser compared it
   * to its own slash-free `Origin` and failed every request, and the app showed "could not reach
   * Rasmalai" as though the backend were down.
   */
  it('normalises APP_ORIGIN to a bare origin the browser will match', () => {
    expect(
      loadEnv({ ...MINIMAL, APP_ORIGIN: 'https://rasmalai-sandy.vercel.app/' }).APP_ORIGIN,
    ).toBe('https://rasmalai-sandy.vercel.app');
    expect(loadEnv({ ...MINIMAL, APP_ORIGIN: 'https://example.com/app/' }).APP_ORIGIN).toBe(
      'https://example.com',
    );
  });

  it('names the offending variable when configuration is invalid', () => {
    expect(() => loadEnv({ ...MINIMAL, APP_ORIGIN: 'not-a-url' })).toThrow(/APP_ORIGIN/);
    expect(() => loadEnv({ ...MINIMAL, PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...MINIMAL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadEnv({ NEXT_PUBLIC_SUPABASE_URL: 'nope' })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => loadEnv({ ...MINIMAL, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });
});
