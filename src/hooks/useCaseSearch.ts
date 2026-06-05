'use client';

import { useState, useCallback } from 'react';
import { searchCases, ApiError } from '@/api/searchCases';
import { MainSearchType } from '@/types/case';
import type { CaseSearchItem } from '@/types/case';

interface SearchResult {
  cases: CaseSearchItem[];
  totalRecords: number;
  hasMorePages: boolean;
  page: number;
}

interface SearchError {
  message: string;
  isAuthError: boolean;
  isNetworkError: boolean;
  isConfigError: boolean;
}

export function useCaseSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);

  const search = useCallback(async (
    query: string,
    searchType: MainSearchType = MainSearchType.AllCases,
    page: number = 1,
  ): Promise<SearchResult> => {
    setLoading(true);
    setError(null);

    try {
      const result = await searchCases({
        searchText: query,
        searchType,
        page,
        pageSize: 20,
      });
      return {
        cases: result.data ?? [],
        totalRecords: result.totalRecords,
        hasMorePages: result.hasMorePages,
        page: result.page,
      };
    } catch (err) {
      const isAuth = err instanceof ApiError && err.isAuthError;
      const isNetwork = err instanceof ApiError && err.status === 0;
      const isConfig = err instanceof ApiError && err.status === 500;
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';

      const searchError: SearchError = {
        message,
        isAuthError: isAuth,
        isNetworkError: isNetwork,
        isConfigError: isConfig,
      };
      setError(searchError);
      throw searchError;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, search };
}
