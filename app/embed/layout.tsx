import EmbedTransparentRoot from '@/components/embed/EmbedTransparentRoot';

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <EmbedTransparentRoot>
      <div className="embed-shell h-screen w-screen overflow-hidden bg-transparent">{children}</div>
    </EmbedTransparentRoot>
  );
}
