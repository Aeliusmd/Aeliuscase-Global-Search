// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDb } from '@/tests/helpers/inMemoryMongo';

const mongoMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: mongoMocks.getDb,
}));

import { limitChatRequest } from '@/lib/rateLimit';

interface StoredRateLimit {
  _id: string;
  count: number;
  expiresAt: Date;
  [key: string]: unknown;
}

const db = new InMemoryDb();

describe('MongoDB chat rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:30.000Z'));
    vi.clearAllMocks();
    db.clear();
    mongoMocks.getDb.mockResolvedValue(db);
    process.env.RATE_LIMIT_PER_MIN = '2';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.RATE_LIMIT_PER_MIN;
  });

  it('blocks requests over the fixed-window limit with a sane retryAfter', async () => {
    await expect(limitChatRequest('user-a', '10.0.0.1')).resolves.toEqual({
      success: true,
      retryAfter: 0,
    });
    await expect(limitChatRequest('user-a', '10.0.0.1')).resolves.toEqual({
      success: true,
      retryAfter: 0,
    });
    const blocked = await limitChatRequest('user-a', '10.0.0.1');

    expect(blocked.success).toBe(false);
    expect(blocked.retryAfter).toBe(30);
    const records = [...db.collection<StoredRateLimit>('rateLimits').documents.values()];
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.count === 3)).toBe(true);
    expect(records.every(
      (record) => record.expiresAt.toISOString() === '2026-07-20T12:02:00.000Z',
    )).toBe(true);
    expect(db.collection<StoredRateLimit>('rateLimits').indexes[0]).toEqual({
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    });
  });

  it('keeps different users in separate counters', async () => {
    await limitChatRequest('user-a', '10.0.0.1');
    await limitChatRequest('user-a', '10.0.0.1');
    await expect(limitChatRequest('user-a', '10.0.0.1')).resolves.toMatchObject({
      success: false,
    });

    await expect(limitChatRequest('user-b', '10.0.0.2')).resolves.toEqual({
      success: true,
      retryAfter: 0,
    });

    const ids = [...db.collection<StoredRateLimit>('rateLimits').documents.keys()];
    expect(ids.some((id) => id.startsWith('user:user-a:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('user:user-b:'))).toBe(true);
  });

  it('uses atomic increments for concurrent requests in the same window', async () => {
    const results = await Promise.all([
      limitChatRequest('user-a', '10.0.0.1'),
      limitChatRequest('user-a', '10.0.0.1'),
      limitChatRequest('user-a', '10.0.0.1'),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(2);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
  });
});
