import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmbedPageClient from '@/components/embed/EmbedPageClient';

const postMessage = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('mode=compact'),
}));

vi.mock('@/components/home/ChatArea', () => ({
  default: ({
    onMaximize,
    onMinimize,
    onClose,
  }: {
    onMaximize?: () => void;
    onMinimize?: () => void;
    onClose?: () => void;
  }) => (
    <div>
      <span>Mock ChatArea</span>
      <button type="button" onClick={onMaximize}>
        Maximize
      </button>
      <button type="button" onClick={onMinimize}>
        Minimize
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

describe('EmbedPageClient', () => {
  const replaceState = vi.fn();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_UAT_ORIGINS', 'https://uat.aeliuscase.com');
    postMessage.mockClear();
    replaceState.mockClear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: new URL('http://localhost/embed?mode=compact&foo=bar'),
    });
    window.history.replaceState = replaceState;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage },
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: [] }),
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders opaque panel inside transparent embed shell', () => {
    const { container } = render(<EmbedPageClient />);
    expect(container.querySelector('.bg-transparent')).toBeTruthy();
    expect(container.querySelector('.bg-background-50')).toBeTruthy();
  });

  it('posts READY and initial CHAT_VIEW_CHANGED on mount', async () => {
    render(<EmbedPageClient />);
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'READY' },
        'https://uat.aeliuscase.com',
      );
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CHAT_VIEW_CHANGED', view: 'compact' }),
        'https://uat.aeliuscase.com',
      );
    });
  });

  it('posts maximized CHAT_VIEW_CHANGED when maximize is clicked', async () => {
    const user = userEvent.setup();
    render(<EmbedPageClient />);
    postMessage.mockClear();

    await user.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CHAT_VIEW_CHANGED', view: 'maximized' }),
      'https://uat.aeliuscase.com',
    );
  });

  it('updates URL mode to maximized on expand without reload', async () => {
    const user = userEvent.setup();
    render(<EmbedPageClient />);

    await user.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'http://localhost/embed?mode=maximized&foo=bar',
    );
  });

  it('updates URL mode back to compact on minimize', async () => {
    const user = userEvent.setup();
    render(<EmbedPageClient />);

    await user.click(screen.getByRole('button', { name: 'Maximize' }));
    replaceState.mockClear();
    await user.click(screen.getByRole('button', { name: 'Minimize' }));

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'http://localhost/embed?mode=compact&foo=bar',
    );
  });

  it('does not update URL mode when chat is closed', async () => {
    const user = userEvent.setup();
    render(<EmbedPageClient />);
    replaceState.mockClear();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('posts closed CHAT_VIEW_CHANGED when close is clicked', async () => {
    const user = userEvent.setup();
    render(<EmbedPageClient />);
    postMessage.mockClear();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CHAT_VIEW_CHANGED', view: 'closed', bounds: null }),
      'https://uat.aeliuscase.com',
    );
    expect(screen.getByText('Chat closed')).toBeInTheDocument();
  });

  it('reopens compact panel when parent sends OPEN_CHAT', async () => {
    render(<EmbedPageClient />);
    postMessage.mockClear();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://uat.aeliuscase.com',
        data: { type: 'OPEN_CHAT' },
      }),
    );

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CHAT_VIEW_CHANGED', view: 'compact' }),
        'https://uat.aeliuscase.com',
      );
    });
    expect(screen.getByText('Mock ChatArea')).toBeInTheDocument();
  });
});
