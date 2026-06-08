'use client';

import { useState, useCallback, useEffect } from 'react';
import Sidebar from '@/components/home/Sidebar';
import ChatArea from '@/components/home/ChatArea';
import type { ConversationMeta } from '@/types/conversation';

function generateId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export default function Home() {
  const [activeId, setActiveId] = useState('');
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [pendingNewId, setPendingNewId] = useState(generateId);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load conversation list from DB on mount
  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(({ data }: { data: Array<{ _id: string; title: string; preview: string; timestamp: string; pinned?: boolean }> }) => {
        if (Array.isArray(data) && data.length > 0) {
          setConversations(
            data.map((d) => ({
              id: d._id,
              title: d.title,
              preview: d.preview,
              timestamp: d.timestamp,
              pinned: d.pinned ?? false,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const isNew = activeId === '';
  const activeConv = conversations.find((c) => c.id === activeId);
  const conversationTitle = activeConv?.title ?? 'New Conversation';

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
      const newConv: ConversationMeta = {
        id: pendingNewId,
        title,
        preview: title,
        timestamp: 'Just now',
        pinned: false,
      };
      // Optimistic UI — add to list immediately
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(pendingNewId);
      // Persist to DB
      fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingNewId, title, preview: title }),
      }).catch(() => {});
    },
    [pendingNewId],
  );

  const handleUpdateTitle = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title, preview: title } : c)),
    );
    fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const handleDeleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveId((prev) => (prev === id ? '' : prev));
    setPendingNewId((prev) => (prev === id ? generateId() : prev));
    fetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-background-50"
      style={{ fontFamily: 'var(--font-body)' }}
    >
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
