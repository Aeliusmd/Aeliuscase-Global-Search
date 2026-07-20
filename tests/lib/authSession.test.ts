// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryDb } from '@/tests/helpers/inMemoryMongo';

const mongoMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: mongoMocks.getDb,
}));

import {
  createSession,
  deleteSession,
  getSession,
  renewSession,
} from '@/lib/auth/session';

interface StoredSession {
  _id: string;
  token: string;
  firmId: string;
  userId: string;
  expiresAt: Date;
  [key: string]: unknown;
}

const db = new InMemoryDb();

describe('MongoDB session store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clear();
    mongoMocks.getDb.mockResolvedValue(db);
  });

  it('creates and reads a 32-byte opaque session with an absolute expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const data = { token: 'upstream-token', firmId: 'firm-1', userId: 'user-1' };
    const id = await createSession(data, exp);

    expect(id).toMatch(/^[a-f0-9]{64}$/);
    await expect(getSession(id)).resolves.toEqual(data);

    const stored = db.collection<StoredSession>('sessions').documents.get(id);
    expect(stored?.expiresAt).toEqual(new Date(exp * 1000));
    expect(db.collection<StoredSession>('sessions').indexes[0]).toEqual({
      keys: { expiresAt: 1 },
      options: { expireAfterSeconds: 0 },
    });
  });

  it('renews an existing session in place without changing its id', async () => {
    const id = await createSession(
      { token: 'old-token', firmId: 'firm-1', userId: 'user-1' },
      Math.floor(Date.now() / 1000) + 600,
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;

    await expect(renewSession(
      id,
      { token: 'fresh-token', firmId: 'firm-1', userId: 'user-1' },
      exp,
    )).resolves.toBe(true);

    expect(db.collection<StoredSession>('sessions').documents.size).toBe(1);
    await expect(getSession(id)).resolves.toEqual({
      token: 'fresh-token',
      firmId: 'firm-1',
      userId: 'user-1',
    });
    expect(
      db.collection<StoredSession>('sessions').documents.get(id)?.expiresAt,
    ).toEqual(new Date(exp * 1000));
  });

  it('does not create a session when renewing a nonexistent or expired id', async () => {
    const collection = db.collection<StoredSession>('sessions');
    const nonexistentId = 'a'.repeat(64);
    await expect(renewSession(
      nonexistentId,
      { token: 'token', firmId: 'firm-1', userId: 'user-1' },
      Math.floor(Date.now() / 1000) + 3600,
    )).resolves.toBe(false);
    expect(collection.documents.has(nonexistentId)).toBe(false);

    const expiredId = 'b'.repeat(64);
    collection.documents.set(expiredId, {
      _id: expiredId,
      token: 'expired-token',
      firmId: 'firm-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(renewSession(
      expiredId,
      { token: 'attacker-replacement', firmId: 'firm-2', userId: 'user-2' },
      Math.floor(Date.now() / 1000) + 3600,
    )).resolves.toBe(false);
    expect(collection.documents.get(expiredId)?.token).toBe('expired-token');
  });

  it('returns null for an expired document before the TTL sweep removes it', async () => {
    const id = 'c'.repeat(64);
    db.collection<StoredSession>('sessions').documents.set(id, {
      _id: id,
      token: 'expired-token',
      firmId: 'firm-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(getSession(id)).resolves.toBeNull();
    expect(db.collection<StoredSession>('sessions').documents.has(id)).toBe(true);
  });

  it('rejects malformed documents and supports explicit deletion', async () => {
    const id = 'd'.repeat(64);
    db.collection<StoredSession>('sessions').documents.set(id, {
      _id: id,
      token: '',
      firmId: 'firm-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(getSession(id)).resolves.toBeNull();
    await expect(deleteSession(id)).resolves.toBe(true);
    await expect(deleteSession(id)).resolves.toBe(false);
  });

  it('rejects a non-integer or already-expired envelope expiry', async () => {
    const data = { token: 'token', firmId: 'firm-1', userId: 'user-1' };
    await expect(createSession(data, Date.now() / 1000 + 3600)).rejects.toThrow(
      'Envelope has expired.',
    );
    await expect(
      createSession(data, Math.floor(Date.now() / 1000) - 1),
    ).rejects.toThrow('Envelope has expired.');
  });
});
