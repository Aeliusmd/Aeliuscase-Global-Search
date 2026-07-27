import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { syncEmbedModeToUrl } from '@/lib/embed/syncModeUrl';

function setLocation(path: string) {
  const url = new URL(path, 'http://localhost');
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: url,
  });
}

describe('syncEmbedModeToUrl', () => {
  const replaceState = vi.fn();

  beforeEach(() => {
    replaceState.mockClear();
    window.history.replaceState = replaceState;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets mode=maximized while preserving other query params and hash', () => {
    setLocation('/embed?mode=compact&foo=bar#panel');

    syncEmbedModeToUrl('maximized');

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'http://localhost/embed?mode=maximized&foo=bar#panel',
    );
  });

  it('sets mode=compact on minimize', () => {
    setLocation('/embed?mode=maximized');

    syncEmbedModeToUrl('compact');

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'http://localhost/embed?mode=compact',
    );
  });

  it('does nothing for closed view', () => {
    setLocation('/embed?mode=compact');

    syncEmbedModeToUrl('closed');

    expect(replaceState).not.toHaveBeenCalled();
  });
});
