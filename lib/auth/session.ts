import { getDb } from '@/lib/mongodb';

export interface SessionData {
  token: string;
  firmId: string;
  userId: string;
}

interface SessionDocument extends SessionData {
  _id: string;
  expiresAt: Date;
}

const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;

let sessionIndexPromise: Promise<string> | undefined;

async function sessions() {
  const db = await getDb();
  const collection = db.collection<SessionDocument>('sessions');
  sessionIndexPromise ??= collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await sessionIndexPromise;
  return collection;
}

function expirationDate(exp: number): Date {
  if (!Number.isInteger(exp) || exp - Math.floor(Date.now() / 1000) <= 0) {
    throw new Error('Envelope has expired.');
  }
  return new Date(exp * 1000);
}

function randomSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
}

export async function createSession(data: SessionData, exp: number): Promise<string> {
  const expiresAt = expirationDate(exp);
  const id = randomSessionId();
  const collection = await sessions();
  await collection.insertOne({
    _id: id,
    ...data,
    expiresAt,
  });
  return id;
}

/**
 * Renews only an existing, unexpired opaque session. The query deliberately
 * has no upsert so a caller cannot create a session at an arbitrary id.
 */
export async function renewSession(
  id: string,
  data: SessionData,
  exp: number,
): Promise<boolean> {
  if (!isValidSessionId(id)) return false;
  const expiresAt = expirationDate(exp);
  const collection = await sessions();
  const result = await collection.updateOne(
    { _id: id, expiresAt: { $gt: new Date() } },
    { $set: { ...data, expiresAt } },
  );
  return result.matchedCount > 0;
}

export async function getSession(id: string): Promise<SessionData | null> {
  if (!isValidSessionId(id)) return null;
  const collection = await sessions();
  // The TTL sweep is eventual, so correctness depends on this explicit expiry
  // predicate rather than on physical deletion of the document.
  const data = await collection.findOne({
    _id: id,
    expiresAt: { $gt: new Date() },
  });
  if (
    !data
    || typeof data.token !== 'string'
    || typeof data.firmId !== 'string'
    || typeof data.userId !== 'string'
    || !data.token
    || !data.firmId
    || !data.userId
  ) {
    return null;
  }
  return {
    token: data.token,
    firmId: data.firmId,
    userId: data.userId,
  };
}

export async function deleteSession(id: string): Promise<boolean> {
  if (!isValidSessionId(id)) return false;
  const collection = await sessions();
  return (await collection.deleteOne({ _id: id })).deletedCount > 0;
}
