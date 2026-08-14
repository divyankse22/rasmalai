import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_CA_PATH = '../../supabase/prod-ca.crt';

export interface CertificateSource {
  /** The PEM itself. Used on hosts where a file is awkward - Render, for instance. */
  SUPABASE_CA_CERT?: string | undefined;
  /** Where to read the PEM from instead. Relative paths resolve from the server workspace. */
  SUPABASE_CA_CERT_PATH?: string | undefined;
}

/**
 * Finds the Supabase CA certificate.
 *
 * Supabase signs its Postgres endpoint with a private CA that is not in Node's trust store, so the
 * certificate has to come from somewhere. It is a public certificate - Supabase serves it to
 * everyone who connects - but it is kept out of the repository, which means the two supported
 * sources are an environment variable or a path.
 *
 * There is deliberately no fallback to `rejectUnauthorized: false`: a missing certificate is a
 * configuration mistake, and answering it by silently accepting any certificate would turn a loud
 * failure into an invisible one on the connection carrying every couple's data.
 */
export function resolveCertificateAuthority(env: CertificateSource): string {
  const inline = env.SUPABASE_CA_CERT;
  // Trim only to decide whether it is meaningfully set: the PEM itself is returned verbatim,
  // trailing newline included, because some parsers care.
  if (inline && inline.trim().length > 0) {
    // Platforms that cannot hold newlines in a variable let you write them as \n.
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }

  const path = resolve(process.cwd(), env.SUPABASE_CA_CERT_PATH ?? DEFAULT_CA_PATH);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Could not find the Supabase CA certificate.\n` +
        `Download it from your project's Connect panel, then either save it to ${path} ` +
        `or set SUPABASE_CA_CERT to its contents.\n` +
        `Refusing to connect without certificate verification.`,
    );
  }
}
