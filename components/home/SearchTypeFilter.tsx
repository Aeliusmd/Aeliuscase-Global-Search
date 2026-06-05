import { MainSearchType } from '@/types/case';

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
    <div className="flex gap-1.5 px-4 py-2.5 border-b border-background-200 bg-background-50 overflow-x-auto flex-shrink-0">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={`px-3 py-2 text-xs rounded-full whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 min-h-[44px] flex items-center ${
            value === opt.value
              ? 'text-white shadow-sm'
              : 'bg-background-100 text-foreground-600 border border-background-200 hover:border-primary-300 hover:text-primary-700'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          style={
            value === opt.value
              ? { background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)' }
              : {}
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
