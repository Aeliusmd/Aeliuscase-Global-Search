'use client';

import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import type { CaseSearchItem, MainSearchType, SearchToolOutput } from '@/types/case';
import UserMessage from './UserMessage';
import BotMessage from './BotMessage';
import CaseResultList from './CaseResultList';

export type OnLoadMore = (
  messageId: string,
  toolCallId: string,
  searchText: string,
  searchType: MainSearchType,
  currentPage: number,
  existingCases: CaseSearchItem[],
) => Promise<void>;

// AI SDK 6.x tool part shape for 'tool-${toolName}'
interface ToolPart {
  type: string; // 'tool-searchCases' | 'tool-...'
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string;
  input?: { searchText?: string; searchType?: number; page?: number };
  output?: SearchToolOutput;
  errorText?: string;
}

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  onLoadMore: OnLoadMore;
}

export default function MessageList({ messages, isLoading, onLoadMore }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.length === 0 && !isLoading && (
        <div className="flex justify-start">
          <div className="max-w-xs bg-gray-100 text-gray-700 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
            <p className="text-sm leading-relaxed">
              Hello! I can help you search for cases. Type a case name, number, or applicant name to get started.
            </p>
          </div>
        </div>
      )}

      {messages.map((message) => {
        if (message.role === 'user') {
          const textPart = message.parts?.find((p) => p.type === 'text') as
            | { type: 'text'; text: string }
            | undefined;
          return <UserMessage key={message.id} text={textPart?.text ?? ''} />;
        }

        if (message.role === 'assistant') {
          return (
            <div key={message.id} className="space-y-2">
              {message.parts?.map((rawPart, idx) => {
                // Text part
                if (rawPart.type === 'text') {
                  const p = rawPart as { type: 'text'; text: string };
                  if (!p.text.trim()) return null;
                  return (
                    <BotMessage
                      key={`${message.id}-t${idx}`}
                      text={p.text}
                      variant="default"
                    />
                  );
                }

                // Tool part — AI SDK 6.x: type is 'tool-{toolName}'
                if (rawPart.type === 'tool-searchCases') {
                  const part = rawPart as unknown as ToolPart;

                  if (part.state === 'input-streaming' || part.state === 'input-available') {
                    return (
                      <div
                        key={`${message.id}-tc${idx}`}
                        className="flex items-center gap-2 text-xs text-blue-600 py-1"
                      >
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>
                          Searching for &ldquo;{part.input?.searchText ?? '...'}&rdquo;
                        </span>
                      </div>
                    );
                  }

                  if (part.state === 'output-available' && part.output) {
                    const result = part.output;
                    if (!result.success) {
                      return (
                        <BotMessage
                          key={`${message.id}-tr${idx}`}
                          text={result.error ?? 'Search failed.'}
                          variant="error"
                        />
                      );
                    }
                    return (
                      <CaseResultList
                        key={`${message.id}-tr${idx}`}
                        msgId={message.id}
                        toolCallId={part.toolCallId}
                        cases={result.cases}
                        totalRecords={result.totalRecords}
                        query={result.searchText}
                        searchType={result.searchType as MainSearchType}
                        page={result.page}
                        hasMorePages={result.hasMorePages}
                        onLoadMore={onLoadMore}
                      />
                    );
                  }
                }

                return null;
              })}
            </div>
          );
        }

        return null;
      })}

      {/* Typing indicator while waiting for first response */}
      {isLoading &&
        (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

      <div ref={bottomRef} />
    </div>
  );
}
