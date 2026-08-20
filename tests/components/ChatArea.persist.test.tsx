import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { UIMessage } from 'ai';

/**
 * Reported 2026-08-20: clicking an old conversation moved it straight to the
 * top of Recent Searches showing "just now", without a word being added.
 *
 * Opening a chat restores its messages from the DB, which lands in the persist
 * effect with status 'ready' and a non-empty list — indistinguishable, to that
 * effect, from a finished exchange. So it PATCHed the conversation (bumping
 * updatedAt server-side, so the wrong order survived a reload) and called
 * onConversationActivity. The chat should only move when the user actually
 * sends something.
 *
 * Scope is deliberately narrow: does opening a chat write, and does sending
 * one write. Nothing about rendering or streaming.
 */

const STORED: UIMessage[] = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'earlier question' }] },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'earlier answer' }] },
];

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));

// Real React state, so a send re-renders exactly as the live hook would —
// without that, the persist effect never re-runs and the test proves nothing.
vi.mock('@ai-sdk/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useChat: () => {
      const [messages, setMessages] = React.useState<UIMessage[]>([]);
      return {
        messages,
        status: 'ready',
        setMessages,
        sendMessage: ({ text }: { text: string }) => {
          sendSpy({ text });
          setMessages((prev) => [...prev, { id: `u${prev.length}`, role: 'user', parts: [{ type: 'text', text }] }]);
        },
      };
    },
  };
});
vi.mock('ai', () => ({ DefaultChatTransport: class { constructor(_: unknown) { void _; } } }));
vi.mock('@/components/home/MessageBubble', () => ({ default: () => null }));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/lib/embed/reload', () => ({ reloadHostPage: vi.fn() }));
vi.mock('@/components/home/InputBar', () => ({
  default: ({ onSend }: { onSend: (t: string) => void }) => (
    <button type="button" onClick={() => onSend('a new question')}>send</button>
  ),
}));

import ChatArea from '@/components/home/ChatArea';

const onConversationActivity = vi.fn();

function renderExistingChat() {
  return render(
    <ChatArea
      sessionId="s1"
      conversationTitle="Old chat"
      conversationId="conv-1"
      isNew={false}
      onConversationActivity={onConversationActivity}
    />,
  );
}

const calls = () => vi.mocked(globalThis.fetch).mock.calls;
/** PATCH calls to the conversation endpoint — the "chat was touched" signal. */
const patchCalls = () =>
  calls().filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
const restoreCalls = () =>
  calls().filter(([url, init]) => String(url).includes('/api/conversations/conv-1')
    && (init as RequestInit | undefined)?.method === undefined);

describe('ChatArea — opening a chat must not count as activity', () => {
  beforeEach(() => {
    sendSpy.mockClear();
    onConversationActivity.mockClear();
    // jsdom has no layout, so the auto-scroll effect would throw.
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/conversations/')) {
        return { ok: true, status: 200, json: async () => ({ data: { messages: STORED } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not save or bump the chat when it is merely opened', async () => {
    renderExistingChat();

    // Wait for the restore to have completed, so the persist effect has had
    // its chance to fire on the restored messages.
    await waitFor(() => expect(restoreCalls().length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument());

    expect(patchCalls()).toHaveLength(0);
    expect(onConversationActivity).not.toHaveBeenCalled();
  });

  it('saves and bumps once the user sends a message', async () => {
    renderExistingChat();
    await waitFor(() => expect(restoreCalls().length).toBeGreaterThan(0));

    screen.getByRole('button', { name: 'send' }).click();
    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith({ text: 'a new question' }));

    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    expect(onConversationActivity).toHaveBeenCalledWith('conv-1');
  });
});
