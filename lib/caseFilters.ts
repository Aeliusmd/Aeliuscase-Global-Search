import type { CaseSearchItem } from '@/types/case';
import type { FilterToolOutput, NewCaseDTO, NestedCaseListData, StaffItem } from '@/types/caseFilters';

export const FILTER_PAGE_SIZE = 10;

/** Body fields for GetCaseListByCaseDate — send both names for API compatibility. */
export function caseDateRequestBody(
  fromDate?: string,
  toDate?: string,
  subOutFilter = 'include',
): Record<string, unknown> {
  return {
    ...(fromDate ? { caseFromDate: fromDate, fromDate } : {}),
    ...(toDate ? { caseToDate: toDate, toDate } : {}),
    subOutFilter,
  };
}

/**
 * Mapper for the newer nested endpoints whose case rows carry richer fields
 * (caseType, caseTypeId, a ready-made displayNameForCaseSearch, attorney nick).
 */
function mapNestedDTO(dto: NewCaseDTO): CaseSearchItem {
  return {
    id: dto.id,
    caseNumber: dto.caseNumber ?? '',
    fileNumber: dto.fileNumber ?? '',
    caseName: dto.displayNameForCaseSearch || dto.caseName || dto.caseNumber || '',
    caseTypeId: dto.caseTypeId ?? 0,
    caseType: dto.caseType ?? '',
    caseStatusDescription: dto.caseStatusDescription ?? '',
    caseAttorneyNickName: dto.caseAttorneyNickName ?? dto.caseAttorneyName ?? '',
    caseCoordinatorNickName: dto.caseCoordinatorNickName ?? '',
    createdDateTime: dto.createdDateTime ?? '',
    caseApplicant: dto.caseApplicant
      ? {
          firstName: dto.caseApplicant.firstName ?? '',
          lastName: dto.caseApplicant.lastName ?? '',
          fullName:
            dto.caseApplicant.fullName ??
            `${dto.caseApplicant.firstName ?? ''} ${dto.caseApplicant.lastName ?? ''}`.trim(),
          dob: dto.caseApplicant.dob,
          phone: dto.caseApplicant.phone,
        }
      : null,
    caseEmployee: dto.caseEmployee ? { company: dto.caseEmployee.company ?? '' } : null,
  };
}

interface CallNestedOpts {
  apiBaseUrl: string;
  jwtToken: string;
  endpoint: string;
  body: Record<string, unknown>;
  filterType: string;
  filterLabel: string;
  filterValue: string;
  page: number;
}

/**
 * Call a newer filter endpoint that returns `data.cases` + correct server-side
 * pagination. We trust the server's totals (verified accurate on UAT) and pass
 * the page straight through — no client-side fetch-all/slice needed.
 */
