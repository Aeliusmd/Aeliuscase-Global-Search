import { getDb } from '@/lib/mongodb';

interface LimitResult {
  success: boolean;
  retryAfter: number;
}

interface RateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

interface CounterResult {
  success: boolean;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const CLEANUP_BUFFER_MS = 60_000;

let rateLimitIndexPromise: Promise<string> | undefined;

function perMinuteLimit(): number {
  const parsed = Number(process.env.RATE_LIMIT_PER_MIN ?? '20');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}

async function rateLimits() {
  const db = await getDb();
  const collection = db.collection<RateLimitDocument>('rateLimits');
  rateLimitIndexPromise ??= collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await rateLimitIndexPromise;
  return collection;
}

async function checkOne(
  type: 'user' | 'ip',
  key: string,
  limit: number,
  windowStart: number,
): Promise<CounterResult> {
  const collection = await rateLimits();
  const windowEndsAt = windowStart + WINDOW_MS;
  const result = await collection.findOneAndUpdate(
    { _id: `${type}:${key}:${windowStart}` },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        expiresAt: new Date(windowEndsAt + CLEANUP_BUFFER_MS),
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (!result) {
    throw new Error('Rate-limit counter update failed.');
  }
  return {
    success: result.count <= limit,
    resetAt: windowEndsAt,
  };
}

/**
 * A request is allowed only when both the per-user and per-IP budgets allow it.
 */
export async function limitChatRequest(userId: string, ip: string): Promise<LimitResult> {
  const limit = perMinuteLimit();
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const [userResult, ipResult] = await Promise.all([
    checkOne('user', userId, limit, windowStart),
    checkOne('ip', ip, limit, windowStart),
  ]);

  const success = userResult.success && ipResult.success;
  const reset = Math.max(userResult.resetAt, ipResult.resetAt);
  return {
    success,
    retryAfter: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}
