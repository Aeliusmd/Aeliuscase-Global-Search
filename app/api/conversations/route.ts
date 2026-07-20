import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ConversationDoc } from '@/types/conversation';
import { getRequestAuth } from '@/lib/auth/request';

let conversationIndexPromise: Promise<unknown> | undefined;

async function conversations() {
  const db = await getDb();
  const collection = db.collection<ConversationDoc>('conversations');
  conversationIndexPromise ??= collection.createIndex({ userId: 1, updatedAt: -1 });
  await conversationIndexPromise;
  return collection;
}

// List the authenticated user's conversations, newest first, without messages.
export async function GET(req: Request) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const collection = await conversations();
    const docs = await collection
      .find({ userId: auth.userId }, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ success: true, data: docs });
  } catch {
    console.error('[GET /api/conversations] Database operation failed.');
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { id: string; title: string; preview?: string };
    if (!body.id || !body.title) {
      return NextResponse.json({ success: false, error: 'id and title required' }, { status: 400 });
    }

    const now = new Date();
    const doc: ConversationDoc = {
      _id: body.id,
      userId: auth.userId,
      title: body.title,
      preview: body.preview ?? body.title,
      pinned: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const collection = await conversations();
    await collection.insertOne(doc);
    return NextResponse.json({ success: true, data: doc }, { status: 201 });
  } catch {
    console.error('[POST /api/conversations] Database operation failed.');
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
