import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function getHandler() {
  const mod = await import('@/../app/api/chat/route');
  return mod.POST;
}

function makeRequest(body: Record<string, unknown> = {}) {
  return {
    json: () => Promise.resolve({ messages: [], searchTypeHint: 1, ...body }),
  } as Request;
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 when JWT_TOKEN is missing', async () => {
    vi.stubEnv('JWT_TOKEN', '');
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');

    const POST = await getHandler();
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain('JWT_TOKEN');
  });

  it('returns 500 when API_BASE_URL is missing', async () => {
    vi.stubEnv('JWT_TOKEN', 'tok');
    vi.stubEnv('API_BASE_URL', '');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');

    const POST = await getHandler();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
  });

  it('returns 500 with isConfigError when OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('JWT_TOKEN', 'tok');
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');
    vi.stubEnv('OPENAI_API_KEY', '');

    const POST = await getHandler();
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.isConfigError).toBe(true);
    expect(body.error).toContain('OPENAI_API_KEY');
  });
});
