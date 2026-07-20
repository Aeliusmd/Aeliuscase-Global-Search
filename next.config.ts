import type { NextConfig } from 'next';
import { getAllowedParentOrigins } from './lib/auth/origins';

const frameAncestors = ["'self'", ...getAllowedParentOrigins()].join(' ');
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  `frame-ancestors ${frameAncestors}`,
].join('; ');

const nextConfig: NextConfig = {
  // ai and @ai-sdk/openai are server-only (used in route handlers) and ESM-only,
  // so exclude them from webpack SSR bundling and let Node import them natively.
  // NOTE: @ai-sdk/react must NOT be external — it's a client package whose hooks
  // (useChat) run during SSR. Externalizing it loads a second React module
  // instance with a null dispatcher, breaking useRef/useState inside the hook.
  serverExternalPackages: ['ai', '@ai-sdk/openai'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
      {
        source: '/embed',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
