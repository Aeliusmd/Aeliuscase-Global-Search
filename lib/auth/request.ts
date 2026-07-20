export const AUTH_USER_HEADER = 'x-aelius-user-id';
export const AUTH_FIRM_HEADER = 'x-aelius-firm-id';
export const AUTH_TOKEN_HEADER = 'x-aelius-api-token';
export const AUTH_IP_HEADER = 'x-aelius-client-ip';

export const CLIENT_IDENTITY_HEADERS = [
  'x-user-id',
  'x-firm-id',
  AUTH_USER_HEADER,
  AUTH_FIRM_HEADER,
  AUTH_TOKEN_HEADER,
  AUTH_IP_HEADER,
] as const;

export interface RequestAuth {
  userId: string;
  firmId: string;
  token: string;
  ip: string;
}

/**
 * Reads values set by middleware after the opaque session has been resolved.
 * Route handlers must never fall back to client-provided identity or JWT data.
 */
export function getRequestAuth(req: Request): RequestAuth | null {
  const userId = req.headers.get(AUTH_USER_HEADER);
  const firmId = req.headers.get(AUTH_FIRM_HEADER);
  const token = req.headers.get(AUTH_TOKEN_HEADER);
  const ip = req.headers.get(AUTH_IP_HEADER) ?? 'unknown';

  if (!userId || !firmId || !token) return null;
  return { userId, firmId, token, ip };
}
