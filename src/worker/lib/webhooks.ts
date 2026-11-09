import type { SignatureFormat, WebhookDetail, WebhookList, WebhookSummary } from '../../shared/types';

/** Longest event ID stored; senders use IDs of a few dozen characters. */
const MAX_EVENT_ID_LENGTH = 255;

/** Webhooks per page of `GET /admin/api/webhooks`. */
const PAGE_SIZE = 50;

/** Longest search text accepted. */
const MAX_SEARCH_LENGTH = 100;

/** Days a webhook is kept when `RETENTION_DAYS` is not a positive whole number. */
const DEFAULT_RETENTION_DAYS = 30;

/** Request headers whose values are replaced with `[redacted]` before storing, as they hold credentials. */
const REDACTED_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/** Any other header whose name says it carries a credential, such as `x-api-key` or `x-gitlab-token`. */
const SECRET_HEADER_PATTERN = /token|secret|api[-_]?key|password/i;

/** Columns of a webhook list row; a webhook is always read together with its endpoint's name. */
const SUMMARY_COLUMNS = `w.id, w.endpoint_id, e.name AS endpoint_name, w.event_id, w.received_at,
  w.last_received_at, w.deliveries, w.content_type, w.size, w.verified`;

type SummaryRow = {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  event_id: string | null;
  received_at: string;
  last_received_at: string;
  deliveries: number;
  content_type: string | null;
  size: number;
  verified: number;
};

type DetailRow = SummaryRow & { headers: string; body: string };

/** Where the next page of a list starts: after this webhook in newest-first order. */
type Cursor = { receivedAt: string; id: string };

/** What the receiver hands over to be stored. */
type NewWebhook = {
  endpointId: string;
  eventId: string | null;
  contentType: string | null;
  size: number;
  verified: boolean;
  headers: Headers;
  body: string;
};

/** Filters of the webhook list. */
type WebhookFilter ={ endpoint?: string; q?: string; before?: Cursor };

/**
 * Shortens an ID so a hostile sender cannot fill the table with enormous values.
 * @param value - The ID text, if there is one.
 * @returns The ID, or `null` when there is none.
 */
const cleanId = (value: string | null | undefined): string | null => (value ? value.slice(0, MAX_EVENT_ID_LENGTH) : null);

/**
 * Finds the ID the sender gave this event, which is how a retry of it is recognised.
 * Standard Webhooks (and format `none`, when the sender uses it) send `webhook-id`; Stripe's is the
 * `id` of the event in the JSON body (`evt_...`); GitHub sends `X-GitHub-Delivery`.
 * @param format - The endpoint's signature format.
 * @param headers - The request headers.
 * @param body - The body exactly as received.
 * @returns The event ID, or `null` when the request carries none.
 */
export const eventIdOf = (format: SignatureFormat, headers: Headers, body: string): string | null => {
  switch (format) {
    case 'stripe': {
      try {
        const event: unknown = JSON.parse(body);
        return typeof event === 'object' && event !== null && 'id' in event && typeof event.id === 'string'
          ? cleanId(event.id)
          : null;
      } catch {
        return null;
      }
    }
    case 'github':
      return cleanId(headers.get('x-github-delivery'));
    default:
      return cleanId(headers.get('webhook-id'));
  }
};

/**
 * Writes request headers as JSON with lower-case names, hiding the values that may hold credentials.
 * @param headers - The request headers.
 * @returns A JSON object of header names and values.
 */
const headersToJson = (headers: Headers): string =>
  JSON.stringify(
    Object.fromEntries(
      Array.from(headers, ([name, value]) => [
        name,
        REDACTED_HEADERS.has(name) || SECRET_HEADER_PATTERN.test(name) ? '[redacted]' : value,
      ]),
    ),
  );

/**
 * Stores a delivery, or counts it when the sender already delivered the same event to this endpoint.
 * One statement does both: a delivery with an event ID the endpoint already holds hits the unique
 * index on `(endpoint_id, event_id)` and adds 1 to `deliveries` instead of inserting a row, so two
 * deliveries that arrive at the same moment still produce one row. Deliveries without an event ID
 * never conflict and are always stored.
 * @param db - The `DB` database.
 * @param webhook - The delivery to store.
 * @returns `duplicate` is `true` when the event was already stored.
 */
