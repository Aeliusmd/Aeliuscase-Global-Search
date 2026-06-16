'use client';

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';

type MessageRole = 'user' | 'bot' | 'error';

interface Message {
  id: string;
  role: MessageRole;
  text: string;
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'bot',
  text: 'Hello! I am the **AeliusCase Guide Assistant**.\n\nAsk me anything about how to use AeliusCase — I answer strictly from the **AeliusCase User Guide**. I cannot answer general questions outside the guide.',
};

export default function KnowledgePage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
    const botId = `b-${Date.now()}`;
    const loadingMsg: Message = { id: botId, role: 'bot', text: '' };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setStreaming(true);
    setInput('');

    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `Server error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream.');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              setMessages((prev) =>
                prev.map((m) => (m.id === botId ? { ...m, text: m.text + parsed.text! } : m)),
              );
            }
          } catch (err) {
            if (err instanceof Error && err.message !== 'Unexpected end of JSON input') throw err;
          }
        }
      }

      reader.releaseLock();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errorText = err instanceof Error ? err.message : 'Something went wrong.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId ? { ...m, role: 'error' as MessageRole, text: errorText } : m,
        ),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [streaming]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background-50" style={{ fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-background-200 bg-white shadow-sm">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-white flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
        >
          <i className="ri-book-open-line text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-background-900 leading-tight">AeliusCase Guide</p>
          <p className="text-xs text-background-500 leading-tight">Answers strictly from the User Guide</p>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-background-500 hover:text-background-700 transition-colors"
        >
          <i className="ri-arrow-left-line" />
          Back to App
        </Link>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-sm lg:max-w-md bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              </div>
            );
          }

          if (msg.role === 'error') {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[85%] sm:max-w-sm lg:max-w-md bg-red-50 border border-red-200 text-red-700 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                </div>
              </div>
            );
          }

          // Bot message
          if (msg.text === '' && streaming) {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[85%] sm:max-w-sm lg:max-w-md bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
                <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:my-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-background-200 px-4 py-3 bg-white">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask anything about AeliusCase…"
            className="flex-1 rounded-xl border border-background-200 bg-background-50 px-4 py-2.5 text-sm text-background-900 placeholder:text-background-400 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50 disabled:cursor-not-allowed"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void sendMessage(input)}
            disabled={streaming || !input.trim()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
            aria-label="Send"
          >
            <i className="ri-send-plane-fill text-base" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-background-400 max-w-3xl mx-auto">
          Answers are sourced exclusively from the AeliusCase User Guide
        </p>
      </div>
    </div>
  );
}
