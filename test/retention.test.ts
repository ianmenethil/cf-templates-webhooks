import { env } from 'cloudflare:workers';
import { createScheduledController } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker/index';
import { serveAccessKeys } from './helpers/access';
import { createTestEndpoint, seedWebhooks, storedWebhooks } from './helpers/hooks';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Builds an ISO time some days ago.
 * @param days - How many days back.
 * @returns The time as the Worker writes it.
 */
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

/**
 * Runs the daily clean-up the way the Cron Trigger does.
 * @param vars - Settings that replace the test environment's.
 */
const runScheduled = (vars: Partial<CloudflareBindings> = {}): Promise<void> =>
  worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), { ...env, ...vars });

beforeEach(serveAccessKeys);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('daily clean-up', () => {
  it('has the 30 day default from wrangler.jsonc in its settings', () => {
    expect(env.RETENTION_DAYS).toBe('30');
  });

  it('fails the run when the purge fails, so the cron run is marked failed', async () => {
    const failing = {
      prepare: () => {
        throw new Error('D1 is down');
      },
    } as unknown as D1Database;
    await expect(runScheduled({ DB: failing })).rejects.toThrow('D1 is down');
  });

  it('deletes webhooks whose latest delivery is older than RETENTION_DAYS and keeps the rest', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [
      { id: 'expired', receivedAt: daysAgo(31) },
      { id: 'recent', receivedAt: daysAgo(29) },
      { id: 'fresh', receivedAt: daysAgo(0) },
    ]);
    await runScheduled();
    expect((await storedWebhooks(endpoint.id)).map((row) => row.id).sort()).toEqual(['fresh', 'recent']);
  });

  it('keeps an old webhook whose event was delivered again recently', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [{ id: 'retried', receivedAt: daysAgo(60), lastReceivedAt: daysAgo(1) }]);
    await runScheduled();
    expect(await storedWebhooks(endpoint.id)).toHaveLength(1);
  });

  it('uses RETENTION_DAYS from the settings', async () => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(endpoint.id, [
      { id: 'ten-days', receivedAt: daysAgo(10) },
      { id: 'two-days', receivedAt: daysAgo(2) },
    ]);
    await runScheduled({ RETENTION_DAYS: '7' });
    expect((await storedWebhooks(endpoint.id)).map((row) => row.id)).toEqual(['two-days']);
  });

  it.each(['abc', '0', '-5', '', '1.5'])('falls back to 30 days when RETENTION_DAYS is "%s", never deleting everything', async (value) => {
    const endpoint = await createTestEndpoint({ format: 'none' });
    // IDs are unique across the whole database, and every case seeds its own rows.
    await seedWebhooks(endpoint.id, [
      { id: `${endpoint.id}-forty`, receivedAt: daysAgo(40) },
      { id: `${endpoint.id}-twenty`, receivedAt: daysAgo(20) },
      { id: `${endpoint.id}-fresh`, receivedAt: daysAgo(0) },
    ]);
    await runScheduled({ RETENTION_DAYS: value });
    expect((await storedWebhooks(endpoint.id)).map((row) => row.id).sort()).toEqual([
      `${endpoint.id}-fresh`,
      `${endpoint.id}-twenty`,
    ]);
  });

  it('deletes expired webhooks of every endpoint and keeps the endpoints', async () => {
    const first = await createTestEndpoint({ format: 'none' });
    const second = await createTestEndpoint({ format: 'none' });
    await seedWebhooks(first.id, [{ receivedAt: daysAgo(45) }]);
    await seedWebhooks(second.id, [{ receivedAt: daysAgo(45) }]);
    await runScheduled();
    expect(await storedWebhooks(first.id)).toHaveLength(0);
    expect(await storedWebhooks(second.id)).toHaveLength(0);
    const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM endpoints WHERE id IN (?, ?)').bind(first.id, second.id).first<{ n: number }>();
    expect(kept?.n).toBe(2);
  });
});
