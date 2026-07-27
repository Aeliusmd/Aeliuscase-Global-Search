import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Dynamic import so we can control env vars before the module loads
async function getHandler() {
  const mod = await import('@/../app/api/cases/search/route');
  return mod.GET;
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/cases/search');
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return { url: url.toString() } as Request & { url: string };
}

describe('GET /api/cases/search', () => {
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

    const GET = await getHandler();
    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.succeeded).toBe(false);
    expect(body.message).toContain('JWT_TOKEN');
  });

  it('returns 500 when API_BASE_URL is missing', async () => {
    vi.stubEnv('JWT_TOKEN', 'tok');
    vi.stubEnv('API_BASE_URL', '');

    const GET = await getHandler();
    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);

    expect(res.status).toBe(500);
  });

  it('proxies searchParams to upstream and returns response', async () => {
    vi.stubEnv('JWT_TOKEN', 'test-token');
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');

    const upstreamBody = { succeeded: true, data: [], totalRecords: 0, hasMorePages: false, page: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(upstreamBody) }),
    );

    const GET = await getHandler();
    const res = await GET(
      makeRequest({ searchText: 'John', searchType: '2', page: '1', pageSize: '20' }) as Parameters<typeof GET>[0],
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.succeeded).toBe(true);

    const upstreamUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(upstreamUrl).toContain('searchText=John');
    expect(upstreamUrl).toContain('searchType=2');

    const fetchOptions = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(fetchOptions.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('returns 502 when upstream fetch throws', async () => {
    vi.stubEnv('JWT_TOKEN', 'tok');
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const GET = await getHandler();
    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);

    expect(res.status).toBe(502);
  });

  it('forwards upstream non-200 status', async () => {
    vi.stubEnv('JWT_TOKEN', 'tok');
    vi.stubEnv('API_BASE_URL', 'https://api.example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Expired' }) }),
    );

    const GET = await getHandler();
    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);

    expect(res.status).toBe(401);
  });
});
