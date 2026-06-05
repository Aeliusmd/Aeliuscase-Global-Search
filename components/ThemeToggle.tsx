'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {}
  };

  // Render a placeholder with the same dimensions to avoid layout shift
  if (!mounted) {
    return <div className="w-9 h-9" />;
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-foreground-600 hover:text-foreground-900 hover:bg-background-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      {isDark ? (
        <i className="ri-sun-line text-lg" />
      ) : (
        <i className="ri-moon-line text-lg" />
      )}
    </button>
  );
}
