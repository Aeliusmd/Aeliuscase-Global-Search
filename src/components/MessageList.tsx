'use client';

import { useEffect, useRef } from 'react';
import type { Message } from '@/types/chat';
import { MessageType } from '@/types/chat';
import UserMessage from './UserMessage';
import BotMessage from './BotMessage';
import CaseResultList from './CaseResultList';

interface MessageListProps {
  messages: Message[];
}

export default function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        <div className="flex justify-start">
          <div className="max-w-xs bg-gray-100 text-gray-700 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
            <p className="text-sm leading-relaxed">
              Hello! I can help you search for cases. Type a case name, number, or applicant name to get started.
            </p>
          </div>
        </div>
        <div ref={bottomRef} />
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.map((message) => {
        switch (message.type) {
          case MessageType.USER:
            return <UserMessage key={message.id} text={message.text} />;

          case MessageType.BOT_TEXT:
            return (
              <BotMessage
                key={message.id}
                text={message.text}
                variant={message.variant}
              />
            );

          case MessageType.BOT_ERROR:
            return (
              <BotMessage
                key={message.id}
                text={message.text}
                variant="error"
              />
            );

          case MessageType.BOT_CASES:
            return (
              <CaseResultList
                key={message.id}
                cases={message.cases}
                totalRecords={message.totalRecords}
                query={message.query}
              />
            );

          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </div>
  );
}
