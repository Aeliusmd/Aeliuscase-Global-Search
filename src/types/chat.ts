import type { CaseSearchItem, MainSearchType } from './case';

export enum MessageType {
  USER = 'USER',
  BOT_TEXT = 'BOT_TEXT',
  BOT_CASES = 'BOT_CASES',
  BOT_ERROR = 'BOT_ERROR',
}

interface BaseMessage {
  id: string;
  timestamp: Date;
  type: MessageType;
}

export interface UserMessage extends BaseMessage {
  type: MessageType.USER;
  text: string;
}

export interface BotTextMessage extends BaseMessage {
  type: MessageType.BOT_TEXT;
  text: string;
  variant: 'default' | 'loading';
}

export interface BotErrorMessage extends BaseMessage {
  type: MessageType.BOT_ERROR;
  text: string;
  isAuthError: boolean;
}

export interface BotCasesMessage extends BaseMessage {
  type: MessageType.BOT_CASES;
  cases: CaseSearchItem[];
  totalRecords: number;
  query: string;
  searchType: MainSearchType;
  page: number;
  hasMorePages: boolean;
}

export type Message = UserMessage | BotTextMessage | BotErrorMessage | BotCasesMessage;
