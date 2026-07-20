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

import { POST } from '@/app/api/auth/verify/route';

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
