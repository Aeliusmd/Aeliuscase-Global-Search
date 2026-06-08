import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI ?? '';
const DB_NAME = process.env.MONGODB_DB ?? 'aeliuscase';

if (!uri) {
  throw new Error('MONGODB_URI is not set in .env.local');
}

// In development, reuse the connection across hot-reloads to avoid exhausting
// the Atlas connection pool. In production each serverless instance gets one.
declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

let client: MongoClient;

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri);
  }
  client = global._mongoClient;
} else {
  client = new MongoClient(uri);
}

export async function getDb(): Promise<Db> {
  await client.connect();
  return client.db(DB_NAME);
}
