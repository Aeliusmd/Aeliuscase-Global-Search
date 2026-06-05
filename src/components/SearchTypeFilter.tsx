import { MainSearchType } from '@/types/case';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: MainSearchType.AllCases, label: 'All Cases' },
  { value: MainSearchType.OpenCases, label: 'Open' },
  { value: MainSearchType.ClosedCases, label: 'Closed' },
  { value: MainSearchType.SubOutCases, label: 'Sub-Out' },
] as const;

interface SearchTypeFilterProps {
  value: MainSearchType;
  onChange: (type: MainSearchType) => void;
  disabled?: boolean;
}

export default function SearchTypeFilter({ value, onChange, disabled }: SearchTypeFilterProps) {
  return (
    <div className="flex gap-1.5 px-3 py-2 border-b border-gray-100 bg-gray-50 overflow-x-auto flex-shrink-0">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={cn(
            'px-3 py-2 text-xs rounded-full whitespace-nowrap font-medium transition-colors min-h-[44px] flex items-center',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
            value === opt.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
