import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ReceiveResult } from '../../shared/types';
import type { AppEnv } from '../env';
import { TOKEN_PATTERN, findEndpointByToken } from '../lib/endpoints';
import { rateLimit } from '../lib/rate-limit';
import { verifySignature } from '../lib/signature';
import { eventIdOf, storeWebhook } from '../lib/webhooks';

/** Largest body accepted, in bytes. Larger deliveries are refused with `413` before they are read. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Answers `404` to a token that is not shaped like the ones this Worker makes, before the rate limiter
 * and the database see it. A request that fails here can never belong to an endpoint, so it costs no
 * rate limit key and no query.
 */
const wellFormedToken: MiddlewareHandler<AppEnv, '/:token'> = async (c, next) => {
  if (!TOKEN_PATTERN.test(c.req.param('token'))) {
    return c.json({ error: 'Not found' }, 404);
  }
  await next();
};

/**
 * Receives webhooks: `POST /hooks/<token>`, mounted at `/hooks`. It is public on purpose, outside
 * Cloudflare Access, because senders cannot sign in. The secret token in the path picks the endpoint,
 * and the endpoint's signature format decides how the sender proves it is who it says.
 */
export const hooks = new Hono<AppEnv>();

hooks.post(
  '/:token',
  wellFormedToken,
  rateLimit,
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'Payload too large' }, 413) }),
  async (c) => {
    const endpoint = await findEndpointByToken(c.env.DB, c.req.param('token'));
    if (!endpoint) {
      return c.json({ error: 'Not found' }, 404);
    }
    // Read once, as bytes. The signature covers these exact bytes, so they are checked before any decoding.
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const headers = c.req.raw.headers;
    const refusal = await verifySignature(endpoint.format, endpoint.secret, headers, raw);
    if (refusal) {
      return c.json({ error: refusal }, 401);
    }
    // Stored and searched as text. `ignoreBOM` keeps a leading byte order mark in the text instead of dropping it,
    // and bytes that are not valid UTF-8 become U+FFFD; `size` stays the real byte length.
    const body = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(raw);
    const { duplicate } = await storeWebhook(c.env.DB, {
      endpointId: endpoint.id,
      eventId: eventIdOf(endpoint.format, headers, body),
      contentType: headers.get('content-type'),
      size: raw.byteLength,
      verified: endpoint.format !== 'none',
      headers,
      body,
    });
    return c.json<ReceiveResult>({ received: true, duplicate });
  },
);
