'use client';

import { useState, useRef, type KeyboardEvent } from 'react';

interface InputBarProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const SUGGESTIONS = [
  'Search all cases',
  'Find open cases',
  'Find closed cases',
  'Search by case number',
];

export default function InputBar({ onSend, disabled }: InputBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    <div className="px-4 py-4">
      {/* Suggestion chips */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setValue(s);
              textareaRef.current?.focus();
            }}
            className="px-3 py-1 rounded-full text-xs font-medium border border-background-200 text-foreground-600 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50 transition-all duration-150 cursor-pointer whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input area with gradient focus ring */}
      <div
        className="relative flex items-end gap-2 rounded-2xl px-4 py-3 transition-all duration-200"
        style={
          focused
            ? {
                background: 'oklch(var(--background-50))',
                boxShadow: '0 0 0 1.5px #6763AC, 0 4px 24px rgba(103,99,172,0.12)',
              }
            : {
                background: 'oklch(var(--background-50))',
                boxShadow: '0 0 0 1px oklch(var(--background-200)), 0 2px 8px rgba(0,0,0,0.04)',
              }
        }
      >
        {/* Attach button */}
        <button
          className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
          title="Attach file"
        >
          <i className="ri-attachment-2 text-secondary-400 text-base" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search cases by name, number, or applicant..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-foreground-900 placeholder-secondary-400 outline-none leading-relaxed min-h-[24px] max-h-[160px] overflow-y-auto"
          style={{ fontFamily: 'var(--font-body)' }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer flex-shrink-0 ${
            canSend
              ? 'text-white scale-100 hover:scale-105 shadow-sm'
              : 'bg-background-200 text-secondary-400 cursor-not-allowed'
          }`}
          style={
            canSend
              ? {
                  background: 'linear-gradient(135deg, #6763AC 0%, #3DC0EC 100%)',
                  boxShadow: '0 2px 8px rgba(103,99,172,0.35)',
                }
              : {}
          }
        >
          <i className="ri-send-plane-fill text-sm" />
        </button>
      </div>

      <p className="text-center text-xs text-secondary-400 mt-2">
        Aeliuscase AI can make mistakes. Verify critical case information independently.
      </p>
    </div>
  );
}
