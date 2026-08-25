import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCertificateAuthority } from './certificateAuthority';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('resolveCertificateAuthority', () => {
  it('prefers the inline environment variable', () => {
    expect(resolveCertificateAuthority({ SUPABASE_CA_CERT: PEM })).toBe(PEM);
  });

  it('unescapes newlines for platforms that cannot store them', () => {
    const escaped = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';

    expect(resolveCertificateAuthority({ SUPABASE_CA_CERT: escaped })).toBe(
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    );
  });

  it('reads from an explicit path when no inline value is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rasmalai-ca-'));
    const path = join(dir, 'ca.crt');
    writeFileSync(path, PEM);

    expect(resolveCertificateAuthority({ SUPABASE_CA_CERT_PATH: path })).toBe(PEM);
  });

  it('ignores an empty inline value rather than connecting with nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rasmalai-ca-'));
    const path = join(dir, 'ca.crt');
    writeFileSync(path, PEM);

    expect(resolveCertificateAuthority({ SUPABASE_CA_CERT: '   ', SUPABASE_CA_CERT_PATH: path })).toBe(
      PEM,
    );
  });

  it('fails loudly, and explains where to get the certificate', () => {
    expect(() =>
      resolveCertificateAuthority({ SUPABASE_CA_CERT_PATH: '/nowhere/at/all.crt' }),
    ).toThrow(/Connect panel|SUPABASE_CA_CERT/);
  });

  it('never falls back to skipping verification', () => {
    let message = '';
    try {
      resolveCertificateAuthority({ SUPABASE_CA_CERT_PATH: '/nowhere/at/all.crt' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/Refusing to connect/);
  });
});
