import type { CaseSearchItem } from '@/types/case';

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
  if (firstName && lastName) return `${firstName} ${lastName}`;
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
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ';

  if (lower.includes('open')) {
    return (
      <span className={base + 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700/40'}>
        {status}
      </span>
    );
  }
  if (lower.includes('close')) {
    return (
      <span className={base + 'bg-background-100 text-secondary-600 border-background-300'}>
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

export default function CaseCard({ caseItem }: CaseCardProps) {
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ?? '';
  const caseDetailUrl = `${appBaseUrl}/dashboard/case-overview/${caseItem.id}`;
  const applicantName = formatApplicantName(caseItem);

  return (
    <div className="bg-background-50 border border-background-200 rounded-xl p-3 hover:border-primary-200 hover:shadow-sm transition-all duration-150">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-xs font-bold text-foreground-900 font-mono">{caseItem.caseNumber}</span>
        <StatusBadge status={caseItem.caseStatusDescription} />
      </div>

      <p className="text-sm font-medium text-foreground-800 mb-1.5 line-clamp-2 leading-snug">
        {caseItem.caseName || caseItem.caseNumber}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
        {applicantName && (
          <span className="text-xs text-foreground-500">
            <span className="text-secondary-400">Applicant:</span> {applicantName}
          </span>
        )}
        {caseItem.caseType && (
          <span className="text-xs text-foreground-500">
            <span className="text-secondary-400">Type:</span> {caseItem.caseType}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-background-200">
        <span className="text-xs text-secondary-400">{formatDate(caseItem.createdDateTime)}</span>
        <a
          href={caseDetailUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View case ${caseItem.caseNumber}`}
          className="inline-flex items-center gap-1 text-xs font-medium transition-colors min-h-[44px] px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
          style={{ color: '#6763AC' }}
        >
          View Case
          <i className="ri-external-link-line text-xs" />
        </a>
      </div>
    </div>
  );
}
