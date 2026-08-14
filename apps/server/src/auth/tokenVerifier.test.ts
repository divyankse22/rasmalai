import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier, type TokenVerifier } from './tokenVerifier';

const ISSUER = 'https://project.supabase.co/auth/v1';
const KID = 'test-key';

let privateKey: CryptoKey;
let jwksServer: Server;
let verifier: TokenVerifier;

/** Mints a token the way Supabase would, so the verifier is exercised against a real signature. */
async function mint(claims: Record<string, unknown> = {}, expiresIn = '1h'): Promise<string> {
  return new SignJWT({ email: 'someone@example.com', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('ES256', { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);

  jwksServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] }));
  }).listen(0);
  await new Promise((resolve) => jwksServer.once('listening', resolve));

  const address = jwksServer.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  verifier = createTokenVerifier({
    issuer: ISSUER,
    jwksUrl: `http://127.0.0.1:${address.port}/jwks.json`,
  });
});

afterAll(async () => {
  await new Promise((resolve) => jwksServer.close(resolve));
});

describe('createTokenVerifier', () => {
  it('accepts a correctly signed token and extracts the user', async () => {
    const user = await verifier.verify(await mint());

    expect(user.userId).toBe('user-123');
    expect(user.email).toBe('someone@example.com');
    expect(user.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects an expired token', async () => {
    await expect(verifier.verify(await mint({}, '-1s'))).rejects.toThrow();
  });

  it('rejects a token issued by someone else', async () => {
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer('https://attacker.example/auth/v1')
      .setAudience('authenticated')
      .setSubject('user-123')
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(foreign)).rejects.toThrow();
  });

  it('rejects an anon-role token, which is signed by the same project but is not a user', async () => {
    const anon = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('anon')
      .setSubject('user-123')
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(anon)).rejects.toThrow();
  });

  it('rejects a token with no subject', async () => {
    const subjectless = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifier.verify(subjectless)).rejects.toThrow(/subject/);
  });

  it('rejects a token signed with the wrong key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('ES256', { extractable: true });
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setSubject('user-123')
      .setExpirationTime('1h')
      .sign(otherKey);

    await expect(verifier.verify(forged)).rejects.toThrow();
  });

  it.each([['garbage'], [''], ['a.b.c']])('rejects malformed token %j', async (token) => {
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
