'use client';

import { useState, useCallback, useEffect } from 'react';
import Sidebar from '@/components/home/Sidebar';
import ChatArea from '@/components/home/ChatArea';
import { type Conversation } from '@/mocks/chatData';

const CONV_STORAGE_KEY = 'aelius_conversations';

function generateId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export default function Home() {
  const [activeId, setActiveId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingNewId, setPendingNewId] = useState(generateId);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONV_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Conversation[];
        if (stored.length > 0) setConversations(stored);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (conversations.length === 0) return;
    try {
      localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(conversations.slice(0, 50)));
    } catch {}
  }, [conversations]);

  const isNew = activeId === '';
  const activeConv = conversations.find((c) => c.id === activeId);
  const conversationTitle = activeConv?.title ?? 'New Conversation';

  // Stable key: pendingNewId before first message, activeId after — same value, no remount
  const chatKey = isNew ? pendingNewId : activeId;

  const handleNewChat = useCallback(() => {
    setActiveId('');
    setPendingNewId(generateId());
    setSidebarOpen(false);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  const handleFirstMessage = useCallback(
    (title: string) => {
      setConversations((prev) => [
        { id: pendingNewId, title, preview: title, timestamp: 'Just now' },
        ...prev,
      ]);
      setActiveId(pendingNewId);
    },
    [pendingNewId],
  );

  const handleUpdateTitle = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title, preview: title } : c)),
    );
  }, []);

  const handleDeleteConversation = useCallback((id: string) => {
    // Remove the session's messages from localStorage
    try { localStorage.removeItem(`aelius_chat_${id}`); } catch {}
    setConversations((prev) => prev.filter((c) => c.id !== id));
    // If the deleted session was open, go back to a fresh new chat
    setActiveId((prev) => (prev === id ? '' : prev));
    setPendingNewId((prev) => (prev === id ? generateId() : prev));
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-background-50"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar
        activeId={activeId}
        conversations={conversations}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatArea
        key={chatKey}
        conversationTitle={isNew ? 'New Conversation' : conversationTitle}
        conversationId={chatKey}
        isNew={isNew}
        onFirstMessage={handleFirstMessage}
        onUpdateTitle={handleUpdateTitle}
        onToggleSidebar={handleToggleSidebar}
      />
    </div>
  );
}
