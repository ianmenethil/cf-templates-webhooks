import { createMiddleware } from 'hono/factory';
import { verifyWithJwks } from 'hono/jwt';
import type { AppEnv } from '../env';

/** Cloudflare caches the team's signing keys for this many seconds; they rotate about every 6 weeks. */
export const CERTS_CACHE_SECONDS = 300;

/** Header in which Cloudflare Access forwards the signed-in user's token, without a `Bearer` prefix. */
const ACCESS_TOKEN_HEADER = 'Cf-Access-Jwt-Assertion';

/**
 * Lets a request through only when Cloudflare Access signed the user in for this application.
 *
 * Access must be set up as a self-hosted application on the `/admin` path. This check makes sure
 * the Worker cannot be reached around it (for example on another hostname): it accepts
 * `ctx.access` when the runtime provides it, otherwise it verifies the Access token against the
 * team's public keys. Both must match `ACCESS_AUD`, and without `ACCESS_TEAM_DOMAIN` and
 * `ACCESS_AUD` every admin request is refused. Refusals answer `{ error }` JSON, like every other error.
 * Trailing slashes on `ACCESS_TEAM_DOMAIN` are ignored, so `https://team.cloudflareaccess.com/` works.
 */
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD: aud } = c.env;
  const teamDomain = ACCESS_TEAM_DOMAIN.replace(/\/+$/, '');
  if (!teamDomain || !aud) {
    return c.json({ error: 'Admin is not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD.' }, 403);
  }

  // Hono types `executionCtx` with its own minimal interface; the Workers runtime type has `access`.
  const { access } = c.executionCtx as ExecutionContext;
  if (access) {
    if (access.aud !== aud) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const identity = await access.getIdentity();
    c.set('adminEmail', identity?.email ?? 'admin');
    return next();
  }

  // Hono's `jwk` middleware expects `Bearer <token>`, so the bare Access token is verified directly.
  const token = c.req.header(ACCESS_TOKEN_HEADER);
  if (!token) {
    return c.json({ error: 'Sign in through Cloudflare Access to use the admin panel.' }, 401);
  }
  try {
    const { email } = await verifyWithJwks(
      token,
      {
        jwks_uri: `${teamDomain}/cdn-cgi/access/certs`,
        allowedAlgorithms: ['RS256'],
        verification: { iss: teamDomain, aud },
      },
      // Reuse the keys from Cloudflare's cache instead of fetching them on every admin request.
      { cf: { cacheTtl: CERTS_CACHE_SECONDS, cacheEverything: true } },
    );
    c.set('adminEmail', typeof email === 'string' ? email : 'admin');
  } catch {
    return c.json({ error: 'Your Cloudflare Access session is not valid for this application.' }, 401);
  }
  return next();
});
