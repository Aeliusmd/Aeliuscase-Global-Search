import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import {
  AUTH_FIRM_HEADER,
  AUTH_IP_HEADER,
  AUTH_TOKEN_HEADER,
  AUTH_USER_HEADER,
  CLIENT_IDENTITY_HEADERS,
} from '@/lib/auth/request';
import { limitChatRequest } from '@/lib/rateLimit';

function unauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Authentication required or session expired.' },
    { status: 401 },
  );
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function isRateLimitedPath(pathname: string): boolean {
  return pathname === '/api/chat' || pathname === '/api/chat/title';
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.headers.get('x-session-id');
  if (!sessionId) return unauthorized();

  try {
    const session = await getSession(sessionId);
    if (!session) return unauthorized();

    const ip = clientIp(req);
    if (isRateLimitedPath(req.nextUrl.pathname)) {
      const rateLimit = await limitChatRequest(session.userId, ip);
      if (!rateLimit.success) {
        return NextResponse.json(
          { success: false, error: 'Rate limit exceeded.' },
          {
            status: 429,
            headers: { 'Retry-After': String(rateLimit.retryAfter) },
          },
        );
      }
    }

    const headers = new Headers(req.headers);
    for (const header of CLIENT_IDENTITY_HEADERS) headers.delete(header);
    headers.set(AUTH_USER_HEADER, session.userId);
    headers.set(AUTH_FIRM_HEADER, session.firmId);
    headers.set(AUTH_TOKEN_HEADER, session.token);
    headers.set(AUTH_IP_HEADER, ip);

    return NextResponse.next({ request: { headers } });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication service unavailable.' },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: [
    '/api/chat',
    '/api/chat/title',
    '/api/cases/:path*',
    '/api/conversations/:path*',
  ],
};
