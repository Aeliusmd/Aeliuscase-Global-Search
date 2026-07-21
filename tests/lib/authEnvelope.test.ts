// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { exportPKCS8, SignJWT } from 'jose';

describe('verifyEnvelope', () => {
  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];
  const originalKey = process.env.AI_SEARCH_PRIVATE_KEY_PEM;

  beforeAll(async () => {
    ({ privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
    process.env.AI_SEARCH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.AI_SEARCH_PRIVATE_KEY_PEM;
    else process.env.AI_SEARCH_PRIVATE_KEY_PEM = originalKey;
  });

  async function validEnvelope() {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      token: 'upstream-user-token',
      firmId: 'firm-1',
      userId: 'user-1',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
  }

  it('verifies a valid RS256 envelope and extracts only required claims', async () => {
    const { verifyEnvelope } = await import('@/lib/auth/envelope');
    await expect(verifyEnvelope(await validEnvelope())).resolves.toMatchObject({
      token: 'upstream-user-token',
      firmId: 'firm-1',
      userId: 'user-1',
    });
  });

  it('rejects a token signed by a different key', async () => {
    const { verifyEnvelope } = await import('@/lib/auth/envelope');
    const now = Math.floor(Date.now() / 1000);
    const envelope = await new SignJWT({
      token: 'attacker-token',
      firmId: 'firm-1',
      userId: 'user-1',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime(now + 3600)
      .sign(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);

    await expect(verifyEnvelope(envelope)).rejects.toThrow('Invalid or expired envelope.');
  });

  it('rejects a non-RS256 algorithm even with a configured verification key', async () => {
    const { verifyEnvelope } = await import('@/lib/auth/envelope');
    const now = Math.floor(Date.now() / 1000);
    const envelope = await new SignJWT({
      token: 'upstream-user-token',
      firmId: 'firm-1',
      userId: 'user-1',
    })
      .setProtectedHeader({ alg: 'RS512' })
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    await expect(verifyEnvelope(envelope)).rejects.toThrow('Invalid or expired envelope.');
  });

  it('verifies correctly when the env var stores the PEM as one continuous line with no newlines', async () => {
    // Live bug (2026-07-21): .env.local / Vercel commonly store a PEM value as
    // a single unbroken line (no real newlines, no "\n" escapes either) — Node's
    // PEM decoder throws ERR_OSSL_UNSUPPORTED on that shape even for a perfectly
    // valid key. Reproduced with a freshly generated key to confirm it wasn't a
    // corrupted key on the signing side, then fixed via normalizePem() in
    // lib/auth/envelope.ts. This test pins that exact real-world storage shape,
    // which the other tests in this file (multi-line exportPKCS8 output) don't
    // exercise.
    const multiLinePem = process.env.AI_SEARCH_PRIVATE_KEY_PEM;
    vi.resetModules();
    process.env.AI_SEARCH_PRIVATE_KEY_PEM = (await exportPKCS8(privateKey)).replace(/\n/g, '');

    try {
      const { verifyEnvelope } = await import('@/lib/auth/envelope');
      await expect(verifyEnvelope(await validEnvelope())).resolves.toMatchObject({
        token: 'upstream-user-token',
        firmId: 'firm-1',
        userId: 'user-1',
      });
    } finally {
      // Restore so later tests in this file (which re-import the module) get
      // the original multi-line key, not this test's single-line variant.
      process.env.AI_SEARCH_PRIVATE_KEY_PEM = multiLinePem;
      vi.resetModules();
    }
  });

  it('rejects an expired envelope', async () => {
    const { verifyEnvelope } = await import('@/lib/auth/envelope');
    const envelope = await new SignJWT({
      token: 'upstream-user-token',
      firmId: 'firm-1',
      userId: 'user-1',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);

    await expect(verifyEnvelope(envelope)).rejects.toThrow('Invalid or expired envelope.');
  });
});
