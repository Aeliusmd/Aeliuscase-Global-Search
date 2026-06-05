import { NextRequest, NextResponse } from 'next/server';
import { PAGE_SIZE, searchCasesPaginated } from '@/lib/caseSearch';

export async function GET(request: NextRequest) {
  const jwtToken = process.env.JWT_TOKEN;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!jwtToken || !apiBaseUrl) {
    return NextResponse.json(
      {
        succeeded: false,
        message:
          'Server configuration error: JWT_TOKEN or API_BASE_URL is not set. Update .env.local and restart the server.',
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
      jwtToken,
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
