import type { CaseSearchParams, CaseSearchItem, PagedApiResponse } from '@/types/case';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly isAuthError: boolean,
    message?: string
  ) {
    super(message ?? `HTTP error ${status}`);
    this.name = 'ApiError';
  }
}

export async function searchCases(
  params: CaseSearchParams
): Promise<PagedApiResponse<CaseSearchItem>> {
  const url = new URL('/api/cases/search', window.location.origin);
  url.searchParams.set('searchText', params.searchText);
  url.searchParams.set('searchType', String(params.searchType ?? 1));
  url.searchParams.set('page', String(params.page ?? 1));
  url.searchParams.set('pageSize', String(params.pageSize ?? 20));

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new ApiError(0, false, 'Network error: could not reach the server.');
  }

  const data = (await response.json()) as PagedApiResponse<CaseSearchItem>;

  if (!response.ok) {
    throw new ApiError(response.status, response.status === 401, data.message ?? undefined);
  }

  if (!data.succeeded) {
    throw new ApiError(response.status, response.status === 401, data.message ?? undefined);
  }

  return data;
}
