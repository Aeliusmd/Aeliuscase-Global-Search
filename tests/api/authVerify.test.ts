import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  verifyEnvelope: vi.fn(),
  createSession: vi.fn(),
  renewSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/lib/auth/envelope', () => ({
  EnvelopeVerificationError: class EnvelopeVerificationError extends Error {},
  verifyEnvelope: authMocks.verifyEnvelope,
}));

vi.mock('@/lib/auth/session', () => ({
  createSession: authMocks.createSession,
  renewSession: authMocks.renewSession,
  deleteSession: authMocks.deleteSession,
  isValidSessionId: (value: unknown) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
}));

vi.mock('@/lib/auth/origins', () => ({
  isAllowedOrigin: (origin: string) => origin === 'https://uat.aeliuscase.com',
}));

import { OPTIONS, POST } from '@/app/api/auth/verify/route';

const sessionId = 'a'.repeat(64);
const allowedOrigin = 'https://uat.aeliuscase.com';

function request(body: unknown, origin = allowedOrigin) {
  return new Request('http://localhost/api/auth/verify', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.verifyEnvelope.mockResolvedValue({
      token: 'upstream-secret-token',
      firmId: 'firm-1',
      userId: 'user-1',
      exp: 2_000_000_000,
    });
    authMocks.createSession.mockResolvedValue(sessionId);
    authMocks.renewSession.mockResolvedValue(true);
  });

  it('creates an opaque session without returning the upstream token', async () => {
    const response = await POST(request({ envelope: 'signed-envelope' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(body).toEqual({
      success: true,
      sessionId,
      expiresAt: 2_000_000_000,
    });
    expect(JSON.stringify(body)).not.toContain('upstream-secret-token');
  });

  it('renews an existing session in place', async () => {
    const response = await POST(request({
      envelope: 'fresh-signed-envelope',
      sessionId,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(authMocks.renewSession).toHaveBeenCalledWith(
      sessionId,
      {
        token: 'upstream-secret-token',
        firmId: 'firm-1',
        userId: 'user-1',
      },
      2_000_000_000,
    );
    expect(body.sessionId).toBe(sessionId);
    expect(authMocks.createSession).not.toHaveBeenCalled();
  });

  it('echoes back whatever headers the preflight actually requested', async () => {
    // Live-reproduced bug (2026-07-21): a hard-coded 'Content-Type'-only
    // Access-Control-Allow-Headers made the browser reject the whole
    // preflight whenever the caller's fetch/XHR layer (e.g. a polyfill)
    // added an extra header like X-Requested-With — surfacing as a plain
    // "CORS error" in the Network tab even though the origin was allowed.
    const response = OPTIONS(new Request('http://localhost/api/auth/verify', {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, x-requested-with',
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type, x-requested-with');
  });

  it('falls back to Content-Type when no Access-Control-Request-Headers is sent', async () => {
    const response = OPTIONS(new Request('http://localhost/api/auth/verify', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
    }));

    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('denies a request from an origin outside the allowlist', async () => {
    const response = await POST(request(
      { envelope: 'signed-envelope' },
      'https://attacker.example',
    ));

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(authMocks.verifyEnvelope).not.toHaveBeenCalled();
  });
});
