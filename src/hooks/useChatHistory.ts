'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message } from '@/types/chat';

const STORAGE_KEY = 'aelius_chat_history';
const MAX_STORED = 100;

export function useChatHistory() {
  const [messages, setMessages] = useState<Message[]>([]);
  const isFirstRender = useRef(true);

  // Load from localStorage once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Omit<Message, 'timestamp'> & { timestamp: string }>;
        setMessages(parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })) as Message[]);
      }
    } catch {
      // corrupt storage — start fresh
    }
  }, []);

  // Persist to localStorage on every change (skip the initial render to avoid overwriting)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch {
      // quota exceeded
    }
  }, [messages]);

  const append = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const replace = useCallback((id: string, message: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? message : m)));
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  return { messages, append, replace, clear };
}
