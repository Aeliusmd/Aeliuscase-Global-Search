/**
 * Reloads the real dashboard page from inside the (cross-origin) chat iframe.
 *
 * The iframe never gets a fresh envelope on its own — only the parent
 * dashboard mints one (from its own login session) and passes a sessionId
 * via the iframe's `?session=` query param. So the only real recovery from
 * an expired chat session is a full reload of the *top* page, not the iframe.
 *
 * Cross-origin script can't read window.top.location (SecurityError), so we
 * can't ask the browser to reload "whatever URL is currently up there". But
 * document.referrer — the URL that embedded this iframe — is exposed even
 * cross-origin, and cross-origin writes to Location (assign/href-setter) are
 * allowed by spec. Combining the two lets us send the top window back to the
 * same dashboard URL without any cooperation from the dashboard's own code.
 */
export function reloadHostPage(): void {
  if (typeof window === 'undefined') return;

  try {
    if (window.top && window.top !== window && document.referrer) {
      window.top.location.href = document.referrer;
      return;
    }
  } catch {
    // Blocked (e.g. sandboxed ancestor) — fall through to a same-window reload.
  }

  window.location.reload();
}
