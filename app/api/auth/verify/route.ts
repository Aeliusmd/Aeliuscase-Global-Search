import { EnvelopeVerificationError, verifyEnvelope } from '@/lib/auth/envelope';
import {
  createSession,
  deleteSession,
  isValidSessionId,
  renewSession,
} from '@/lib/auth/session';
import { isAllowedOrigin } from '@/lib/auth/origins';

export const runtime = 'nodejs';

const MAX_ENVELOPE_LENGTH = 20_000;

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'false',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  return origin && isAllowedOrigin(origin) ? origin : null;
}

function json(
  origin: string,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

export function OPTIONS(req: Request): Response {
  const origin = allowedOrigin(req);
  if (!origin) return Response.json({ success: false, error: 'Origin not allowed.' }, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request): Promise<Response> {
  const origin = allowedOrigin(req);
  if (!origin) {
    return Response.json({ success: false, error: 'Origin not allowed.' }, { status: 403 });
  }

  let body: { envelope?: unknown; sessionId?: unknown };
  try {
    body = (await req.json()) as { envelope?: unknown; sessionId?: unknown };
  } catch {
    return json(origin, { success: false, error: 'Invalid JSON body.' }, 400);
  }

  if (
    typeof body.envelope !== 'string' ||
    body.envelope.length === 0 ||
    body.envelope.length > MAX_ENVELOPE_LENGTH
  ) {
    return json(origin, { success: false, error: 'A valid envelope is required.' }, 400);
  }
  if (body.sessionId !== undefined && !isValidSessionId(body.sessionId)) {
    return json(origin, { success: false, error: 'Invalid session id.' }, 400);
  }

  try {
    const verified = await verifyEnvelope(body.envelope);
    const sessionData = {
      token: verified.token,
      firmId: verified.firmId,
      userId: verified.userId,
    };

    let sessionId: string;
    if (body.sessionId) {
      const renewed = await renewSession(body.sessionId, sessionData, verified.exp);
      if (!renewed) {
        return json(origin, { success: false, error: 'Session not found or expired.' }, 401);
      }
      sessionId = body.sessionId;
    } else {
      sessionId = await createSession(sessionData, verified.exp);
    }

    return json(origin, {
      success: true,
      sessionId,
      expiresAt: verified.exp,
    });
  } catch (error) {
    if (error instanceof EnvelopeVerificationError) {
      return json(origin, { success: false, error: 'Invalid or expired envelope.' }, 401);
    }
    console.error('[/api/auth/verify] Authentication service unavailable.');
    return json(origin, { success: false, error: 'Authentication service unavailable.' }, 500);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const origin = allowedOrigin(req);
  if (!origin) {
    return Response.json({ success: false, error: 'Origin not allowed.' }, { status: 403 });
  }

  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!isValidSessionId(sessionId)) {
    return json(origin, { success: false, error: 'Invalid session id.' }, 400);
  }

  try {
    await deleteSession(sessionId);
    return json(origin, { success: true });
  } catch {
    console.error('[/api/auth/verify] Logout service unavailable.');
    return json(origin, { success: false, error: 'Authentication service unavailable.' }, 500);
  }
}
