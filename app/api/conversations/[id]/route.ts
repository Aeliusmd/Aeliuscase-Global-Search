import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ConversationDoc } from '@/types/conversation';
import type { UIMessage } from 'ai';
import { getRequestAuth } from '@/lib/auth/request';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const db = await getDb();
    const doc = await db
      .collection<ConversationDoc>('conversations')
      .findOne({ _id: id, userId: auth.userId });
    if (!doc) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: doc });
  } catch {
    console.error('[GET /api/conversations/[id]] Database operation failed.');
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await req.json()) as { title?: string; preview?: string; messages?: UIMessage[] };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) {
      set.title = body.title;
      set.preview = body.preview ?? body.title;
    }
    if (body.messages !== undefined) set.messages = body.messages.slice(-100);

    const db = await getDb();
    const result = await db
      .collection<ConversationDoc>('conversations')
      .updateOne({ _id: id, userId: auth.userId }, { $set: set });

    if (result.matchedCount === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    console.error('[PATCH /api/conversations/[id]] Database operation failed.');
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const db = await getDb();
    const result = await db
      .collection<ConversationDoc>('conversations')
      .deleteOne({ _id: id, userId: auth.userId });
    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    console.error('[DELETE /api/conversations/[id]] Database operation failed.');
    return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 });
  }
}
