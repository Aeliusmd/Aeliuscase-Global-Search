import type { UIMessage } from 'ai';

export interface ConversationDoc {
  _id: string;
  title: string;
  preview: string;
  pinned: boolean;
  messages: UIMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Sidebar-compatible shape (no messages, matches mocks/chatData Conversation type)
export interface ConversationMeta {
  id: string;
  title: string;
  preview: string;
  /** ISO timestamp — the sidebar formats this to a relative label ("5m ago") at render time. */
  updatedAt: string;
  pinned?: boolean;
}