async function callFilterNested(opts: CallNestedOpts): Promise<FilterToolOutput> {
  const { apiBaseUrl, jwtToken, endpoint, body, filterType, filterLabel, filterValue, page } = opts;

  const fail = (error: string): FilterToolOutput => ({
    success: false, filterType, filterLabel, filterValue,
    cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
  });

  try {
    const res = await fetch(`${apiBaseUrl}/api/Case/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...body, page, pageSize: FILTER_PAGE_SIZE }),
      cache: 'no-store',
    });
    if (!res.ok) return fail(`API error ${res.status}`);
    const json = (await res.json()) as { succeeded?: boolean; message?: string; data?: NestedCaseListData };
    if (!json.succeeded) return fail(json.message ?? 'Filter failed');

    const d = json.data ?? {};
    return {
      success: true, filterType, filterLabel, filterValue,
      cases: (d.cases ?? []).map(mapNestedDTO),
      totalRecords: d.totalRecords ?? 0,
      totalPages: d.totalPages ?? 0,
      hasMorePages: d.hasMorePages ?? false,
      page: d.page ?? page,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Unexpected error');
  }
}


// ── 8 public filter functions ──────────────────────────────────────────────

// Phase 2 (2026-07-11): these 8 single-filter functions now route through the
// combined endpoint (via fetchCombinedCases) instead of their old flat endpoints.
// Rationale: the flat endpoints returned a poorer row (null applicant/employer/
// case-name, no status label) and no server pagination (we fetched the FULL set
// and sliced in memory). Combined returns the rich nested row + real pagination,
// with VERIFIED count parity for every filter. Each keeps its own filterType/
// filterValue so the /api/cases/filter pagination proxy re-dispatches correctly.

export async function fetchByStatusId(opts: {
  apiBaseUrl: string; jwtToken: string; caseStatusId: number; page?: number;
}): Promise<FilterToolOutput> {
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { caseStatusId: opts.caseStatusId },
    filterType: 'caseStatusId',
    filterLabel: `Status ID ${opts.caseStatusId}`,
    filterValue: String(opts.caseStatusId),
  });
}

export async function fetchBySubTypeId(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubTypeId: number; page?: number;
}): Promise<FilterToolOutput> {
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { caseSubTypeId: opts.caseSubTypeId },
    filterType: 'caseSubTypeId',
    filterLabel: `Sub-Type ID ${opts.caseSubTypeId}`,
    filterValue: String(opts.caseSubTypeId),
  });
}

export async function fetchBySubStatusId(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubStatusId: number; page?: number;
}): Promise<FilterToolOutput> {
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { caseSubStatusId: opts.caseSubStatusId },
    filterType: 'caseSubStatusId',
    filterLabel: `Sub-Status ID ${opts.caseSubStatusId}`,
    filterValue: String(opts.caseSubStatusId),
  });
}

export async function fetchBySubStatusId2(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubStatusId2: number; page?: number;
}): Promise<FilterToolOutput> {
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { caseSubStatusId2: opts.caseSubStatusId2 },
    filterType: 'caseSubStatusId2',
    filterLabel: `Sub-Status 2 ID ${opts.caseSubStatusId2}`,
    filterValue: String(opts.caseSubStatusId2),
  });
}

export async function fetchByVenueId(opts: {
  apiBaseUrl: string; jwtToken: string; venueId: number; page?: number;
}): Promise<FilterToolOutput> {
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { venueId: opts.venueId },
    filterType: 'venueId',
    filterLabel: `Venue ID ${opts.venueId}`,
    filterValue: String(opts.venueId),
  });
}

export async function fetchBySpecialInstruction(opts: {
  apiBaseUrl: string; jwtToken: string; specialInstructions: string; page?: number;
}): Promise<FilterToolOutput> {
  const kw = opts.specialInstructions.trim();
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { specialInstructions: kw },
    filterType: 'specialInstructions',
    filterLabel: `Special: "${kw}"`,
    filterValue: kw,
  });
}

export async function fetchBySolDate(opts: {
  apiBaseUrl: string; jwtToken: string;
  solFromDate?: string; solToDate?: string; page?: number;
}): Promise<FilterToolOutput> {
  const { solFromDate, solToDate } = opts;
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { ...(solFromDate ? { solFromDate } : {}), ...(solToDate ? { solToDate } : {}) },
    filterType: 'solDate',
    filterLabel: `SOL ${solFromDate ?? ''}–${solToDate ?? ''}`,
    filterValue: `${solFromDate ?? ''}~${solToDate ?? ''}`,
  });
}

export async function fetchByBodyPartIds(opts: {
  apiBaseUrl: string; jwtToken: string; bodyPartIds: number[]; page?: number;
}): Promise<FilterToolOutput> {
  const sorted = [...opts.bodyPartIds].sort((a, b) => a - b);
  return fetchCombinedCases({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    body: { bodyPartIds: sorted },
    filterType: 'bodyPartIds',
    filterLabel: `Body Parts [${sorted.join(', ')}]`,
    filterValue: sorted.join(','),
  });
}

// ── 4 newer filter functions (nested `data.cases` + server pagination) ───────

export async function fetchByCaseDate(opts: {
  apiBaseUrl: string; jwtToken: string;
  fromDate?: string; toDate?: string; subOutFilter?: string; page?: number;
}): Promise<FilterToolOutput> {
  const { fromDate, toDate, subOutFilter } = opts;
  return callFilterNested({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseDate',
    body: caseDateRequestBody(fromDate, toDate, subOutFilter ?? 'include'),
    filterType: 'caseDate',
    filterLabel: `Case Date ${fromDate ?? ''}–${toDate ?? ''}`,
    filterValue: `${fromDate ?? ''}~${toDate ?? ''}`,
  });
}

export async function fetchByCaseTypeId(opts: {
  apiBaseUrl: string; jwtToken: string; caseTypeId: number; subOutFilter?: string; page?: number;
}): Promise<FilterToolOutput> {
  return callFilterNested({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseTypeId',
    body: { caseTypeId: opts.caseTypeId, subOutFilter: opts.subOutFilter ?? 'include' },
    filterType: 'caseTypeId',
    filterLabel: `Case Type ID ${opts.caseTypeId}`,
    filterValue: String(opts.caseTypeId),
  });
}

export async function fetchByLastNameInitial(opts: {
  apiBaseUrl: string; jwtToken: string; lastNameInitial: string; subOutFilter?: string; page?: number;
}): Promise<FilterToolOutput> {
  const letter = opts.lastNameInitial.trim().charAt(0).toUpperCase();
  return callFilterNested({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByLastNameInitial',
    body: { lastNameInitial: letter, subOutFilter: opts.subOutFilter ?? 'include' },
    filterType: 'lastNameInitial',
    filterLabel: `Last name starts with "${letter}"`,
    filterValue: letter,
  });
}

/**
 * Cases assigned to a staff member. `jobRole` is the case-assignment SLOT
 * (attorney/coordinator/paralegal/…). IMPORTANT: never send an empty string —
 * the API returns 400 for `""`; omit the field to match any slot.
 */
export async function fetchByStaffId(opts: {
  apiBaseUrl: string; jwtToken: string;
  staffId: number; jobRole?: string; subOutFilter?: string; page?: number; staffName?: string;
}): Promise<FilterToolOutput> {
  const role = opts.jobRole?.trim();
  const who = opts.staffName ? `Cases for ${opts.staffName}` : `Staff #${opts.staffId}`;
  return callFilterNested({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByStaffId',
    body: {
      staffId: opts.staffId,
      ...(role ? { jobRole: role } : {}),
      subOutFilter: opts.subOutFilter ?? 'include',
    },
    filterType: 'staffId',
    filterLabel: role ? `${who} — ${role}` : who,
    // Encode the role into filterValue so Next/Previous pagination keeps the slot
    // filter (the proxy route decodes "<staffId>|<jobRole>").
    filterValue: role ? `${opts.staffId}|${role}` : String(opts.staffId),
  });
}

/**
 * Combined (AND) search via the single backend endpoint POST
 * /api/Case/GetCaseListCombined. Every supplied field is AND-combined server-side
 * and the response is the standard nested envelope (data.cases + real pagination),
 * so we reuse callFilterNested + mapNestedDTO. `body` is the already-mapped request
 * (built by combinedFilter.ts). Replaces the old client-side fetch-all + intersect.
 */
export async function fetchCombinedCases(opts: {
  apiBaseUrl: string; jwtToken: string;
  body: Record<string, unknown>;
  filterLabel: string; filterValue: string; page?: number;
  // Single-filter tools reuse this endpoint but keep their OWN filterType so the
  // pagination proxy route (/api/cases/filter) re-dispatches to the right handler
  // on Next/Previous (a venue search must page as 'venueId', not 'combined').
  filterType?: string;
}): Promise<FilterToolOutput> {
  return callFilterNested({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListCombined',
    body: opts.body,
    filterType: opts.filterType ?? 'combined',
    filterLabel: opts.filterLabel,
    filterValue: opts.filterValue,
  });
}


/**
 * Resolve a person by name. Returns the matching staff list (one row per
 * person, with their HR job title). Used as step 1 of the staff-case flow.
 */
export async function fetchStaffSearch(opts: {
  apiBaseUrl: string; jwtToken: string; searchText: string; jobRole?: string; page?: number;
}): Promise<{ success: boolean; staff: StaffItem[]; totalRecords: number; error?: string }> {
  const role = opts.jobRole?.trim();
  try {
    const res = await fetch(`${opts.apiBaseUrl}/api/Staff/Search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        searchText: opts.searchText.trim(),
        ...(role ? { jobRole: role } : {}),
        page: opts.page ?? 1,
        pageSize: 20,
      }),
      cache: 'no-store',
    });
    if (!res.ok) return { success: false, staff: [], totalRecords: 0, error: `API error ${res.status}` };
    const json = (await res.json()) as { data?: StaffItem[]; totalRecords?: number };
    const staff = json.data ?? [];
    return { success: true, staff, totalRecords: json.totalRecords ?? staff.length };
  } catch (err) {
    return { success: false, staff: [], totalRecords: 0, error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}
