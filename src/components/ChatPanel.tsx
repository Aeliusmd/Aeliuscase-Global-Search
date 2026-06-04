'use client';

import { useCallback } from 'react';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import { MessageType } from '@/types/chat';
import {
  ERR_JWT_EXPIRED,
  ERR_NETWORK,
  ERR_API,
  ERR_CONFIG,
  emptyResultsMessage,
} from '@/lib/errorMessages';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

interface ChatPanelProps {
  onClose: () => void;
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, append, replace } = useChatHistory();
  const { loading, search } = useCaseSearch();

  const handleSubmit = useCallback(
    async (query: string) => {
      const userMsgId = crypto.randomUUID();
      const loadingId = crypto.randomUUID();

      append({
        id: userMsgId,
        type: MessageType.USER,
        text: query,
        timestamp: new Date(),
      });

      append({
        id: loadingId,
        type: MessageType.BOT_TEXT,
        text: '',
        variant: 'loading',
        timestamp: new Date(),
      });

      try {
        const { cases, totalRecords } = await search(query);

        if (cases.length === 0) {
          replace(loadingId, {
            id: loadingId,
            type: MessageType.BOT_TEXT,
            text: emptyResultsMessage(query),
            variant: 'default',
            timestamp: new Date(),
          });
        } else {
          replace(loadingId, {
            id: loadingId,
            type: MessageType.BOT_CASES,
            cases,
            totalRecords,
            query,
            timestamp: new Date(),
          });
        }
      } catch (err: unknown) {
        const e = err as { isAuthError?: boolean; isNetworkError?: boolean; isConfigError?: boolean };
        let errorText = ERR_API;
        let isAuthError = false;

        if (e?.isAuthError) {
          errorText = ERR_JWT_EXPIRED;
          isAuthError = true;
        } else if (e?.isNetworkError) {
          errorText = ERR_NETWORK;
        } else if (e?.isConfigError) {
          errorText = ERR_CONFIG;
        }

        replace(loadingId, {
          id: loadingId,
          type: MessageType.BOT_ERROR,
          text: errorText,
          isAuthError,
          timestamp: new Date(),
        });
      }
    },
    [append, replace, search]
  );

  return (
    <div className="fixed bottom-24 right-6 z-40 w-96 max-h-[calc(100vh-8rem)] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white rounded-t-2xl flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold">Case Search</h2>
          <p className="text-xs text-blue-200">Powered by Aeliuscase API</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat panel"
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-blue-700 active:bg-blue-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      <ChatInput onSubmit={handleSubmit} disabled={loading} />
    </div>
  );
}
