'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import EmbedPageClient from '@/components/embed/EmbedPageClient';

function EmbedSession() {
  const searchParams = useSearchParams();
  // The initializer runs once. Renewals update the same Redis session in place,
  // so the iframe never needs to re-read or replace this value.
  const [sessionId] = useState(() => searchParams.get('session') ?? '');

  if (!sessionId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background-50 px-6 text-center">
        <p className="text-sm font-medium text-foreground-700">
          Please open this chatbot through AeliusCase.
        </p>
      </div>
    );
  }

  return <EmbedPageClient sessionId={sessionId} />;
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="h-full w-full bg-transparent" />}>
      <EmbedSession />
    </Suspense>
  );
}
