'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/home/Sidebar';
import ChatArea from '@/components/home/ChatArea';
import type { ConversationMeta } from '@/types/conversation';
import { isAllowedOrigin } from '@/lib/auth/origins';
import type { EmbedView } from '@/lib/embed/viewState';
import { postChatViewChanged, postReady } from '@/lib/embed/viewState';
import { syncEmbedModeToUrl } from '@/lib/embed/syncModeUrl';

function generateId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export default function EmbedPageClient() {
  const [activeId, setActiveId] = useState('');
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [pendingNewId, setPendingNewId] = useState(generateId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<EmbedView>('compact');

  useEffect(() => {
    syncEmbedModeToUrl('compact');
    postReady();
    postChatViewChanged('compact');
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (view !== 'closed') postChatViewChanged(view);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [view]);

  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(({ data }: { data: Array<{ _id: string; title: string; preview: string; updatedAt: string; pinned?: boolean }> }) => {
        if (Array.isArray(data) && data.length > 0) {
          setConversations(
            data.map((d) => ({
              id: d._id,
              title: d.title,
              preview: d.preview,
              updatedAt: d.updatedAt,
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
  const isMaximized = view === 'maximized';

  const setViewAndNotify = useCallback((next: EmbedView) => {
    setView(next);
    if (next === 'compact' || next === 'maximized') {
      syncEmbedModeToUrl(next);
    }
    postChatViewChanged(next);
  }, []);

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
        updatedAt: new Date().toISOString(),
        pinned: false,
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(pendingNewId);
      fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingNewId, title, preview: title }),
      }).catch(() => {});
    },
    [pendingNewId],
  );

  const handleConversationActivity = useCallback((id: string) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const bumped: ConversationMeta = { ...prev[idx], updatedAt: new Date().toISOString() };
      return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

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

  const handleClose = useCallback(() => {
    setSidebarOpen(false);
    setViewAndNotify('closed');
  }, [setViewAndNotify]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin)) return;
      if (event.data?.type === 'OPEN_CHAT') {
        setViewAndNotify('compact');
      }
      if (event.data?.type === 'REQUEST_CLOSE') {
        setSidebarOpen(false);
        setViewAndNotify('closed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setViewAndNotify]);

  useEffect(() => {
    if (view === 'closed') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, view]);

  if (view === 'closed') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-4">
        <p className="text-sm text-foreground-600">Chat closed</p>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full w-full bg-transparent ${isMaximized ? 'overflow-hidden' : ''}`}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {isMaximized && (
        <Sidebar
          activeId={activeId}
          conversations={conversations}
          onSelect={handleSelect}
          onNewChat={handleNewChat}
          onDelete={handleDeleteConversation}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <section
        className={
          isMaximized
            ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-2xl shadow-primary-900/20'
            : 'flex h-full w-full flex-col overflow-hidden rounded-lg border border-background-200 bg-background-50 shadow-2xl shadow-primary-900/20'
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
          onConversationActivity={handleConversationActivity}
          onToggleSidebar={handleToggleSidebar}
          onMaximize={() => {
            setSidebarOpen(false);
            setViewAndNotify('maximized');
          }}
          onMinimize={() => {
            setSidebarOpen(false);
            setViewAndNotify('compact');
          }}
          onClose={handleClose}
        />
      </section>
    </div>
  );
}
