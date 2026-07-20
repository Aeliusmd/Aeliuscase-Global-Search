import { NextRequest, NextResponse } from 'next/server';
import {
  FILTER_PAGE_SIZE,
  fetchByStatusId,
  fetchBySubTypeId,
  fetchBySubStatusId,
  fetchBySubStatusId2,
  fetchByVenueId,
  fetchBySpecialInstruction,
  fetchBySolDate,
  fetchByBodyPartIds,
  fetchByCaseDate,
  fetchByCaseTypeId,
  fetchByLastNameInitial,
  fetchByStaffId,
} from '@/lib/caseFilters';
import { combinedSearch, type CombinedFilters } from '@/lib/combinedFilter';
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
      { succeeded: false, message: 'Server configuration error.', data: null },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const filterType = searchParams.get('filterType') ?? '';
  const filterValue = searchParams.get('filterValue') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const deps = { apiBaseUrl, jwtToken: auth.token };

  let result;
  switch (filterType) {
    case 'caseStatusId':
      result = await fetchByStatusId({ ...deps, caseStatusId: Number(filterValue), page });
      break;
    case 'caseSubTypeId':
      result = await fetchBySubTypeId({ ...deps, caseSubTypeId: Number(filterValue), page });
      break;
    case 'caseSubStatusId':
      result = await fetchBySubStatusId({ ...deps, caseSubStatusId: Number(filterValue), page });
      break;
    case 'caseSubStatusId2':
      result = await fetchBySubStatusId2({ ...deps, caseSubStatusId2: Number(filterValue), page });
      break;
    case 'venueId':
      result = await fetchByVenueId({ ...deps, venueId: Number(filterValue), page });
      break;
    case 'specialInstructions':
      result = await fetchBySpecialInstruction({ ...deps, specialInstructions: filterValue, page });
      break;
    case 'solDate': {
      const [from, to] = filterValue.split('~');
      result = await fetchBySolDate({ ...deps, solFromDate: from || undefined, solToDate: to || undefined, page });
      break;
    }
    case 'bodyPartIds':
      result = await fetchByBodyPartIds({ ...deps, bodyPartIds: filterValue.split(',').map(Number), page });
      break;
    case 'caseDate': {
      const [from, to] = filterValue.split('~');
      result = await fetchByCaseDate({ ...deps, fromDate: from || undefined, toDate: to || undefined, page });
      break;
    }
    case 'caseTypeId':
      result = await fetchByCaseTypeId({ ...deps, caseTypeId: Number(filterValue), page });
      break;
    case 'lastNameInitial':
      result = await fetchByLastNameInitial({ ...deps, lastNameInitial: filterValue, page });
      break;
    case 'staffId': {
      // filterValue is "<staffId>" or "<staffId>|<jobRole>" (role slot preserved
      // across pagination).
      const [idStr, jobRole] = filterValue.split('|');
      result = await fetchByStaffId({ ...deps, staffId: Number(idStr), jobRole: jobRole || undefined, page });
      break;
    }
    case 'combined': {
      let filters: CombinedFilters;
      try {
        filters = JSON.parse(filterValue) as CombinedFilters;
      } catch {
        return NextResponse.json(
          { succeeded: false, message: 'Invalid combined filterValue', data: [] },
          { status: 400 },
        );
      }
      result = await combinedSearch(deps, filters, page);
      break;
    }
    default:
      return NextResponse.json(
        { succeeded: false, message: `Unknown filterType: "${filterType}"`, data: null },
        { status: 400 },
      );
  }

  if (!result.success) {
    return NextResponse.json(
      { succeeded: false, message: result.error ?? 'Filter failed', data: [] },
      { status: 400 },
    );
  }

  recordAudit({
    userId: auth.userId,
    query: `${filterType}:${filterValue}`,
    accessedCaseNumbers: collectCaseNumbers(result.cases),
    toolCalled: 'cases.filter.pagination',
    ip: auth.ip,
  });

  return NextResponse.json({
    page: result.page,
    pageSize: FILTER_PAGE_SIZE,
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
  });
}
