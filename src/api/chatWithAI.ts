import { MainSearchType } from '@/types/case';
import type { CaseSearchItem } from '@/types/case';
import { ApiError } from './searchCases';

export interface AIChatResult {
  text: string;
  cases: CaseSearchItem[];
  totalRecords: number;
  hasMorePages: boolean;
  page: number;
  query: string;
  searchType: MainSearchType;
}

interface ChatRouteResponse {
  text?: string;
  cases?: CaseSearchItem[];
  totalRecords?: number;
  hasMorePages?: boolean;
  page?: number;
  query?: string;
  searchType?: MainSearchType;
  error?: string;
  isAuthError?: boolean;
  isNetworkError?: boolean;
  isConfigError?: boolean;
}

export async function chatWithAI(
  message: string,
  searchType: MainSearchType,
): Promise<AIChatResult> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, searchType }),
    });
  } catch {
    throw new ApiError(0, false, 'Network error: could not reach the server.');
  }

  const data = (await response.json()) as ChatRouteResponse;

  if (!response.ok) {
    const err = new ApiError(response.status, data.isAuthError ?? false, data.error ?? undefined);
    const extErr = err as ApiError & { isNetworkError?: boolean; isConfigError?: boolean };
    extErr.isNetworkError = data.isNetworkError ?? false;
    extErr.isConfigError = data.isConfigError ?? response.status === 500;
    throw err;
  }

  return {
    text: data.text ?? '',
    cases: data.cases ?? [],
    totalRecords: data.totalRecords ?? 0,
    hasMorePages: data.hasMorePages ?? false,
    page: data.page ?? 1,
    query: data.query ?? message,
    searchType: data.searchType ?? searchType,
  };
}
