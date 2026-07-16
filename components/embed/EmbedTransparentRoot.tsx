'use client';

import { useEffect } from 'react';

const EMBED_HTML_CLASS = 'embed-transparent';

interface EmbedTransparentRootProps {
  children: React.ReactNode;
}

/** Applies transparent canvas styles on `/embed` without affecting standalone `/`. */
export default function EmbedTransparentRoot({ children }: EmbedTransparentRootProps) {
  useEffect(() => {
    document.documentElement.classList.add(EMBED_HTML_CLASS);
    return () => {
      document.documentElement.classList.remove(EMBED_HTML_CLASS);
    };
  }, []);

  return <>{children}</>;
}
