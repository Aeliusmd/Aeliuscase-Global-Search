'use client';

import { useState, useCallback, useEffect } from 'react';
import Sidebar from '@/components/home/Sidebar';
import ChatArea from '@/components/home/ChatArea';
import type { ConversationMeta } from '@/types/conversation';

type WidgetView = 'closed' | 'compact' | 'maximized';

function generateId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export default function Home() {
  const [activeId, setActiveId] = useState('');
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [pendingNewId, setPendingNewId] = useState(generateId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [widgetView, setWidgetView] = useState<WidgetView>('closed');

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

  const handleToggleWidget = useCallback(() => {
    setWidgetView((view) => (view === 'compact' ? 'closed' : 'compact'));
  }, []);

  const handleCloseWidget = useCallback(() => {
    setWidgetView('closed');
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (widgetView === 'closed') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCloseWidget();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseWidget, widgetView]);

  const isWidgetVisible = widgetView !== 'closed';
  const isMaximized = widgetView === 'maximized';

  return (
    <div
      className={`${isMaximized ? 'flex h-screen overflow-hidden' : 'min-h-screen'} bg-background-50`}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      <div
        className={isMaximized && sidebarOpen ? 'fixed inset-0 z-40 bg-black/40 md:hidden' : 'hidden'}
        onClick={() => setSidebarOpen(false)}
      />
      <div className={isMaximized ? 'contents' : 'hidden'}>
        <Sidebar
          activeId={activeId}
          conversations={conversations}
          onSelect={handleSelect}
          onNewChat={handleNewChat}
          onDelete={handleDeleteConversation}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </div>
      {isWidgetVisible && (
        <section
          className={
            isMaximized
              ? 'flex-1 min-w-0 h-full'
              : 'fixed bottom-24 right-4 z-[9998] h-[min(680px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-2xl shadow-primary-900/20 sm:right-6'
          }
          aria-label="Aeliuscase AI chat"
        >
          <ChatArea
            key={chatKey}
            conversationTitle={isNew ? 'New Conversation' : conversationTitle}
            conversationId={chatKey}
            isNew={isNew}
            variant={isMaximized ? 'full' : 'widget'}
            onFirstMessage={handleFirstMessage}
            onUpdateTitle={handleUpdateTitle}
            onToggleSidebar={handleToggleSidebar}
            onMaximize={() => setWidgetView('maximized')}
            onMinimize={() => {
              setSidebarOpen(false);
              setWidgetView('compact');
            }}
            onClose={handleCloseWidget}
          />
        </section>
      )}

      {!isMaximized && (
        <button
          type="button"
          onClick={handleToggleWidget}
          className="fixed bottom-5 right-4 z-[9999] flex h-16 w-16 items-center justify-center rounded-full text-white shadow-xl shadow-primary-900/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:right-6"
          style={{ background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }}
          aria-label={widgetView === 'compact' ? 'Close Aeliuscase AI chat' : 'Open Aeliuscase AI chat'}
          aria-expanded={widgetView === 'compact'}
        >
          <span
            className="absolute inset-0 rounded-full opacity-60"
            style={{ boxShadow: '0 0 0 8px rgba(103,99,172,0.10)' }}
            aria-hidden="true"
          />
          <i className={`${widgetView === 'compact' ? 'ri-close-line' : 'ri-chat-3-fill'} relative text-2xl`} />
        </button>
      )}
    </div>
  );
}
