import type { CaseSearchItem } from '@/types/case';
import CaseCard from './CaseCard';

interface CaseResultListProps {
  cases: CaseSearchItem[];
  totalRecords: number;
  query: string;
}

export default function CaseResultList({ cases, totalRecords, query }: CaseResultListProps) {
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
      <div className="w-full max-w-sm">
        <p className="text-xs text-gray-500 mb-2 ml-1">{countLabel}</p>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
          {cases.map((item) => (
            <CaseCard key={item.id} caseItem={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
