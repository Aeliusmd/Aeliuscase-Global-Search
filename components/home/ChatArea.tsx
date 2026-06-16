'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import type { CaseSearchItem, PagedApiResponse, SearchToolOutput } from '@/types/case';
import MessageBubble, { type OnLoadMore } from './MessageBubble';
import InputBar from './InputBar';
import ThemeToggle from '@/components/ThemeToggle';

const SUGGESTION_CHIPS = [
  { icon: 'ri-search-eye-line', text: 'Search all cases' },
  { icon: 'ri-folder-open-line', text: 'Find open cases' },
  { icon: 'ri-archive-2-line', text: 'Find closed cases' },
  { icon: 'ri-user-search-line', text: 'Search by applicant name' },
];

interface ChatAreaProps {
  conversationTitle: string;
  conversationId: string;
  isNew: boolean;
  variant?: 'full' | 'widget';
  onFirstMessage?: (title: string) => void;
  onUpdateTitle?: (id: string, title: string) => void;
  onToggleSidebar?: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
}

export default function ChatArea({
  conversationTitle,
  conversationId,
  isNew,
  variant = 'full',
  onFirstMessage,
  onUpdateTitle,
  onToggleSidebar,
  onMaximize,
  onMinimize,
  onClose,
}: ChatAreaProps) {
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isWidget = variant === 'widget';

  // Track whether this chat session started as new (for title generation)
  const wasNewRef = useRef(isNew);
  const hasTitleRef = useRef(false);

  const [transport] = useState(
    () => new DefaultChatTransport({ api: '/api/chat' }),
  );

  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';

  // Restore messages from DB on mount (existing sessions only)
  useEffect(() => {
    if (!isNew) {
      fetch(`/api/conversations/${conversationId}`)
        .then((r) => r.json())
        .then(({ data }: { data?: { messages?: UIMessage[] } }) => {
          const stored = data?.messages;
          if (Array.isArray(stored) && stored.length > 0) setMessages(stored);
        })
        .catch(() => {})
        .finally(() => setHydrated(true));
    } else {
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages to DB after every AI reply completes
  useEffect(() => {
    if (!hydrated || messages.length === 0 || status !== 'ready') return;
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }).catch(() => {});
  }, [messages, hydrated, conversationId, status]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-generate session title from first exchange (like ChatGPT / Gemini)
  useEffect(() => {
    if (!wasNewRef.current || hasTitleRef.current) return;
    if (status !== 'ready') return;

    const userMsg = messages.find((m) => m.role === 'user');
    const aiMsg = messages.find((m) => m.role === 'assistant');
    if (!userMsg || !aiMsg) return;

    const userText =
      (userMsg.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
        ?.text ?? '';
    const aiText = (aiMsg.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join(' ')
      .trim();

    if (!userText || !aiText) return;

    hasTitleRef.current = true;

    fetch('/api/chat/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: userText, aiResponse: aiText.slice(0, 500) }),
    })
      .then((r) => r.json())
      .then(({ title }: { title: string | null }) => {
        if (title && onUpdateTitle) onUpdateTitle(conversationId, title);
      })
      .catch(() => {}); // keep temp title on failure
  }, [status, messages, conversationId, onUpdateTitle]);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage({ text });
      if (isNew && onFirstMessage) {
        const title = text.length > 40 ? text.slice(0, 40) + '...' : text;
        onFirstMessage(title);
      }
    },
    [sendMessage, isNew, onFirstMessage],
  );

  const handleLoadMore: OnLoadMore = useCallback(
    async (messageId, toolCallId, searchText, msgSearchType, currentPage, existingCases) => {
      const url = new URL('/api/cases/search', window.location.origin);
      url.searchParams.set('searchText', searchText);
      url.searchParams.set('searchType', String(msgSearchType));
      url.searchParams.set('page', String(currentPage + 1));
      url.searchParams.set('pageSize', '10');

      const response = await fetch(url.toString());
      const data = (await response.json()) as PagedApiResponse<CaseSearchItem>;
      if (!response.ok || !data.succeeded) return;

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          const updatedParts = (msg.parts ?? []).map((part) => {
            if (part.type !== 'tool-searchCases') return part;
            const p = part as unknown as {
              toolCallId: string;
              state: string;
              output?: SearchToolOutput;
            };
            if (p.toolCallId !== toolCallId || p.state !== 'output-available') return part;
            return {
              ...part,
              output: {
                ...(p.output ?? {}),
                cases: [...existingCases, ...(data.data ?? [])],
                page: data.page,
                hasMorePages: data.hasMorePages,
                totalRecords: data.totalRecords,
              } as SearchToolOutput,
            } as typeof part;
          });
          return { ...msg, parts: updatedParts };
        }),
      );
    },
    [setMessages],
  );

  const showEmptyState = isNew && messages.length === 0;
  const hasGradientTitle = !isNew && conversationTitle !== 'New Conversation';

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-background-50">
      {/* Header */}
      <div
        className={`flex items-center justify-between border-b border-background-200 bg-background-50/90 backdrop-blur-sm relative md:sticky md:top-0 z-10 ${
          isWidget ? 'px-3 py-3' : 'px-4 sm:px-6 py-3.5'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!isWidget && (
            <button
              className="flex md:hidden items-center justify-center w-11 h-11 -ml-1 rounded-lg hover:bg-background-100 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              onClick={onToggleSidebar}
              aria-label="Open navigation"
            >
              <i className="ri-menu-line text-lg text-foreground-700" />
            </button>
          )}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #3DC0EC 0%, #6763AC 100%)' }}
          >
            <i className="ri-sparkling-2-fill text-white text-sm" />
          </div>
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold truncate"
              style={
                hasGradientTitle
                  ? {
                      fontFamily: 'var(--font-heading)',
                      background: 'linear-gradient(135deg, #6763AC, #3DC0EC)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }
                  : { fontFamily: 'var(--font-heading)', color: 'oklch(var(--foreground-900))' }
              }
            >
              {conversationTitle}
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
              <span className="text-xs text-secondary-500">Aeliuscase AI · Online</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {isWidget ? (
            <>
              <button
                type="button"
                onClick={onMaximize}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground-700 transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                title="Maximize"
                aria-label="Maximize chat"
              >
                <i className="ri-fullscreen-line text-base" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground-700 transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                title="Close"
                aria-label="Close chat"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onMinimize}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground-700 transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                title="Minimize"
                aria-label="Minimize chat"
              >
                <i className="ri-fullscreen-exit-line text-base" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground-700 transition-colors hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                title="Close"
                aria-label="Close chat"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {showEmptyState ? (
        /* Empty / welcome state */
        <div
          className={
            isWidget
              ? 'flex-1 overflow-y-auto px-5 py-5'
              : 'flex-1 flex flex-col items-center justify-center px-4 sm:px-6'
          }
        >
          <div className={isWidget ? 'mx-auto max-w-md text-center' : 'text-center max-w-md'}>
            {/* Animated gradient orb */}
            <div className={isWidget ? 'hidden' : 'relative mx-auto w-20 h-20 mb-6'}>
              <div
                className="absolute inset-0 rounded-2xl opacity-40 animate-pulse"
                style={{
                  background: 'linear-gradient(135deg, #3DC0EC 0%, #6763AC 100%)',
                  filter: 'blur(14px)',
                }}
              />
              <div
                className="relative w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg"
                style={{ background: 'linear-gradient(135deg, #3DC0EC 0%, #6763AC 100%)' }}
              >
                <i className="ri-sparkling-2-fill text-white text-3xl" />
              </div>
            </div>
            <h3
              className={`${isWidget ? 'text-lg' : 'text-xl'} font-semibold text-foreground-900 mb-2 leading-tight`}
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              Aeliuscase AI Assistant
            </h3>
            <p className={`${isWidget ? 'mb-5' : 'mb-8'} text-sm text-foreground-600 leading-relaxed`}>
              Search cases by number, name, or keyword — or ask how to use AeliusCase.
              I answer from the case database and the AeliusCase User Guide.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.text}
                  onClick={() => handleSend(chip.text)}
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-full border border-background-300 bg-background-50 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50 hover:shadow-sm transition-all duration-200 text-sm text-foreground-600 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <i className={`${chip.icon} text-xs`} />
                  </div>
                  {chip.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Message list */
        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 space-y-6">
          {messages.length === 0 && !isLoading && (
            <div className="flex justify-start msg-animate">
              <div className="bg-background-100 border border-background-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <p className="text-sm text-foreground-700 leading-relaxed">
                  Hello! I can help you search for legal cases or answer questions about
                  how to use AeliusCase. What would you like to do?
                </p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onLoadMore={handleLoadMore} />
          ))}

          {/* Typing indicator */}
          {isLoading &&
            (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
              <div className="flex items-start gap-3 msg-animate">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #3DC0EC 0%, #6763AC 100%)' }}
                >
                  <i className="ri-sparkling-2-fill text-white text-sm" />
                </div>
                <div className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary-400 typing-dot" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-primary-400 typing-dot" style={{ animationDelay: '200ms' }} />
                    <span className="w-2 h-2 rounded-full bg-accent-400 typing-dot" style={{ animationDelay: '400ms' }} />
                  </div>
                </div>
              </div>
            )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-background-200 bg-background-50 safe-bottom">
        <InputBar
          onSend={handleSend}
          disabled={isLoading}
          autoFocus={isWidget}
          showSuggestions={!isWidget}
        />
      </div>
    </div>
  );
}
