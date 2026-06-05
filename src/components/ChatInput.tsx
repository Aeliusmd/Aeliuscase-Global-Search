'use client';

import { useState, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSubmit: (query: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSubmit, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-200 px-3 py-3 bg-white rounded-b-lg">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          lang="si"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Search for cases..."
          aria-label="Search cases"
          className={cn(
            'flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px]',
            'placeholder-gray-400 text-gray-900',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            'focus-visible:ring-2 focus-visible:ring-blue-500',
            'transition-colors duration-150',
            disabled && 'bg-gray-50 text-gray-400 cursor-not-allowed'
          )}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className={cn(
            'flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center',
            'bg-blue-600 text-white transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
            'hover:bg-blue-700 active:bg-blue-800',
            (disabled || !value.trim()) && 'opacity-50 cursor-not-allowed hover:bg-blue-600'
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
