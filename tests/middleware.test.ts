import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const middlewareMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  limitChatRequest: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: middlewareMocks.getSession,
}));

vi.mock('@/lib/rateLimit', () => ({
  limitChatRequest: middlewareMocks.limitChatRequest,
}));

import { middleware } from '@/middleware';

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    middlewareMocks.getSession.mockResolvedValue({
      token: 'verified-token',
      firmId: 'verified-firm',
      userId: 'verified-user',
    });
    middlewareMocks.limitChatRequest.mockResolvedValue({
      success: true,
      retryAfter: 0,
    });
  });

  it('returns 401 when the opaque session header is missing', async () => {
    const response = await middleware(new NextRequest('http://localhost/api/chat'));
    expect(response.status).toBe(401);
    expect(middlewareMocks.getSession).not.toHaveBeenCalled();
  });

  it('returns 401 when the opaque session is unknown or expired', async () => {
    middlewareMocks.getSession.mockResolvedValueOnce(null);
    const response = await middleware(new NextRequest('http://localhost/api/cases/search', {
      headers: { 'X-Session-Id': 'd'.repeat(64) },
    }));

    expect(response.status).toBe(401);
    expect(middlewareMocks.limitChatRequest).not.toHaveBeenCalled();
  });

  it('overwrites spoofed client identity with the verified session identity', async () => {
    const response = await middleware(new NextRequest('http://localhost/api/chat', {
      headers: {
        'X-Session-Id': 'a'.repeat(64),
        'x-user-id': 'attacker',
        'x-aelius-user-id': 'attacker',
        'x-aelius-firm-id': 'attacker',
        'x-aelius-api-token': 'attacker',
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-user-id')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-aelius-user-id')).toBe('verified-user');
    expect(response.headers.get('x-middleware-request-x-aelius-firm-id')).toBe('verified-firm');
    expect(response.headers.get('x-middleware-request-x-aelius-api-token')).toBe('verified-token');
  });

  it('returns 429 with Retry-After when either chat budget is exhausted', async () => {
    middlewareMocks.limitChatRequest.mockResolvedValue({
      success: false,
      retryAfter: 17,
    });
    const response = await middleware(new NextRequest('http://localhost/api/chat/title', {
      headers: { 'X-Session-Id': 'a'.repeat(64) },
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
  });
});
