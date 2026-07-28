import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: sessionMocks.getSession,
}));

import { GET } from '@/app/api/documents/download/route';

function request(query: string): Request {
  return new Request(`http://localhost/api/documents/download?${query}`);
}

describe('GET /api/documents/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('API_BASE_URL', 'https://uatapi.aeliuscase.com');
    sessionMocks.getSession.mockResolvedValue({ token: 'real-upstream-token', firmId: 'firm-1', userId: 'user-1' });
  });

  it('400s when sessionId is missing', async () => {
    const res = await GET(request('docId=478&docCategory=3'));
    expect(res.status).toBe(400);
    expect(sessionMocks.getSession).not.toHaveBeenCalled();
  });

  it('400s when docId is missing or non-numeric', async () => {
    expect((await GET(request('docCategory=3&sessionId=abc'))).status).toBe(400);
    expect((await GET(request('docId=abc&docCategory=3&sessionId=abc'))).status).toBe(400);
  });

  it('400s when docCategory is missing or non-numeric', async () => {
    expect((await GET(request('docId=478&sessionId=abc'))).status).toBe(400);
    expect((await GET(request('docId=478&docCategory=abc&sessionId=abc'))).status).toBe(400);
  });

  it('401s when the session is invalid or expired', async () => {
    sessionMocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(request('docId=478&docCategory=3&sessionId=expired'));
    expect(res.status).toBe(401);
  });

  it('500s when API_BASE_URL is not configured', async () => {
    vi.stubEnv('API_BASE_URL', '');
    const res = await GET(request('docId=478&docCategory=3&sessionId=abc'));
    expect(res.status).toBe(500);
  });

  it('fetches GetFirmDocFile with the real session token attached server-side and streams the result back', async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(request('docId=478&docCategory=3&sessionId=my-session'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdfBytes);

    expect(sessionMocks.getSession).toHaveBeenCalledWith('my-session');
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://uatapi.aeliuscase.com/api/Filehandling/GetFirmDocFile?docId=478&docCategory=3');
    expect((calledInit.headers as Record<string, string>).Authorization).toBe('Bearer real-upstream-token');
  });

  it('relays the upstream status when GetFirmDocFile itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const res = await GET(request('docId=478&docCategory=3&sessionId=my-session'));
    expect(res.status).toBe(500);
  });

  it('returns 502 when the upstream fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const res = await GET(request('docId=478&docCategory=3&sessionId=my-session'));
    expect(res.status).toBe(502);
  });
});
