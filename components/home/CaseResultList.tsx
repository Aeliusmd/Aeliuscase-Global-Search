'use client';

import { useState } from 'react';
import { MainSearchType } from '@/types/case';
import type { CaseSearchItem, PagedApiResponse } from '@/types/case';

interface CaseResultListProps {
  msgId: string;
  toolCallId: string;
  cases: CaseSearchItem[];
  totalRecords: number;
  totalPages: number;
  query: string;
  searchType: MainSearchType;
  page: number;
  hasMorePages: boolean;
  filterType?: string;
  filterValue?: string;
  onLoadMore?: (
    messageId: string,
    toolCallId: string,
    searchText: string,
    searchType: MainSearchType,
    currentPage: number,
    existingCases: CaseSearchItem[],
  ) => Promise<void>;
}

const PAGE_SIZE = 10;

// --- Helpers ---

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatApplicantName(caseItem: CaseSearchItem): string {
  if (!caseItem.caseApplicant) return '—';
  const { firstName, lastName, fullName } = caseItem.caseApplicant;
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (fullName) {
    return fullName
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return '—';
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const base = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap border ';

  if (lower.includes('open') && !lower.includes('sub')) {
    return (
      <span className={base + 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700/40'}>
        {status}
      </span>
    );
  }
  if (lower.includes('close')) {
    return (
      <span className={base + 'bg-background-200 text-foreground-700 border-background-300'}>
        {status}
      </span>
    );
  }
  return (
    <span className={base + 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-700/40'}>
      {status}
    </span>
  );
}

// --- Main component ---

export default function CaseResultList({
  msgId: _msgId,
  toolCallId: _toolCallId,
  cases: initialCases,
  totalRecords: initialTotalRecords,
  totalPages: initialTotalPages,
  query,
  searchType,
  page: initialPage,
  hasMorePages: _initialHasMore,
  filterType,
  filterValue,
}: CaseResultListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [displayedCases, setDisplayedCases] = useState<CaseSearchItem[]>(initialCases);
  const [apiTotalPages, setApiTotalPages] = useState(initialTotalPages);
  const [apiTotalRecords, setApiTotalRecords] = useState(initialTotalRecords);
  const [isNavigating, setIsNavigating] = useState(false);

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ?? '';

  // Derive navigation availability from the current page vs. total pages so that
  // Next re-enables after going Previous (don't trust the stale API hasMorePages flag).
  const hasPrevPage = currentPage > 1;
  const hasNextPage = currentPage < apiTotalPages;

  // Show the exact total reported by the API — no estimation.
  const effectiveTotal = apiTotalRecords;

  const goToPage = async (targetPage: number) => {
    if (isNavigating) return;
    setIsNavigating(true);
    try {
      let url: URL;
      if (filterType && filterValue !== undefined) {
        url = new URL('/api/cases/filter', window.location.origin);
        url.searchParams.set('filterType', filterType);
        url.searchParams.set('filterValue', filterValue);
        url.searchParams.set('page', String(targetPage));
      } else {
        url = new URL('/api/cases/search', window.location.origin);
        url.searchParams.set('searchText', query);
        url.searchParams.set('searchType', String(searchType));
        url.searchParams.set('page', String(targetPage));
        url.searchParams.set('pageSize', String(PAGE_SIZE));
      }
      const res = await fetch(url.toString());
      const data = (await res.json()) as PagedApiResponse<CaseSearchItem>;
      if (!res.ok || !data.succeeded) return;

      // The proxy already filters by status and slices the page, so render the
      // returned rows as-is — re-filtering here would shrink the page below 10
      // and desync it from the totals.
      setCurrentPage(data.page);
      setDisplayedCases(data.data ?? []);
      setApiTotalPages(data.totalPages);
      setApiTotalRecords(data.totalRecords);
    } catch {
      // keep current data on failure
    } finally {
      setIsNavigating(false);
    }
  };

  if (displayedCases.length === 0) {
    return null;
  }

  const navBtnBase =
    'flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400';
  const navBtnActive =
    'border-primary-200 text-primary-700 hover:bg-primary-50 hover:border-primary-300 cursor-pointer dark:border-background-300 dark:text-foreground-400 dark:hover:bg-background-200 dark:hover:border-background-400';
  const navBtnDisabled =
    'border-background-200 text-foreground-400 opacity-40 cursor-not-allowed dark:border-background-300 dark:text-foreground-600';

  return (
    <div className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
      {/* Header bar */}
      <div className="case-result-header flex items-center justify-between gap-3 px-4 py-2 border-b border-background-200">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="w-4 h-4 rounded flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6763AC, #3DC0EC)' }}
          >
            <i className="ri-folder-2-line text-white" style={{ fontSize: '9px' }} />
          </div>
          <span className="text-xs font-semibold text-foreground-700 whitespace-nowrap">
            {effectiveTotal.toLocaleString()} case{effectiveTotal !== 1 ? 's' : ''} found
          </span>
        </div>
        <span className="text-xs font-medium text-foreground-600 whitespace-normal break-words text-right min-w-0 flex-1">
          &ldquo;{query}&rdquo;
        </span>
      </div>

      {/* Table wrapper — dims while navigating */}
      <div className={`transition-opacity duration-200 ${isNavigating ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
        {/* Mobile card list (< sm) */}
        <div className="sm:hidden divide-y divide-background-100">
          {displayedCases.map((item) => {
            const caseDetailUrl = `${appBaseUrl}/dashboard/case-overview/${item.id}`;
            return (
              <div key={item.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono font-bold text-foreground-900 text-sm">{item.caseNumber}</span>
                  <StatusBadge status={item.caseStatusDescription} />
                </div>
                <p className="text-sm font-medium text-foreground-800 leading-snug line-clamp-2 mb-1">
                  {item.caseName || item.caseNumber}
                </p>
                <div className="flex items-center justify-between min-h-[44px]">
                  <span className="text-xs text-foreground-500 mr-2">
                    {formatApplicantName(item)} · {formatDate(item.createdDateTime)}
                  </span>
                  <a
                    href={caseDetailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View case ${item.caseNumber}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold flex-shrink-0"
                    style={{ color: '#6763AC' }}
                  >
                    View <i className="ri-external-link-line text-xs" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table (sm+) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-background-200">
                {['Case #', 'Case Name', 'Applicant', 'Status', 'Date', ''].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-bold text-foreground-600 whitespace-nowrap uppercase tracking-wide"
                    style={{ background: 'oklch(var(--background-100))' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedCases.map((item, idx) => {
                const caseDetailUrl = `${appBaseUrl}/dashboard/case-overview/${item.id}`;
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-background-100 last:border-0 transition-colors duration-100 hover:bg-primary-50 dark:hover:bg-background-300 group"
                    style={isEven ? {} : { background: 'oklch(var(--background-50))' }}
                  >
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-mono font-bold text-foreground-900 text-sm">
                        {item.caseNumber}
                      </span>
                    </td>
                    <td className="px-3 py-3" style={{ maxWidth: '240px' }}>
                      <span
                        className="text-sm font-medium text-foreground-800 leading-snug block"
                        style={{
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {item.caseName || item.caseNumber}
                      </span>
                      {item.caseEmployee?.company && (
                        <span className="text-xs font-medium text-foreground-500 mt-0.5 block truncate">
                          {item.caseEmployee.company}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-sm text-foreground-700">{formatApplicantName(item)}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusBadge status={item.caseStatusDescription} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-xs font-medium text-foreground-600">{formatDate(item.createdDateTime)}</span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <a
                        href={caseDetailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View case ${item.caseNumber}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold transition-all duration-150 hover:gap-1.5"
                        style={{ color: '#6763AC' }}
                      >
                        View
                        <i className="ri-external-link-line text-xs" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-background-200 bg-background-50">
        <div className="flex items-center gap-1.5 text-xs text-foreground-500">
          {isNavigating ? (
            <span className="flex items-center gap-1.5">
              <i className="ri-loader-4-line animate-spin text-primary-400" />
              Loading…
            </span>
          ) : (
            <span>
              Page{' '}
              <span className="font-semibold text-foreground-700">{currentPage}</span>
              {apiTotalPages > 0 && (
                <>
                  {' '}of{' '}
                  <span className="font-semibold text-foreground-700">{apiTotalPages}</span>
                </>
              )}
              <span className="hidden sm:inline text-foreground-400">
                {' '}· {effectiveTotal.toLocaleString()} total
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={!hasPrevPage || isNavigating}
            className={`${navBtnBase} ${!hasPrevPage || isNavigating ? navBtnDisabled : navBtnActive}`}
          >
            <i className="ri-arrow-left-s-line text-sm" />
            Previous
          </button>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={!hasNextPage || isNavigating}
            className={`${navBtnBase} ${!hasNextPage || isNavigating ? navBtnDisabled : navBtnActive}`}
          >
            Next
            <i className="ri-arrow-right-s-line text-sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