export const storeWebhook = async (db: D1Database, webhook: NewWebhook): Promise<{ duplicate: boolean }> => {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO webhooks (id, endpoint_id, event_id, received_at, last_received_at, content_type, size, verified, headers, body)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (endpoint_id, event_id) DO UPDATE SET
         deliveries = deliveries + 1,
         last_received_at = excluded.last_received_at
       RETURNING deliveries`,
    )
    .bind(
      crypto.randomUUID(),
      webhook.endpointId,
      webhook.eventId,
      now,
      webhook.contentType,
      webhook.size,
      webhook.verified ? 1 : 0,
      headersToJson(webhook.headers),
      webhook.body,
    )
    .first<{ deliveries: number }>();
  return { duplicate: (row?.deliveries ?? 1) > 1 };
};

/**
 * Turns a database row into what the admin API returns.
 * @param row - A webhook row joined with its endpoint's name.
 * @returns The webhook without headers and body.
 */
const toSummary = (row: SummaryRow): WebhookSummary => ({
  id: row.id,
  endpointId: row.endpoint_id,
  endpointName: row.endpoint_name,
  eventId: row.event_id,
  receivedAt: row.received_at,
  lastReceivedAt: row.last_received_at,
  deliveries: row.deliveries,
  contentType: row.content_type,
  size: row.size,
  verified: row.verified === 1,
});

/**
 * Reads a `before` value from a request.
 * @param value - The `nextBefore` of an earlier answer.
 * @returns The position it stands for, or `null` when it is not one.
 */
export const parseCursor = (value: string): Cursor | null => {
  const [receivedAt, id, ...rest] = value.split('_');
  return receivedAt && id && rest.length === 0 ? { receivedAt, id } : null;
};

/**
 * Lists webhooks newest first, a page at a time.
 * @param db - The `DB` database.
 * @param filter - Limit to one endpoint, to event IDs or bodies containing `q`, or to those after a cursor.
 * @returns One page, and the cursor of the next one or `null` when this was the last.
 */
export const listWebhooks = async (db: D1Database, filter: WebhookFilter): Promise<WebhookList> => {
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.endpoint) {
    where.push('w.endpoint_id = ?');
    values.push(filter.endpoint);
  }
  if (filter.q) {
    // `instr` finds the text itself, with no wildcards to escape, and D1 does not limit its argument as it
    // limits a `LIKE` pattern (50 bytes). `lower` makes it ignore case for ASCII letters, as `LIKE` does.
    const text = filter.q.slice(0, MAX_SEARCH_LENGTH);
    where.push('(instr(lower(w.event_id), lower(?)) > 0 OR instr(lower(w.body), lower(?)) > 0)');
    values.push(text, text);
  }
  if (filter.before) {
    where.push('(w.received_at < ? OR (w.received_at = ? AND w.id < ?))');
    values.push(filter.before.receivedAt, filter.before.receivedAt, filter.before.id);
  }
  // One row more than a page tells whether another page exists.
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}
       FROM webhooks w JOIN endpoints e ON e.id = w.endpoint_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY w.received_at DESC, w.id DESC
       LIMIT ${PAGE_SIZE + 1}`,
    )
    .bind(...values)
    .all<SummaryRow>();
  const page = results.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    webhooks: page.map(toSummary),
    nextBefore: results.length > PAGE_SIZE && last ? `${last.received_at}_${last.id}` : null,
  };
};

/**
 * Reads one webhook with its headers and body.
 * @param db - The `DB` database.
 * @param id - The webhook's ID.
 * @returns The webhook, or `null` when there is none with that ID.
 */
export const getWebhook = async (db: D1Database, id: string): Promise<WebhookDetail | null> => {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, w.headers, w.body
       FROM webhooks w JOIN endpoints e ON e.id = w.endpoint_id
       WHERE w.id = ?`,
    )
    .bind(id)
    .first<DetailRow>();
  return row ? { ...toSummary(row), headers: JSON.parse(row.headers) as Record<string, string>, body: row.body } : null;
};

/**
 * Deletes one webhook.
 * @param db - The `DB` database.
 * @param id - The webhook's ID. Deleting one that does not exist does nothing.
 */
export const deleteWebhook = async (db: D1Database, id: string): Promise<void> => {
  await db.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run();
};

/**
 * Deletes webhooks whose latest delivery is older than the retention period.
 * @param db - The `DB` database.
 * @param retentionDays - The `RETENTION_DAYS` variable; anything but a positive whole number means 30,
 * so a typo cannot delete everything.
 * @returns How many webhooks were deleted.
 */
export const purgeOldWebhooks = async (db: D1Database, retentionDays: string): Promise<number> => {
  const days = Number(retentionDays);
  const keepDays = Number.isInteger(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const { meta } = await db.prepare('DELETE FROM webhooks WHERE last_received_at < ?').bind(cutoff).run();
  return meta.changes;
};
