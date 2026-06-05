'use client';

import { cn } from '@/lib/utils';

interface FloatingButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

export default function FloatingButton({ isOpen, onClick }: FloatingButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={isOpen ? 'Close case search' : 'Open case search'}
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      className={cn(
        'fixed right-6 z-50',
        'w-14 h-14 rounded-full shadow-lg',
        'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
        'text-white',
        'flex items-center justify-center',
        'transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'
      )}
    >
      {isOpen ? (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          />
        </svg>
      )}
    </button>
  );
}
