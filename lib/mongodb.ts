import { MongoClient, type Db } from 'mongodb';

const DB_NAME = process.env.MONGODB_DB ?? 'aeliuscase';

// Cache the *connecting* client on globalThis so it is reused across hot-reloads
// in development AND across warm serverless invocations in production — the
// recommended Vercel/MongoDB pattern. This avoids opening a fresh connection per
// invocation and exhausting the Atlas connection pool.
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function clientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Lazy check: thrown at call time (inside getDb) so the route handler's
    // try/catch returns a clean 500 — instead of throwing at module import,
    // which would crash the route and can fail the production build.
    throw new Error('MONGODB_URI is not set');
  }
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = new MongoClient(uri).connect().catch((err) => {
      // Don't cache a rejected promise — allow the next call to retry.
      global._mongoClientPromise = undefined;
      throw err;
    });
  }
  return global._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
  return client.db(DB_NAME);
}
