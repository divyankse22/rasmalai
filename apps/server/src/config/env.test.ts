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

  it('names the offending variable when configuration is invalid', () => {
    expect(() => loadEnv({ ...MINIMAL, APP_ORIGIN: 'not-a-url' })).toThrow(/APP_ORIGIN/);
    expect(() => loadEnv({ ...MINIMAL, PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...MINIMAL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadEnv({ NEXT_PUBLIC_SUPABASE_URL: 'nope' })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => loadEnv({ ...MINIMAL, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });
});
