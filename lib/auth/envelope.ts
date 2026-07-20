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

function getVerificationKey(): KeyObject {
  if (verificationKey) return verificationKey;

  const privateKeyPem = process.env.AI_SEARCH_PRIVATE_KEY_PEM;
  if (typeof privateKeyPem !== 'string' || privateKeyPem.length === 0) {
    throw new Error('AI_SEARCH_PRIVATE_KEY_PEM is not configured.');
  }

  // Vercel and local env files commonly store PEM newlines as the two
  // characters "\n". Normalize in memory only; never log the key material.
  const privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
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

