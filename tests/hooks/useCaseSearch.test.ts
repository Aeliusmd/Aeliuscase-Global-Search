import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaseSearch } from '@/hooks/useCaseSearch';
import * as searchCasesModule from '@/api/searchCases';
import { MainSearchType } from '@/types/case';
import type { PagedApiResponse, CaseSearchItem } from '@/types/case';

const makePagedResponse = (data: CaseSearchItem[] = []): PagedApiResponse<CaseSearchItem> => ({
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totalRecords: data.length,
  isFirstPage: true,
  isLastPage: true,
  hasMorePages: false,
  status: 200,
  succeeded: true,
  message: null,
  errors: null,
  data,
});

describe('useCaseSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with loading=false and error=null', () => {
    const { result } = renderHook(() => useCaseSearch());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true during search then false after', async () => {
    vi.spyOn(searchCasesModule, 'searchCases').mockResolvedValue(makePagedResponse());
    const { result } = renderHook(() => useCaseSearch());

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.search('test');
    });
    expect(result.current.loading).toBe(true);

    await act(async () => { await promise; });
    expect(result.current.loading).toBe(false);
  });

  it('returns mapped result on success', async () => {
    const mockCase: CaseSearchItem = {
      id: 42,
      caseNumber: 'RP0001',
      fileNumber: 'F1',
      caseName: 'A v B',
      caseTypeId: 1,
      caseType: 'WC',
      caseStatusDescription: 'Open',
      caseAttorneyNickName: 'JD',
      caseCoordinatorNickName: 'CC',
      createdDateTime: '2024-01-01T00:00:00Z',
      caseApplicant: null,
      caseEmployee: null,
    };

    vi.spyOn(searchCasesModule, 'searchCases').mockResolvedValue(
      makePagedResponse([mockCase]),
    );

    const { result } = renderHook(() => useCaseSearch());
    let searchResult: Awaited<ReturnType<typeof result.current.search>>;

    await act(async () => {
      searchResult = await result.current.search('RP0001', MainSearchType.OpenCases);
    });

    expect(searchResult!.cases).toHaveLength(1);
    expect(searchResult!.cases[0].id).toBe(42);
    expect(searchResult!.totalRecords).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('sets error state and rethrows on ApiError', async () => {
    const apiErr = new searchCasesModule.ApiError(401, true, 'Unauthorized');
    vi.spyOn(searchCasesModule, 'searchCases').mockRejectedValue(apiErr);

    const { result } = renderHook(() => useCaseSearch());

    await act(async () => {
      await result.current.search('x').catch(() => {});
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.isAuthError).toBe(true);
    expect(result.current.error!.message).toBe('Unauthorized');
    expect(result.current.loading).toBe(false);
  });

  it('classifies network error (status=0) as isNetworkError', async () => {
    const netErr = new searchCasesModule.ApiError(0, false, 'Network error');
    vi.spyOn(searchCasesModule, 'searchCases').mockRejectedValue(netErr);

    const { result } = renderHook(() => useCaseSearch());
    await act(async () => { await result.current.search('x').catch(() => {}); });

    expect(result.current.error!.isNetworkError).toBe(true);
  });

  it('classifies 500 error as isConfigError', async () => {
    const configErr = new searchCasesModule.ApiError(500, false, 'Server error');
    vi.spyOn(searchCasesModule, 'searchCases').mockRejectedValue(configErr);

    const { result } = renderHook(() => useCaseSearch());
    await act(async () => { await result.current.search('x').catch(() => {}); });

    expect(result.current.error!.isConfigError).toBe(true);
  });
});
