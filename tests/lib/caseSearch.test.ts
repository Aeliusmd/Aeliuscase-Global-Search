import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeUpstreamError, searchCasesPaginated } from '@/lib/caseSearch';

// Live bug fixed 2026-08-06: the upstream /api/Case/Search endpoint returned a
// raw SQL error ("PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination
// does not exist") as its `message` field, and that text was shown to the end
// user verbatim in a red error box — internal backend implementation detail
// that should never reach a real client.
describe('sanitizeUpstreamError', () => {
  it('replaces an obviously technical/internal-looking message with a generic one', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = sanitizeUpstreamError(
      'PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination does not exist',
      'caseSearch',
    );
    expect(out).not.toContain('PROCEDURE');
    expect(out).not.toContain('zzztestempeformsantarosa');
    expect(out.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith(
      '[caseSearch] upstream returned an internal-looking error:',
      expect.stringContaining('PROCEDURE'),
    );
    spy.mockRestore();
  });

  it('also catches SqlException / stack-trace-shaped messages', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(sanitizeUpstreamError('SqlException: Invalid column name', 'x')).not.toContain('SqlException');
    expect(sanitizeUpstreamError('at System.Data.SqlClient.SqlCommand.Execute', 'x')).not.toContain('System.');
    vi.restoreAllMocks();
  });

  it('passes through a genuine, human-readable backend message unchanged', () => {
    expect(sanitizeUpstreamError('Case not found.', 'x')).toBe('Case not found.');
    expect(sanitizeUpstreamError('No case matched the supplied caseId/caseNumber/caseName.', 'x'))
      .toBe('No case matched the supplied caseId/caseNumber/caseName.');
  });

  it('falls back to a generic message when there is no message at all', () => {
    expect(sanitizeUpstreamError(null, 'x').length).toBeGreaterThan(0);
    expect(sanitizeUpstreamError(undefined, 'x').length).toBeGreaterThan(0);
  });
});

describe('searchCasesPaginated — error sanitization', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sanitizes a raw SQL error from the upstream search endpoint before returning it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        succeeded: false,
        message: 'PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination does not exist',
      }),
    }));

    const result = await searchCasesPaginated({
      apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: 'RP0036 ' + Date.now(), searchType: 2, page: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('PROCEDURE');
  });
});

// Live bug fixed 2026-08-06: the legacy GET /api/Case/Search endpoint's stored
// procedure was missing entirely for this firm's schema. Migrated to POST
// /api/Case/GetCaseListCombined — the same endpoint every filter tool already
// uses (lib/caseFilters.ts), confirmed working, with real server-side
// pagination (no more fetch-everything-then-slice client-side).
describe('searchCasesPaginated — GetCaseListCombined migration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(json: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(json) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('calls POST /api/Case/GetCaseListCombined, not the legacy Search endpoint', async () => {
    const fetchMock = stubFetch({ succeeded: true, data: { cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1 } });

    await searchCasesPaginated({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: '', searchType: 1, page: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uatapi.aeliuscase.com/api/Case/GetCaseListCombined');
    expect(init.method).toBe('POST');
  });

  it('omits searchText when blank and omits searchType for "All" (1)', async () => {
    const fetchMock = stubFetch({ succeeded: true, data: { cases: [] } });

    await searchCasesPaginated({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: '  ', searchType: 1, page: 1 });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('searchText');
    expect(body).not.toHaveProperty('searchType');
  });

  it('sends searchText and searchType (2-4) straight through', async () => {
    const fetchMock = stubFetch({ succeeded: true, data: { cases: [] } });

    await searchCasesPaginated({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: 'RP0036', searchType: 2, page: 3, pageSize: 25 });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ searchText: 'RP0036', searchType: 2, page: 3, pageSize: 25 });
  });

  it('maps a real GetCaseListCombined row into CaseSearchItem and trusts the server pagination totals directly', async () => {
    stubFetch({
      succeeded: true,
      data: {
        cases: [{
          id: 224, caseNumber: 'AE-00224', fileNumber: 'AE00224',
          caseApplicant: { fullName: 'Tharushi Samindika Perera' },
          caseEmployee: { company: 'MedcubeUSA LLC' },
        }],
        totalRecords: 137, totalPages: 14, hasMorePages: true, page: 1,
      },
    });

    const result = await searchCasesPaginated({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: 'Perera', searchType: 1, page: 1 });

    expect(result.success).toBe(true);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].caseNumber).toBe('AE-00224');
    expect(result.cases[0].fileNumber).toBe('AE00224');
    expect(result.cases[0].caseApplicant?.fullName).toBe('Tharushi Samindika Perera');
    expect(result.cases[0].caseEmployee?.company).toBe('MedcubeUSA LLC');
    // No client-side re-slicing — these come straight from the server's own response.
    expect(result.totalRecords).toBe(137);
    expect(result.totalPages).toBe(14);
    expect(result.hasMorePages).toBe(true);
  });

  it('propagates the real HTTP status on a non-ok response', async () => {
    const result0 = await (async () => {
      stubFetch({ succeeded: false, message: 'Session expired.' }, false, 401);
      return searchCasesPaginated({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: '', searchType: 1, page: 1 });
    })();
    expect(result0.success).toBe(false);
    expect(result0.status).toBe(401);
    expect(result0.error).toBe('Session expired.');
  });
});
