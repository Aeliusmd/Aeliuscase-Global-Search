'use client';

import { useEffect, useState, useRef, type KeyboardEvent } from 'react';

interface InputBarProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  showSuggestions?: boolean;
}

const SUGGESTIONS = [
  { label: 'Search all cases',     icon: 'ri-search-line' },
  { label: 'Find open cases',      icon: 'ri-folder-open-line' },
  { label: 'Find closed cases',    icon: 'ri-archive-line' },
  { label: 'Search by case number',icon: 'ri-hashtag' },
];

export default function InputBar({
  onSend,
  disabled,
  autoFocus = false,
  showSuggestions = true,
}: InputBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus || disabled) return;

    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [autoFocus, disabled]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={showSuggestions ? 'px-4 sm:px-6 py-4' : 'px-4 py-3'}>
      {/* Suggestion chips */}
      {showSuggestions && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setValue(s.label);
                textareaRef.current?.focus();
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 min-h-[44px] rounded-full text-xs font-semibold
                bg-primary-50 border border-primary-200 text-primary-700
                hover:bg-primary-100 hover:border-primary-400 hover:text-primary-800 hover:shadow-sm
                dark:bg-background-100 dark:border-background-300 dark:text-foreground-400
                dark:hover:bg-background-200 dark:hover:border-background-400 dark:hover:text-foreground-300
                transition-all duration-150 cursor-pointer whitespace-nowrap
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <i className={`${s.icon} text-[11px] opacity-70`} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Input container — gradient border ring */}
      <div
        className="relative flex items-center gap-2 rounded-2xl px-3 py-2 transition-all duration-300"
        style={
          focused
            ? {
                background: 'oklch(var(--background-50))',
                boxShadow:
                  '0 0 0 2px #6763AC, 0 0 0 5px rgba(103,99,172,0.14), 0 8px 32px rgba(103,99,172,0.16)',
              }
            : {
                background: 'oklch(var(--background-50))',
                boxShadow:
                  '0 0 0 1.5px rgba(103,99,172,0.45), 0 4px 16px rgba(103,99,172,0.07)',
              }
        }
      >
        {/* Decorative gradient top-accent line */}
        <div
          className="absolute top-0 inset-x-8 h-px rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(103,99,172,0.6) 30%, rgba(61,192,236,0.6) 70%, transparent)',
            opacity: focused ? 0.9 : 0.5,
            transition: 'opacity 0.3s',
          }}
        />

        {/* Attach button */}
        <button
          className="w-11 h-11 flex items-center justify-center rounded-lg
            hover:bg-primary-50 dark:hover:bg-background-200
            transition-colors cursor-pointer flex-shrink-0
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          title="Attach file"
          aria-label="Attach file"
        >
          <i className="ri-attachment-2 text-primary-400 dark:text-primary-500 text-base" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search cases or ask how to use AeliusCase…"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-foreground-900 placeholder-secondary-400 dark:placeholder-foreground-600 outline-none leading-relaxed min-h-[24px] max-h-[160px] overflow-y-auto"
          style={{ fontFamily: 'var(--font-body)' }}
        />

        {/* Send button — gradient always present, dims when disabled */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
          className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 flex-shrink-0
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1
            ${canSend ? 'cursor-pointer hover:scale-105 shadow-md' : 'cursor-not-allowed opacity-35'}`}
          style={{
            background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)',
            boxShadow: canSend ? '0 3px 12px rgba(103,99,172,0.45)' : 'none',
          }}
        >
          <i className="ri-send-plane-fill text-sm text-white" />
        </button>
      </div>

      <p className="text-center text-xs text-secondary-400 dark:text-foreground-600 mt-2.5">
        Aeliuscase AI can make mistakes. Verify critical case information independently.
      </p>
    </div>
  );
}
