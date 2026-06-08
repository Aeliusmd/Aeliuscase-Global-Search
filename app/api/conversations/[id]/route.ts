import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ConversationDoc } from '@/types/conversation';
import type { UIMessage } from 'ai';

type Params = { params: Promise<{ id: string }> };

// GET /api/conversations/[id] — fetch messages for one session
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const db = await getDb();
    const doc = await db.collection<ConversationDoc>('conversations').findOne({ _id: id });
    if (!doc) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: doc });
  } catch (err) {
    console.error('[GET /api/conversations/[id]]', err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

// PATCH /api/conversations/[id] — update title or messages (or both)
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { title?: string; preview?: string; messages?: UIMessage[] };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) { set.title = body.title; set.preview = body.preview ?? body.title; }
    if (body.messages !== undefined) set.messages = body.messages.slice(-100);

    const db = await getDb();
    const result = await db
      .collection<ConversationDoc>('conversations')
      .updateOne({ _id: id }, { $set: set });

    if (result.matchedCount === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/conversations/[id]]', err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

// DELETE /api/conversations/[id] — remove session entirely
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const db = await getDb();
    await db.collection<ConversationDoc>('conversations').deleteOne({ _id: id });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/conversations/[id]]', err);
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
