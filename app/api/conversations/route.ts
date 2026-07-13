import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ConversationDoc } from '@/types/conversation';

// GET /api/conversations — list all sessions (newest first, no messages)
export async function GET() {
  try {
    const db = await getDb();
    const docs = await db
      .collection<ConversationDoc>('conversations')
      .find({}, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ success: true, data: docs });
  } catch (err) {
    console.error('[GET /api/conversations]', err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

// POST /api/conversations — create a new session
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id: string; title: string; preview?: string };
    if (!body.id || !body.title) {
      return NextResponse.json({ success: false, error: 'id and title required' }, { status: 400 });
    }

    const now = new Date();
    const doc: ConversationDoc = {
      _id: body.id,
      title: body.title,
      preview: body.preview ?? body.title,
      pinned: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDb();
    await db.collection<ConversationDoc>('conversations').insertOne(doc);
    return NextResponse.json({ success: true, data: doc }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/conversations]', err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
