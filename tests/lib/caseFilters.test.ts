import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchByCaseDate, fetchByCaseTypeId, fetchByLastNameInitial, fetchByStaffId } from '@/lib/caseFilters';

// Live migration 2026-08-06 (companion to the searchCases fix): these 4
// functions used to call their own dedicated sibling endpoints
// (GetCaseListByCaseDate/CaseTypeId/LastNameInitial/StaffId), requested and
// delivered BEFORE GetCaseListCombined existed. Migrated onto
// GetCaseListCombined — the same endpoint the other 8 filter functions and
// searchCases already use — since it already accepts every one of these
// fields. filterType/filterLabel/filterValue and each function's own
// signature are unchanged, so app/api/cases/filter/route.ts needed no edits.
describe('caseFilters — migrated onto GetCaseListCombined', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(json: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(json) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const OK_EMPTY = { succeeded: true, data: { cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1 } };

  it('fetchByCaseDate calls GetCaseListCombined with caseFromDate/caseToDate (not GetCaseListByCaseDate)', async () => {
    const fetchMock = stubFetch(OK_EMPTY);

    await fetchByCaseDate({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', fromDate: '2026-01-01', toDate: '2026-06-30' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uatapi.aeliuscase.com/api/Case/GetCaseListCombined');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ caseFromDate: '2026-01-01', caseToDate: '2026-06-30', subOutFilter: 'include' });
    // The old dedicated endpoint's dual fromDate/toDate compatibility fields are gone.
    expect(body).not.toHaveProperty('fromDate');
    expect(body).not.toHaveProperty('toDate');
  });

  it('fetchByCaseTypeId calls GetCaseListCombined with caseTypeId', async () => {
    const fetchMock = stubFetch(OK_EMPTY);

    await fetchByCaseTypeId({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', caseTypeId: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uatapi.aeliuscase.com/api/Case/GetCaseListCombined');
    expect(JSON.parse(init.body as string)).toMatchObject({ caseTypeId: 1 });
  });

  it('fetchByLastNameInitial calls GetCaseListCombined with an uppercased lastNameInitial', async () => {
    const fetchMock = stubFetch(OK_EMPTY);

    await fetchByLastNameInitial({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', lastNameInitial: 'm' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uatapi.aeliuscase.com/api/Case/GetCaseListCombined');
    expect(JSON.parse(init.body as string)).toMatchObject({ lastNameInitial: 'M' });
  });

  it('fetchByStaffId calls GetCaseListCombined with staffId and staffRole (not jobRole)', async () => {
    const fetchMock = stubFetch(OK_EMPTY);

    await fetchByStaffId({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', staffId: 5935, jobRole: 'Attorney' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uatapi.aeliuscase.com/api/Case/GetCaseListCombined');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ staffId: 5935, staffRole: 'Attorney' });
    expect(body).not.toHaveProperty('jobRole');
  });

  it('fetchByStaffId omits staffRole entirely (not empty string) when no role is given', async () => {
    const fetchMock = stubFetch(OK_EMPTY);

    await fetchByStaffId({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', staffId: 5935 });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('staffRole');
  });

  it('maps a real row and trusts the server pagination totals directly', async () => {
    stubFetch({
      succeeded: true,
      data: {
        cases: [{ id: 224, caseNumber: 'AE-00224', fileNumber: 'AE00224', caseApplicant: { fullName: 'Tharushi Samindika Perera' } }],
        totalRecords: 42, totalPages: 5, hasMorePages: true, page: 1,
      },
    });

    const result = await fetchByCaseTypeId({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', caseTypeId: 1 });

    expect(result.success).toBe(true);
    expect(result.cases[0].caseNumber).toBe('AE-00224');
    expect(result.totalRecords).toBe(42);
    expect(result.totalPages).toBe(5);
    expect(result.hasMorePages).toBe(true);
    // filterType is unchanged — app/api/cases/filter/route.ts's dispatch relies on this.
    expect(result.filterType).toBe('caseTypeId');
  });

  it('sanitizes a raw internal-looking error from the upstream endpoint', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch({ succeeded: false, message: 'PROCEDURE some.OtherProc does not exist' }, true);

    const result = await fetchByLastNameInitial({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', lastNameInitial: 'M' });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('PROCEDURE');
  });
});
