/** Comma-separated UAT parent origins for postMessage + CSP (see NEXT_PUBLIC_UAT_ORIGINS). */
export function getAllowedParentOrigins(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_UAT_ORIGINS ??
    process.env.NEXT_PUBLIC_UAT_ORIGIN ??
    '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:')
          && value === url.origin
          ? [url.origin]
          : [];
      } catch {
        return [];
      }
    });
}

const LOCALHOST_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Strict origin check for inbound postMessage from the UAT parent app. */
export function isAllowedOrigin(origin: string): boolean {
  const allowed = getAllowedParentOrigins();
  if (allowed.length === 0) {
    return LOCALHOST_ORIGIN.test(origin);
  }
  return allowed.includes(origin);
}

/** Target origins for outbound postMessage to the parent frame. */
export function getPostMessageTargets(): string[] {
  const allowed = getAllowedParentOrigins();
  if (allowed.length > 0) return allowed;
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      return [new URL(document.referrer).origin];
    } catch {
      /* ignore malformed referrer */
    }
  }
  return ['*'];
}
