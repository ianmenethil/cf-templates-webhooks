import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import type { AdminProfile, CreatedEndpoint, EndpointList, WebhookList, WebhookResponse } from '../../shared/types';
import type { AppEnv } from '../env';
import { requireAccess } from '../lib/access';
import { createEndpoint, deleteEndpoint, endpointValidator, listEndpoints } from '../lib/endpoints';
import { deleteWebhook, getWebhook, listWebhooks, parseCursor } from '../lib/webhooks';

/**
 * Admin panel, its JSON API and its files, mounted at `/admin` and only reachable through Cloudflare Access.
 * `run_worker_first` in `wrangler.jsonc` sends every `/admin` request here, so the panel's own page
 * and script are behind the same Access check as the API.
 */
export const admin = new Hono<AppEnv>();

// `vite dev` adds an inline script (React's hot reload). Vite replaces `import.meta.env.DEV` with
// `false` in a build, so the production Worker allows only the page's own scripts.
const scriptSrc = import.meta.env.DEV ? ["'self'", "'unsafe-inline'"] : ["'self'"];

// shadcn's toast (Sonner) and dialog (Radix) add <style> tags and style attributes at runtime.
const styleSrc = ["'self'", "'unsafe-inline'"];

admin.use(requireAccess);
admin.use(
  secureHeaders({
    // The panel is never shown inside another page, so the older header says so too; the CSP's
    // `frame-ancestors 'none'` below is the modern form of the same rule.
    xFrameOptions: 'DENY',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc,
      styleSrc,
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'none'"],
    },
  }),
);
// The API answers only this panel: it sends no CORS headers, so browsers stop other sites from
// reading it, and csrf() refuses changes (create, delete) that do not come from this site's pages.
admin.use('/api/*', csrf());
// Answers hold the signed-in user's data and webhook bodies, so no cache keeps a copy.
admin.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

/**
 * The address the request came to, such as `https://hooks.example.com`, from which endpoint URLs are built.
 * @param c - The request context.
 * @returns The request's origin.
 */
const originOf = (c: Context<AppEnv>): string => new URL(c.req.url).origin;

admin.get('/api/me', (c) => c.json<AdminProfile>({ email: c.get('adminEmail'), brand: c.env.BRAND_NAME }));

admin.get('/api/endpoints', async (c) =>
  c.json<EndpointList>({ endpoints: await listEndpoints(c.env.DB, originOf(c)) }),
);

admin.post('/api/endpoints', endpointValidator, async (c) => {
  const endpoint = await createEndpoint(c.env.DB, c.req.valid('json'), c.get('adminEmail'), originOf(c));
  if (!endpoint) {
    return c.json({ error: 'An endpoint with this name already exists.' }, 409);
  }
  return c.json<CreatedEndpoint>({ endpoint }, 201);
});

admin.delete('/api/endpoints/:id', async (c) => {
  await deleteEndpoint(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});

admin.get('/api/webhooks', async (c) => {
  const before = c.req.query('before');
  const cursor = before ? parseCursor(before) : undefined;
  if (cursor === null) {
    return c.json({ error: 'before is not a cursor from an earlier answer.' }, 400);
  }
  return c.json<WebhookList>(
    await listWebhooks(c.env.DB, { endpoint: c.req.query('endpoint'), q: c.req.query('q'), before: cursor }),
  );
});

admin.get('/api/webhooks/:id', async (c) => {
  const webhook = await getWebhook(c.env.DB, c.req.param('id'));
  return webhook ? c.json<WebhookResponse>({ webhook }) : c.json({ error: 'Not found' }, 404);
});

admin.delete('/api/webhooks/:id', async (c) => {
  await deleteWebhook(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});

// An API path that matches nothing above answers JSON, not the panel's page.
admin.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Everything else under /admin is the React app: its page and bundled files.
admin.get('*', async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (asset.status === 404) {
    return c.notFound();
  }
  // Asset responses have immutable headers; a copy lets secureHeaders add its own.
  return new Response(asset.body, asset);
});
