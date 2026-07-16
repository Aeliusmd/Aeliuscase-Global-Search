import { getPostMessageTargets } from '@/lib/auth/origins';

export type EmbedView = 'closed' | 'compact' | 'maximized';

export interface EmbedBounds {
  width: number;
  height: number;
  top: number;
  left: number;
  borderRadius: number;
}

export interface ChatViewChangedMessage {
  type: 'CHAT_VIEW_CHANGED';
  view: EmbedView;
  bounds: EmbedBounds | null;
}

/** Recommended iframe pixel bounds for the UAT parent host. */
export function getEmbedBounds(
  view: EmbedView,
  viewportWidth: number,
  viewportHeight: number,
): EmbedBounds | null {
  if (view === 'closed') return null;

  const edgeMargin = viewportWidth >= 640 ? 24 : 16;
  const maximizedInset = viewportWidth >= 640 ? 24 : 8;
  const borderRadius = view === 'compact' ? 8 : 12;

  if (view === 'compact') {
    const width = Math.min(420, viewportWidth - edgeMargin * 2);
    /** Space reserved for the UAT launcher button below the panel. */
    const parentFabClearance = 90;
    const height = Math.min(
      680,
      viewportHeight - parentFabClearance - edgeMargin,
    );
    return {
      width,
      height,
      top: viewportHeight - height - parentFabClearance,
      left: viewportWidth - width - edgeMargin,
      borderRadius,
    };
  }

  return {
    width: viewportWidth - maximizedInset * 2,
    height: viewportHeight - maximizedInset * 2,
    top: maximizedInset,
    left: maximizedInset,
    borderRadius,
  };
}

export function buildChatViewChangedMessage(
  view: EmbedView,
  viewportWidth: number,
  viewportHeight: number,
): ChatViewChangedMessage {
  return {
    type: 'CHAT_VIEW_CHANGED',
    view,
    bounds: getEmbedBounds(view, viewportWidth, viewportHeight),
  };
}

/** Notify the UAT parent to resize/reposition the iframe for click-through. */
export function postChatViewChanged(view: EmbedView): void {
  if (typeof window === 'undefined' || window.parent === window) return;

  const message = buildChatViewChangedMessage(
    view,
    window.innerWidth,
    window.innerHeight,
  );

  for (const targetOrigin of getPostMessageTargets()) {
    window.parent.postMessage(message, targetOrigin);
  }
}

/** Handshake so the parent can push auth token after the embed listener is ready. */
export function postReady(): void {
  if (typeof window === 'undefined' || window.parent === window) return;

  for (const targetOrigin of getPostMessageTargets()) {
    window.parent.postMessage({ type: 'READY' }, targetOrigin);
  }
}
