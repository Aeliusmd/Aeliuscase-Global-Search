import { NextRequest, NextResponse } from 'next/server';
import { PAGE_SIZE, searchCasesPaginated } from '@/lib/caseSearch';
import { getRequestAuth } from '@/lib/auth/request';
import { collectCaseNumbers, recordAudit } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const auth = getRequestAuth(request);
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!auth) {
    return NextResponse.json(
      { succeeded: false, message: 'Authentication required.', data: null },
      { status: 401 },
    );
  }
  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        succeeded: false,
        message: 'Server configuration error: API_BASE_URL is not set.',
        data: null,
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const searchText = searchParams.get('searchText') ?? '';
  const searchType = Number(searchParams.get('searchType') ?? '1') || 1;
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const pageSize = Number(searchParams.get('pageSize') ?? String(PAGE_SIZE)) || PAGE_SIZE;

  try {
    // Fetch the full matching set, filter by status, and slice the requested
    // page with exact totals (the upstream's own paging metadata is unreliable).
    const result = await searchCasesPaginated({
      apiBaseUrl,
      jwtToken: auth.token,
      searchText,
      searchType,
      page,
      pageSize,
    });

    if (!result.success) {
      return NextResponse.json(
        { succeeded: false, message: result.error ?? 'Search failed', data: [] },
        { status: result.status }
      );
    }

    recordAudit({
      userId: auth.userId,
      query: searchText,
      accessedCaseNumbers: collectCaseNumbers(result.cases),
      toolCalled: 'cases.search.pagination',
      ip: auth.ip,
    });

    return NextResponse.json(
      {
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
        totalRecords: result.totalRecords,
        isFirstPage: result.page <= 1,
        isLastPage: result.page >= result.totalPages,
        hasMorePages: result.hasMorePages,
        status: 200,
        succeeded: true,
        message: null,
        errors: null,
        data: result.cases,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        succeeded: false,
        message: 'Failed to reach the CaseController API. Check API_BASE_URL in .env.local.',
        data: null,
      },
      { status: 502 }
    );
  }
}
