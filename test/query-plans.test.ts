import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveAccessKeys } from './helpers/access';
import { adminApi } from './helpers/admin';
import { createTestEndpoint, seedWebhooks } from './helpers/hooks';

/** One row of `EXPLAIN QUERY PLAN`. */
type PlanStep = { detail: string };

/**
 * Runs the admin API call and returns the SQL statements the Worker prepared for it.
 * @param path - Path below `/admin/api`.
 * @returns The statements, in the order they were prepared.
 */
const sqlOf = async (path: string): Promise<string[]> => {
  const statements: string[] = [];
  const prepare = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
    statements.push(sql);
    return prepare(sql);
  });
  expect((await adminApi(path)).status).toBe(200);
  vi.restoreAllMocks();
  return statements;
};

/**
 * Reads how SQLite runs a statement.
 * @param sql - The statement the Worker prepared.
 * @param values - Values for its `?` placeholders.
 * @returns The plan's steps as text.
 */
const planOf = async (sql: string, values: string[] = []): Promise<string[]> => {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<PlanStep>();
  return results.map((step) => step.detail);
};

beforeEach(serveAccessKeys);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('query plans', () => {
  it('lists the webhooks of all endpoints from the index, with no sorting step', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [{ receivedAt: '2026-05-01T00:00:00.000Z' }]);
    const [sql] = await sqlOf('/webhooks');
    const plan = await planOf(sql!);
    expect(plan.some((step) => step.includes('webhooks_received'))).toBe(true);
    expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false);
  });

  // The endpoint list sorts the endpoints themselves (one row each) in a temporary tree; what must not happen
  // is a pass over the webhooks table to count them and find the latest delivery.
  it('lists the endpoints reading each one’s webhooks from an index, never scanning the webhooks table', async () => {
    await createTestEndpoint({ format: 'none' });
    const [sql] = await sqlOf('/endpoints');
    const plan = await planOf(sql!);
    expect(plan.some((step) => step.includes('SEARCH w USING INDEX webhooks_endpoint_last_received (endpoint_id=?)'))).toBe(true);
    expect(plan.some((step) => step.startsWith('SCAN w'))).toBe(false);
  });
});
