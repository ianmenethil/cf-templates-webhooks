import { validator } from 'hono/validator';
import {
  ENDPOINT_NAME_PATTERN,
  SIGNATURE_FORMATS,
  type CreateEndpointRequest,
  type Endpoint,
  type SignatureFormat,
} from '../../shared/types';
import { standardKey } from './signature';

/** Longest signing secret accepted; real ones are well under 100 characters. */
const MAX_SECRET_LENGTH = 500;

/** Bytes of randomness in a token: 32 bytes is 256 bits. */
const TOKEN_BYTES = 32;

/**
 * The exact form of a token {@link newToken} makes: its bytes in base64url without padding, which is
 * 4 characters for every 3 bytes, rounded up (43 for 32 bytes). Anything else cannot be an endpoint's token.
 */
export const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((TOKEN_BYTES * 4) / 3)}}$`);

/** The part of an endpoint the receiver needs to check a delivery. */
type EndpointAuth = { id: string; format: SignatureFormat; secret: string | null };

type EndpointRow = {
  id: string;
  name: string;
  token: string;
  format: SignatureFormat;
  created_at: string;
  created_by: string;
  webhook_count: number;
  last_received_at: string | null;
};

/**
 * Builds the secret path segment of an endpoint's address.
 * @returns A random token that matches {@link TOKEN_PATTERN}.
 */
const newToken = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

/**
 * Turns a database row into what the admin API returns. The row's secret is never selected.
 * @param row - The endpoint with its webhook count.
 * @param origin - The address the request came to, such as `https://hooks.example.com`.
 * @returns The endpoint with its full receiving URL.
 */
const toEndpoint = (row: EndpointRow, origin: string): Endpoint => ({
  id: row.id,
  name: row.name,
  format: row.format,
  url: `${origin}/hooks/${row.token}`,
  createdAt: row.created_at,
  createdBy: row.created_by,
  webhookCount: row.webhook_count,
  lastReceivedAt: row.last_received_at,
});

/**
 * Builds the JSON validator that goes in front of endpoint creation. It checks the name, the format and
 * the secret, and passes on `{ name, format, secret }` with `secret` set to `null` for format `none`.
 * @returns Hono middleware; the handler reads the result with `c.req.valid('json')`.
 */
export const endpointValidator = validator('json', (body: Partial<CreateEndpointRequest> | null, c) => {
  const { name, format, secret }: Partial<CreateEndpointRequest> = body ?? {};
  if (typeof name !== 'string' || !ENDPOINT_NAME_PATTERN.test(name)) {
    return c.json({ error: 'Name must be 1 to 40 characters: lower-case letters, numbers and hyphens.' }, 400);
  }
  if (!SIGNATURE_FORMATS.includes(format as SignatureFormat)) {
    return c.json({ error: `Format must be one of: ${SIGNATURE_FORMATS.join(', ')}.` }, 400);
  }
  const checked = format as SignatureFormat;
  if (checked === 'none') {
    return { name, format: checked, secret: null };
  }
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmed) {
    return c.json({ error: 'A signing secret is required for this format.' }, 400);
  }
  if (trimmed.length > MAX_SECRET_LENGTH) {
    return c.json({ error: `The secret can be at most ${MAX_SECRET_LENGTH} characters.` }, 400);
  }
  if (checked === 'standard' && !standardKey(trimmed)) {
    return c.json({ error: 'A Standard Webhooks secret starts with whsec_ followed by base64 text.' }, 400);
  }
  return { name, format: checked, secret: trimmed };
});

/**
 * Creates an endpoint with a new random token.
 * @param db - The `DB` database.
 * @param input - Output of {@link endpointValidator}.
 * @param createdBy - Email of the admin creating it.
 * @param origin - The address the request came to, for the endpoint's URL.
 * @returns The new endpoint, or `null` when the name is already taken.
 */
export const createEndpoint = async (
  db: D1Database,
  input: { name: string; format: SignatureFormat; secret: string | null },
  createdBy: string,
  origin: string,
): Promise<Endpoint | null> => {
  const row: EndpointRow = {
    id: crypto.randomUUID(),
    name: input.name,
    token: newToken(),
    format: input.format,
    created_at: new Date().toISOString(),
    created_by: createdBy,
    webhook_count: 0,
    last_received_at: null,
  };
  const { meta } = await db
    .prepare(
      `INSERT INTO endpoints (id, name, token, format, secret, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (name) DO NOTHING`,
    )
    .bind(row.id, row.name, row.token, row.format, input.secret, row.created_at, row.created_by)
    .run();
  return meta.changes === 0 ? null : toEndpoint(row, origin);
};

/**
 * Lists every endpoint, newest first, with how many webhooks it holds and when the latest arrived.
 * @param db - The `DB` database.
 * @param origin - The address the request came to, for each endpoint's URL.
 * @returns All endpoints.
 */
export const listEndpoints = async (db: D1Database, origin: string): Promise<Endpoint[]> => {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.name, e.token, e.format, e.created_at, e.created_by,
              COUNT(w.id) AS webhook_count, MAX(w.last_received_at) AS last_received_at
       FROM endpoints e LEFT JOIN webhooks w ON w.endpoint_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC, e.id`,
    )
    .all<EndpointRow>();
  return results.map((row) => toEndpoint(row, origin));
};

/**
 * Deletes an endpoint; the database deletes its webhooks with it (`ON DELETE CASCADE`).
 * @param db - The `DB` database.
 * @param id - The endpoint's ID. Deleting one that does not exist does nothing.
 */
export const deleteEndpoint = async (db: D1Database, id: string): Promise<void> => {
  await db.prepare('DELETE FROM endpoints WHERE id = ?').bind(id).run();
};

/**
 * Finds the endpoint a token belongs to.
 * @param db - The `DB` database.
 * @param token - The `:token` from the receiving URL.
 * @returns What the receiver needs to check a delivery, or `null` for an unknown token.
 */
export const findEndpointByToken = (db: D1Database, token: string): Promise<EndpointAuth | null> =>
  db.prepare('SELECT id, format, secret FROM endpoints WHERE token = ?').bind(token).first<EndpointAuth>();
