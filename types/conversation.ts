import type { UIMessage } from 'ai';

export interface ConversationDoc {
  _id: string;
  title: string;
  preview: string;
  timestamp: string;
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
  timestamp: string;
  pinned?: boolean;
}
