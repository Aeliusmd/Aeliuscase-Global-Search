import { Suspense } from 'react';
import EmbedPageClient from '@/components/embed/EmbedPageClient';

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="h-full w-full bg-transparent" />}>
      <EmbedPageClient />
    </Suspense>
  );
}
