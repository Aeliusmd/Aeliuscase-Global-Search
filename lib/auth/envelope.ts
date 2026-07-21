import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { jwtVerify } from 'jose';

export interface VerifiedEnvelope {
  token: string;
  firmId: string;
  userId: string;
  exp: number;
}

export class EnvelopeVerificationError extends Error {
  constructor(message = 'Invalid or expired envelope.') {
    super(message);
    this.name = 'EnvelopeVerificationError';
  }
}

let verificationKey: KeyObject | undefined;

/**
 * Reconstructs a properly line-wrapped PEM from whatever shape the env var
 * happens to store — literal "\n" escapes, real newlines already, or (the
 * case that was silently breaking every verification) one continuous line
 * with no newlines at all. Node's PEM decoder requires the base64 body to be
 * line-wrapped; a single unbroken line throws ERR_OSSL_UNSUPPORTED even for a
 * perfectly valid key, which is why every envelope was failing regardless of
 * its own content (confirmed 2026-07-21 — a freshly generated key reproduced
 * the identical failure once squished onto one line, ruling out a corrupted
 * key on the signing side).
 */
function normalizePem(pem: string): string {
  const withRealNewlines = pem.replace(/\\n/g, '\n');
  if (withRealNewlines.includes('\n')) return withRealNewlines;

  const match = withRealNewlines.match(/-----BEGIN ([A-Z0-9 ]+)-----(.*)-----END \1-----/);
  if (!match) return withRealNewlines;

  const [, label, rawBody] = match;
  const body = rawBody.replace(/\s+/g, '');
  const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

function getVerificationKey(): KeyObject {
  if (verificationKey) return verificationKey;

  const privateKeyPem = process.env.AI_SEARCH_PRIVATE_KEY_PEM;
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length === 0) {
    throw new Error('AI_SEARCH_PRIVATE_KEY_PEM is not configured.');
  }

  // Normalize in memory only; never log the key material.
  const privateKey = createPrivateKey(normalizePem(privateKeyPem));
  verificationKey = createPublicKey(privateKey);
  return verificationKey;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Verifies the backend-signed authentication envelope and returns only the
 * claims needed to create a server-side session. The accepted JWS algorithm is
 * pinned to RS256 to reject alg:none and algorithm-confusion attempts.
 */
export async function verifyEnvelope(envelope: string): Promise<VerifiedEnvelope> {
  if (typeof envelope !== 'string' || envelope.length === 0) {
    throw new EnvelopeVerificationError();
  }

  try {
    const { payload } = await jwtVerify(envelope, getVerificationKey(), {
      algorithms: ['RS256'],
    });

    const token = requiredString(payload.token);
    const firmId = requiredString(payload.firmId);
    const userId = requiredString(payload.userId);
    const exp = payload.exp;

    if (!token || !firmId || !userId || typeof exp !== 'number' || !Number.isInteger(exp)) {
      throw new EnvelopeVerificationError();
    }

    return { token, firmId, userId, exp };
  } catch (error) {
    if (error instanceof Error && error.message === 'AI_SEARCH_PRIVATE_KEY_PEM is not configured.') {
      throw error;
    }
    if (error instanceof EnvelopeVerificationError) throw error;
    throw new EnvelopeVerificationError();
  }
}

