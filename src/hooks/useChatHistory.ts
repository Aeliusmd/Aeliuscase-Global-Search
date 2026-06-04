'use client';

import { useState, useCallback } from 'react';
import type { Message } from '@/types/chat';

export function useChatHistory() {
  const [messages, setMessages] = useState<Message[]>([]);

  const append = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const replace = useCallback((id: string, message: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? message : m)));
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, append, replace, clear };
}
