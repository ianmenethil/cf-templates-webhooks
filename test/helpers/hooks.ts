import { env, exports } from 'cloudflare:workers';
import { expect } from 'vitest';
import type {
  CreateEndpointRequest,
  CreatedEndpoint,
  Endpoint,
  WebhookDetail,
  WebhookResponse,
} from '../../src/shared/types';
import { adminApi, postJson } from './admin';

/** A Standard Webhooks secret: `whsec_` and base64 of 32 bytes. */
export const STANDARD_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const encoder = new TextEncoder();

/** A body as a test writes it: text, or raw bytes for payloads that are not valid UTF-8. */
type Body = string | Uint8Array;

/**
 * Signs a prefix followed by a body with HMAC-SHA256.
 * @param key - The key bytes.
 * @param prefix - Text signed in front of the body, such as `<timestamp>.`.
 * @param body - The body; text is encoded as UTF-8, bytes are signed as they are.
 * @returns The signature bytes.
 */
const hmac = async (key: Uint8Array, prefix: string, body: Body): Promise<Uint8Array> => {
  const head = encoder.encode(prefix);
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  const message = new Uint8Array(head.byteLength + bytes.byteLength);
  message.set(head);
  message.set(bytes, head.byteLength);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message));
};

/**
 * Builds the `Stripe-Signature` header from Stripe's documentation: `t=<seconds>,v1=<hex HMAC of "<t>.<body>">`.
 * @param secret - The signing secret, used as written.
 * @param body - The body being sent.
 * @param timestamp - The signed time in seconds.
 * @returns The header value.
 */
export const stripeSignature = async (secret: string, body: Body, timestamp = nowSeconds()): Promise<string> =>
  `t=${timestamp},v1=${hex(await hmac(encoder.encode(secret), `${timestamp}.`, body))}`;

/**
 * Builds the `X-Hub-Signature-256` header from GitHub's documentation: `sha256=<hex HMAC of the body>`.
 * @param secret - The webhook secret, used as written.
 * @param body - The body being sent.
 * @returns The header value.
 */
export const githubSignature = async (secret: string, body: Body): Promise<string> =>
  `sha256=${hex(await hmac(encoder.encode(secret), '', body))}`;

/**
 * Builds the three Standard Webhooks headers from its spec: `v1,<base64 HMAC of "<id>.<timestamp>.<body>">`,
 * keyed with the base64-decoded part of the `whsec_` secret.
 * @param secret - A `whsec_` secret.
 * @param id - The `webhook-id`.
 * @param body - The body being sent.
 * @param timestamp - The signed time in seconds.
 * @returns The headers.
 */
export const standardHeaders = async (
  secret: string,
  id: string,
  body: Body,
  timestamp = nowSeconds(),
): Promise<Record<string, string>> => {
  const key = Uint8Array.from(atob(secret.slice('whsec_'.length)), (char) => char.charCodeAt(0));
  const signature = btoa(String.fromCharCode(...(await hmac(key, `${id}.${timestamp}.`, body))));
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` };
};

/**
 * Writes bytes as lower-case hexadecimal.
 * @param bytes - The bytes.
 * @returns The hex text.
 */
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Reads the clock.
 * @returns The current time in whole seconds.
 */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Creates an endpoint through the admin API, under a name no other test uses.
 * @param request - Format and secret; the name is made up.
 * @returns The created endpoint.
 */
export const createTestEndpoint = async (request: Omit<CreateEndpointRequest, 'name'>): Promise<Endpoint> => {
  const response = await postJson('/endpoints', { name: `t-${crypto.randomUUID().slice(0, 8)}`, ...request });
  expect(response.status).toBe(201);
  return (await response.json<CreatedEndpoint>()).endpoint;
};

/**
 * Posts a delivery to an endpoint's public address, as a sender would.
 * @param endpoint - The endpoint to post to.
 * @param body - The raw body, as text or bytes.
 * @param headers - The sender's headers.
 * @returns The Worker's response.
 */
export const deliver = (endpoint: Pick<Endpoint, 'url'>, body: Body, headers: HeadersInit = {}): Promise<Response> =>
  exports.default.fetch(endpoint.url, { method: 'POST', headers, body });

/** A webhook row as stored, for checks that go behind the admin API. */
export type StoredWebhook = {
  id: string;
  event_id: string | null;
  deliveries: number;
  verified: number;
  size: number;
  headers: string;
  body: string;
};

/**
 * Reads the stored webhooks of an endpoint straight from the database.
 * @param endpointId - The endpoint's ID.
 * @returns Its rows.
 */
export const storedWebhooks = async (endpointId: string): Promise<StoredWebhook[]> =>
  (await env.DB.prepare('SELECT * FROM webhooks WHERE endpoint_id = ? ORDER BY received_at').bind(endpointId).all<StoredWebhook>())
    .results;

/** What a test sets on a webhook it puts into the database directly. */
export type SeedWebhook = { id?: string; eventId?: string | null; receivedAt: string; lastReceivedAt?: string; body?: string };

/**
 * Puts webhooks into the database directly, so a test can choose their IDs and times.
 * @param endpointId - The endpoint they belong to.
 * @param webhooks - The webhooks to add.
 */
export const seedWebhooks = async (endpointId: string, webhooks: SeedWebhook[]): Promise<void> => {
  const insert = env.DB.prepare(
    `INSERT INTO webhooks (id, endpoint_id, event_id, received_at, last_received_at, size, verified, headers, body)
     VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?)`,
  );
  await env.DB.batch(
    webhooks.map(({ id = crypto.randomUUID(), eventId = null, receivedAt, lastReceivedAt = receivedAt, body = '{}' }) =>
      insert.bind(id, endpointId, eventId, receivedAt, lastReceivedAt, body.length, body),
    ),
  );
};

/**
 * Reads one stored webhook the way the panel does.
 * @param id - The webhook's ID.
 * @returns The webhook with headers and body.
 */
export const detailOf = async (id: string): Promise<WebhookDetail> =>
  (await (await adminApi(`/webhooks/${id}`)).json<WebhookResponse>()).webhook;
