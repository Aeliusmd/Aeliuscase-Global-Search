import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getRequestAuth: vi.fn(),
}));

vi.mock('@/lib/auth/request', () => ({
  getRequestAuth: authMocks.getRequestAuth,
}));

import { GET } from '@/app/api/documents/download/route';

function request(query: string): Request {
  return new Request(`http://localhost/api/documents/download?${query}`);
}

describe('GET /api/documents/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('API_BASE_URL', 'https://uatapi.aeliuscase.com');
    authMocks.getRequestAuth.mockReturnValue({ userId: 'user-1', firmId: 'firm-1', token: 'real-upstream-token', ip: '1.2.3.4' });
  });

  // Live bug fixed 2026-07-29: auth is resolved from middleware-set headers
  // (like every other authenticated route — see middleware.ts's matcher,
  // which now includes this route), NOT a session id baked into the link's
  // own query string. The earlier design embedded the session id in the
  // URL, so a document link opened even a day later 401'd even under a
  // perfectly valid CURRENT session, since that embedded session id had
  // long expired. This route no longer even reads a sessionId query param.
  it('401s when getRequestAuth finds no valid session (middleware-resolved headers missing)', async () => {
    authMocks.getRequestAuth.mockReturnValueOnce(null);
    const res = await GET(request('docId=478&docCategory=3'));
    expect(res.status).toBe(401);
  });

  it('400s when docId is missing or non-numeric', async () => {
    expect((await GET(request('docCategory=3'))).status).toBe(400);
    expect((await GET(request('docId=abc&docCategory=3'))).status).toBe(400);
  });

  it('400s when docCategory is missing or non-numeric', async () => {
    expect((await GET(request('docId=478'))).status).toBe(400);
    expect((await GET(request('docId=478&docCategory=abc'))).status).toBe(400);
  });

  it('500s when API_BASE_URL is not configured', async () => {
    vi.stubEnv('API_BASE_URL', '');
    const res = await GET(request('docId=478&docCategory=3'));
    expect(res.status).toBe(500);
  });

  it('fetches GetFirmDocFile with the real session token attached server-side and streams the result back', async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(request('docId=478&docCategory=3'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdfBytes);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://uatapi.aeliuscase.com/api/Filehandling/GetFirmDocFile?docId=478&docCategory=3');
    expect((calledInit.headers as Record<string, string>).Authorization).toBe('Bearer real-upstream-token');
  });

  it('relays the upstream status when GetFirmDocFile itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const res = await GET(request('docId=478&docCategory=3'));
    expect(res.status).toBe(500);
  });

  it('returns 502 when the upstream fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const res = await GET(request('docId=478&docCategory=3'));
    expect(res.status).toBe(502);
  });
});
