'use client';

import { useState } from 'react';
import type { CaseSearchItem, MainSearchType } from '@/types/case';

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
  let style: React.CSSProperties = {};
  let cls = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ';

  if (lower.includes('open')) {
    cls += 'text-emerald-800';
    style = { background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.4)' };
  } else if (lower.includes('close')) {
    cls += 'text-foreground-700';
    style = { background: 'oklch(var(--background-200))', border: '1px solid oklch(var(--background-300))' };
  } else {
    cls += 'text-amber-800';
    style = { background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.4)' };
  }

  return <span className={cls} style={style}>{status}</span>;
}

// --- Main component ---

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
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ?? '';

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
      <div className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <p className="text-sm text-foreground-600 italic">
          No cases found for &ldquo;{query}&rdquo;. Try a different name, case number, or keyword.
        </p>
      </div>
    );
  }

  const showing = cases.length;
  const countLabel =
    showing < totalRecords
      ? `Showing ${showing} of ${totalRecords} results`
      : `${showing} case${showing !== 1 ? 's' : ''} found`;

  return (
    <div className="bg-background-50 border border-background-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-background-200"
        style={{ background: 'linear-gradient(135deg, oklch(var(--primary-50)) 0%, oklch(var(--accent-50)) 100%)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6763AC, #3DC0EC)' }}
          >
            <i className="ri-folder-2-line text-white" style={{ fontSize: '9px' }} />
          </div>
          <span className="text-xs font-semibold text-foreground-700">{countLabel}</span>
        </div>
        <span className="text-xs font-medium text-foreground-600 truncate max-w-[160px]">
          &ldquo;{query}&rdquo;
        </span>
      </div>

      {/* Mobile card list (< sm) */}
      <div className="sm:hidden divide-y divide-background-100">
        {cases.map((item) => {
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
            {cases.map((item, idx) => {
              const caseDetailUrl = `${appBaseUrl}/dashboard/case-overview/${item.id}`;
              const isEven = idx % 2 === 0;

              return (
                <tr
                  key={item.id}
                  className="border-b border-background-100 last:border-0 transition-colors duration-100 hover:bg-primary-50 group"
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

      {/* Load more */}
      {hasMorePages && (
        <div className="px-4 py-2.5 border-t border-background-200 bg-background-50">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full text-xs font-medium py-2.5 rounded-lg border border-primary-200 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-primary-50 min-h-[44px]"
            style={{ color: '#6763AC' }}
          >
            {loadingMore
              ? 'Loading…'
              : `Load more · ${totalRecords - cases.length} remaining`}
          </button>
        </div>
      )}
    </div>
  );
}
