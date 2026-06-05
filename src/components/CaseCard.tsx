import type { CaseSearchItem } from '@/types/case';
import { cn } from '@/lib/utils';

interface CaseCardProps {
  caseItem: CaseSearchItem;
}

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

function formatApplicantName(caseItem: CaseSearchItem): string | null {
  if (!caseItem.caseApplicant) return null;
  const { firstName, lastName, fullName } = caseItem.caseApplicant;
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  if (fullName) {
    return fullName
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const classes = cn(
    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
    lower.includes('open') && 'bg-green-100 text-green-800',
    lower.includes('close') && 'bg-gray-100 text-gray-600',
    !lower.includes('open') && !lower.includes('close') && 'bg-amber-100 text-amber-800'
  );
  return <span className={classes}>{status}</span>;
}

export default function CaseCard({ caseItem }: CaseCardProps) {
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ?? '';
  const caseDetailUrl = `${appBaseUrl}/dashboard/case-overview/${caseItem.id}`;
  const applicantName = formatApplicantName(caseItem);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-150">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-bold text-gray-900 font-mono">{caseItem.caseNumber}</span>
        <StatusBadge status={caseItem.caseStatusDescription} />
      </div>

      <p className="text-sm font-medium text-gray-800 mb-1.5 line-clamp-2 leading-snug">
        {caseItem.caseName || caseItem.caseNumber}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
        {applicantName && (
          <span className="text-xs text-gray-500">
            <span className="text-gray-400">Applicant:</span> {applicantName}
          </span>
        )}
        {caseItem.caseType && (
          <span className="text-xs text-gray-500">
            <span className="text-gray-400">Type:</span> {caseItem.caseType}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-100 min-h-[44px]">
        <span className="text-xs text-gray-400">{formatDate(caseItem.createdDateTime)}</span>
        <a
          href={caseDetailUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View case ${caseItem.caseNumber}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          View Case
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
