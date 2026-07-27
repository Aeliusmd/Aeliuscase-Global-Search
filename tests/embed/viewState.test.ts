import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildChatViewChangedMessage,
  getEmbedBounds,
  postChatViewChanged,
  postReady,
} from '@/lib/embed/viewState';

describe('getEmbedBounds', () => {
  it('returns null for closed view', () => {
    expect(getEmbedBounds('closed', 1280, 800)).toBeNull();
  });

  it('returns compact bottom-right bounds with launcher clearance', () => {
    const bounds = getEmbedBounds('compact', 1280, 800);
    expect(bounds).toEqual({
      width: 420,
      height: 680,
      top: 30,
      left: 836,
      borderRadius: 8,
    });
  });

  it('shrinks compact width on narrow viewports', () => {
    const bounds = getEmbedBounds('compact', 360, 640);
    expect(bounds?.width).toBe(328);
    expect(bounds?.left).toBe(16);
  });

  it('returns maximized inset bounds on desktop', () => {
    const bounds = getEmbedBounds('maximized', 1280, 800);
    expect(bounds).toEqual({
      width: 1232,
      height: 752,
      top: 24,
      left: 24,
      borderRadius: 12,
    });
  });

  it('uses smaller inset on mobile maximized', () => {
    const bounds = getEmbedBounds('maximized', 390, 844);
    expect(bounds).toEqual({
      width: 374,
      height: 828,
      top: 8,
      left: 8,
      borderRadius: 12,
    });
  });
});

describe('buildChatViewChangedMessage', () => {
  it('wraps view and bounds in CHAT_VIEW_CHANGED payload', () => {
    expect(buildChatViewChangedMessage('compact', 1280, 800)).toMatchObject({
      type: 'CHAT_VIEW_CHANGED',
      view: 'compact',
      bounds: expect.objectContaining({ width: 420 }),
    });
  });
});

describe('postMessage bridge', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_UAT_ORIGINS', 'https://uat.aeliuscase.com');
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage },
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('posts READY to allowed origins', () => {
    postReady();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'READY' },
      'https://uat.aeliuscase.com',
    );
  });

  it('posts CHAT_VIEW_CHANGED with bounds on view change', () => {
    postChatViewChanged('maximized');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHAT_VIEW_CHANGED',
        view: 'maximized',
        bounds: expect.objectContaining({ borderRadius: 12 }),
      }),
      'https://uat.aeliuscase.com',
    );
  });
});
