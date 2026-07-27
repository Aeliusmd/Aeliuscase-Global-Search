import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchCases, ApiError } from '@/api/searchCases';
import { MainSearchType } from '@/types/case';
import type { PagedApiResponse, CaseSearchItem } from '@/types/case';

const mockCase: CaseSearchItem = {
  id: 1,
  caseNumber: 'RP003782',
  fileNumber: 'F001',
  caseName: 'Test v. Case',
  caseTypeId: 1,
  caseType: 'Workers Comp',
  caseStatusDescription: 'Open',
  caseAttorneyNickName: 'JD',
  caseCoordinatorNickName: 'CC',
  createdDateTime: '2024-01-15T00:00:00Z',
  caseApplicant: { firstName: 'John', lastName: 'Doe', fullName: 'John Doe' },
  caseEmployee: null,
};

const successResponse: PagedApiResponse<CaseSearchItem> = {
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totalRecords: 1,
  isFirstPage: true,
  isLastPage: true,
  hasMorePages: false,
  status: 200,
  succeeded: true,
  message: null,
  errors: null,
  data: [mockCase],
};

describe('ApiError', () => {
  it('inherits from Error', () => {
    const err = new ApiError(401, true, 'Unauthorized');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('stores status and isAuthError', () => {
    const err = new ApiError(403, true, 'Forbidden');
    expect(err.status).toBe(403);
    expect(err.isAuthError).toBe(true);
    expect(err.message).toBe('Forbidden');
  });

  it('defaults message to HTTP error text when none provided', () => {
    const err = new ApiError(500, false);
    expect(err.message).toBe('HTTP error 500');
  });

  it('name is ApiError', () => {
    expect(new ApiError(400, false).name).toBe('ApiError');
  });
});

describe('searchCases', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
  });

  it('builds the correct URL and returns parsed data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(successResponse),
      }),
    );

    const result = await searchCases({
      searchText: 'John',
      searchType: MainSearchType.OpenCases,
      page: 1,
      pageSize: 20,
    });

    expect(result.succeeded).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].caseNumber).toBe('RP003782');

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(fetchCall).toContain('searchText=John');
    expect(fetchCall).toContain('searchType=2');
  });

  it('throws ApiError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(searchCases({ searchText: 'x' })).rejects.toMatchObject({
      status: 0,
      isAuthError: false,
    });
  });

  it('throws ApiError with isAuthError=true on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized', succeeded: false }),
      }),
    );

    const err = await searchCases({ searchText: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.isAuthError).toBe(true);
  });

  it('throws ApiError when succeeded=false even with 200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...successResponse, succeeded: false, message: 'Bad query' }),
      }),
    );

    const err = await searchCases({ searchText: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Bad query');
  });

  it('defaults searchType to 1, page to 1, pageSize to 20', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(successResponse),
      }),
    );

    await searchCases({ searchText: 'test' });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('searchType=1');
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=20');
  });
});
