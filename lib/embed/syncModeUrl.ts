import type { EmbedView } from '@/lib/embed/viewState';

/** Update `?mode=` in the iframe URL without reload or new history entry. */
export function syncEmbedModeToUrl(next: EmbedView): void {
  if (typeof window === 'undefined' || next === 'closed') return;

  const url = new URL(window.location.href);
  url.searchParams.set('mode', next);
  window.history.replaceState(window.history.state, '', url.toString());
}
