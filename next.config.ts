import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ai and @ai-sdk/openai are server-only (used in route handlers) and ESM-only,
  // so exclude them from webpack SSR bundling and let Node import them natively.
  // NOTE: @ai-sdk/react must NOT be external — it's a client package whose hooks
  // (useChat) run during SSR. Externalizing it loads a second React module
  // instance with a null dispatcher, breaking useRef/useState inside the hook.
  serverExternalPackages: ['ai', '@ai-sdk/openai'],
};

export default nextConfig;
