'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { MainSearchType } from '@/types/case';
import type { CaseSearchItem, PagedApiResponse, SearchToolOutput } from '@/types/case';
import MessageList, { type OnLoadMore } from './MessageList';
import ChatInput from './ChatInput';
import SearchTypeFilter from './SearchTypeFilter';

const STORAGE_KEY = 'aelius_chat_v2';

interface ChatPanelProps {
  onClose: () => void;
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const [searchType, setSearchType] = useState<MainSearchType>(MainSearchType.AllCases);
  const [hydrated, setHydrated] = useState(false);

  // Ref so the transport closure always reads the latest filter without needing to recreate the transport
  const searchTypeRef = useRef<MainSearchType>(MainSearchType.AllCases);
  searchTypeRef.current = searchType;

  // Create transport once — body is a function (Resolvable<object>) that reads the live ref
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({ searchTypeHint: searchTypeRef.current }),
      }),
  );

  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as UIMessage[];
        if (stored.length > 0) setMessages(stored);
      }
    } catch {}
    setHydrated(true);
  }, [setMessages]);

  // Persist whenever messages change (skip initial empty render before hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100)));
    } catch {}
  }, [messages, hydrated]);

  const handleSubmit = useCallback(
    (query: string) => {
      sendMessage({ text: query });
    },
    [sendMessage],
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [setMessages]);

  const handleLoadMore: OnLoadMore = useCallback(
    async (messageId, toolCallId, searchText, msgSearchType, currentPage, existingCases) => {
      const url = new URL('/api/cases/search', window.location.origin);
      url.searchParams.set('searchText', searchText);
      url.searchParams.set('searchType', String(msgSearchType));
      url.searchParams.set('page', String(currentPage + 1));
      url.searchParams.set('pageSize', '20');

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

  return (
    <div className="fixed bottom-20 left-2 right-2 xs:left-auto xs:right-6 z-40 w-auto xs:w-96 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-6rem)] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white rounded-t-2xl flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold">Case Search</h2>
          <p className="text-xs text-blue-200">Powered by AI + Aeliuscase API</p>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              aria-label="Clear chat history"
              title="Clear history"
              className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-blue-700 active:bg-blue-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close chat panel"
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-blue-700 active:bg-blue-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter */}
      <SearchTypeFilter value={searchType} onChange={setSearchType} disabled={isLoading} />

      {/* Messages */}
      <MessageList messages={messages} isLoading={isLoading} onLoadMore={handleLoadMore} />

      {/* Input */}
      <ChatInput onSubmit={handleSubmit} disabled={isLoading} />
    </div>
  );
}
