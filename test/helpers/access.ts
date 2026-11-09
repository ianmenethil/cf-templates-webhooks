import { sign } from 'hono/jwt';
import { vi } from 'vitest';
import { AUD, TEAM_DOMAIN } from './constants';

/** Where the team publishes its signing keys. */
export const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;

/** Email of the signed-in user in the tests' Access tokens. */
export const ADMIN_EMAIL = 'admin@ianmenethil.com';

const KEY_ID = 'test-key';

const keyPair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;

// A `kid` on the signing key puts it in the token header, where the verifier matches it to the key set.
const privateJwk = { ...((await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey), kid: KEY_ID };
const publicJwk = { ...((await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey), kid: KEY_ID };

/** Serves the test key set from the team's certs URL, the way Cloudflare Access does. */
export const serveAccessKeys = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === CERTS_URL
        ? Response.json({ keys: [publicJwk] })
        : new Response('not found', { status: 404 }),
    ),
  );
};

/**
 * Signs a token shaped like the one Cloudflare Access forwards in `Cf-Access-Jwt-Assertion`.
 * @param claims - Claims that replace the defaults.
 * @returns The signed token.
 */
export const accessToken = (claims: Record<string, unknown> = {}): Promise<string> =>
  sign(
    {
      iss: TEAM_DOMAIN,
      aud: [AUD],
      email: ADMIN_EMAIL,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    },
    privateJwk,
    'RS256',
  );
