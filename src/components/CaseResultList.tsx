'use client';

import { useState } from 'react';
import type { CaseSearchItem, MainSearchType } from '@/types/case';
import CaseCard from './CaseCard';

interface CaseResultListProps {
  msgId: string;
  toolCallId: string;
  cases: CaseSearchItem[];
  totalRecords: number;
  query: string;
  searchType: MainSearchType;
  page: number;
  hasMorePages: boolean;
  onLoadMore: (
    messageId: string,
    toolCallId: string,
    searchText: string,
    searchType: MainSearchType,
    currentPage: number,
    existingCases: CaseSearchItem[],
  ) => Promise<void>;
}

export default function CaseResultList({
  msgId,
  toolCallId,
  cases,
  totalRecords,
  query,
  searchType,
  page,
  hasMorePages,
  onLoadMore,
}: CaseResultListProps) {
  const [loadingMore, setLoadingMore] = useState(false);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await onLoadMore(msgId, toolCallId, query, searchType, page, cases);
    } catch {
      // existing results remain
    } finally {
      setLoadingMore(false);
    }
  };

  if (cases.length === 0) {
    return (
      <div className="flex justify-start">
        <div className="max-w-xs lg:max-w-md bg-gray-100 text-gray-600 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
          <p className="text-sm italic">
            No cases found for &ldquo;{query}&rdquo;. Try a different name, case number, or keyword.
          </p>
        </div>
      </div>
    );
  }

  const countLabel =
    cases.length < totalRecords
      ? `Showing ${cases.length} of ${totalRecords} results`
      : `Found ${cases.length} case${cases.length !== 1 ? 's' : ''}`;

  return (
    <div className="flex justify-start w-full">
      <div className="w-full">
        <p className="text-xs text-gray-500 mb-2 ml-1">{countLabel}</p>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
          {cases.map((item) => (
            <CaseCard key={item.id} caseItem={item} />
          ))}
        </div>
        {hasMorePages && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="mt-2 w-full text-xs text-blue-600 hover:text-blue-800 font-medium py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore
              ? 'Loading...'
              : `Load more (${totalRecords - cases.length} remaining)`}
          </button>
        )}
      </div>
    </div>
  );
}
