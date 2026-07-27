import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatHistory } from '@/hooks/useChatHistory';
import { MessageType } from '@/types/chat';
import type { UserMessage, BotTextMessage } from '@/types/chat';

const makeUserMsg = (id: string, text: string): UserMessage => ({
  id,
  type: MessageType.USER,
  text,
  timestamp: new Date(),
});

const makeBotMsg = (id: string, text: string): BotTextMessage => ({
  id,
  type: MessageType.BOT_TEXT,
  text,
  variant: 'default',
  timestamp: new Date(),
});

describe('useChatHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with empty messages', () => {
    const { result } = renderHook(() => useChatHistory());
    expect(result.current.messages).toEqual([]);
  });

  it('append adds a message', async () => {
    const { result } = renderHook(() => useChatHistory());
    const msg = makeUserMsg('1', 'Hello');

    await act(async () => { result.current.append(msg); });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('1');
  });

  it('append adds multiple messages in order', async () => {
    const { result } = renderHook(() => useChatHistory());

    await act(async () => {
      result.current.append(makeUserMsg('1', 'first'));
      result.current.append(makeBotMsg('2', 'second'));
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].id).toBe('1');
    expect(result.current.messages[1].id).toBe('2');
  });

  it('replace swaps a message by id', async () => {
    const { result } = renderHook(() => useChatHistory());
    const original = makeBotMsg('bot1', 'Loading...');
    const replacement = makeBotMsg('bot1', 'Done!');

    await act(async () => { result.current.append(original); });
    await act(async () => { result.current.replace('bot1', replacement); });

    expect(result.current.messages).toHaveLength(1);
    expect((result.current.messages[0] as BotTextMessage).text).toBe('Done!');
  });

  it('replace leaves other messages untouched', async () => {
    const { result } = renderHook(() => useChatHistory());

    await act(async () => {
      result.current.append(makeUserMsg('u1', 'Hi'));
      result.current.append(makeBotMsg('b1', 'Loading...'));
    });
    await act(async () => {
      result.current.replace('b1', makeBotMsg('b1', 'Done'));
    });

    expect(result.current.messages[0].id).toBe('u1');
    expect((result.current.messages[1] as BotTextMessage).text).toBe('Done');
  });

  it('replace with unknown id does not change messages', async () => {
    const { result } = renderHook(() => useChatHistory());
    await act(async () => { result.current.append(makeUserMsg('1', 'msg')); });
    await act(async () => {
      result.current.replace('nonexistent', makeUserMsg('nonexistent', 'nope'));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('1');
  });

  it('clear removes all messages', async () => {
    const { result } = renderHook(() => useChatHistory());

    await act(async () => {
      result.current.append(makeUserMsg('1', 'a'));
      result.current.append(makeUserMsg('2', 'b'));
    });
    await act(async () => { result.current.clear(); });

    expect(result.current.messages).toHaveLength(0);
  });

  it('clear results in empty array in localStorage (persist effect overwrites removal)', async () => {
    const { result } = renderHook(() => useChatHistory());
    await act(async () => { result.current.append(makeUserMsg('1', 'hi')); });
    await act(async () => { result.current.clear(); });

    // The persist useEffect runs after messages becomes [] and writes "[]" to storage
    const raw = localStorage.getItem('aelius_chat_history');
    expect(raw === null || raw === '[]').toBe(true);
  });

  it('persists messages to localStorage after append', async () => {
    const { result } = renderHook(() => useChatHistory());
    await act(async () => { result.current.append(makeUserMsg('x', 'persist me')); });

    const raw = localStorage.getItem('aelius_chat_history');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('x');
  });

  it('loads persisted messages on mount', async () => {
    const stored = [{ id: 's1', type: MessageType.USER, text: 'stored', timestamp: new Date().toISOString() }];
    localStorage.setItem('aelius_chat_history', JSON.stringify(stored));

    const { result } = renderHook(() => useChatHistory());
    // wait for the useEffect to run
    await act(async () => {});

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('s1');
    expect(result.current.messages[0].timestamp).toBeInstanceOf(Date);
  });

  it('handles corrupt localStorage gracefully (starts fresh)', async () => {
    localStorage.setItem('aelius_chat_history', 'not-json{{{');
    const { result } = renderHook(() => useChatHistory());
    await act(async () => {});

    expect(result.current.messages).toEqual([]);
  });
});
