import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface VerifiedUser {
  userId: string;
  email: string | undefined;
  /** Epoch milliseconds at which this token stops being valid. */
  expiresAt: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedUser>;
}

export interface TokenVerifierOptions {
  issuer: string;
  jwksUrl: string | URL;
}

/**
 * Verifies a Supabase access token against the project's published public keys.
 *
 * Supabase signs asymmetrically (ES256), so the backend holds no secret at all - it fetches the
 * public key set and checks the signature. `jose` caches the key set and only refetches on a
 * key rotation, so this costs one request at startup rather than one per connection.
 *
 * Issuer and audience are both asserted: without the audience check an anon-role token would
 * verify happily and we would treat an unauthenticated visitor as a signed-in user.
 */
export function createTokenVerifier({ issuer, jwksUrl }: TokenVerifierOptions): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return {
    async verify(token: string): Promise<VerifiedUser> {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: 'authenticated',
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token has no subject');
      }

      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        expiresAt: (payload.exp ?? 0) * 1000,
      };
    },
  };
}

/** Derives the issuer and JWKS location from a Supabase project URL. */
export function createSupabaseTokenVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  return createTokenVerifier({ issuer, jwksUrl: `${issuer}/.well-known/jwks.json` });
}