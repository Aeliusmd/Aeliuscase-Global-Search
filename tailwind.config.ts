import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      animation: {
        'bounce-delay-1': 'bounce 1s infinite 0ms',
        'bounce-delay-2': 'bounce 1s infinite 150ms',
        'bounce-delay-3': 'bounce 1s infinite 300ms',
      },
    },
  },
  plugins: [],
};

export default config;
