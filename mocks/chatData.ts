export type MessageRole = 'user' | 'assistant';

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  pinned?: boolean;
}
