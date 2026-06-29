import type { CaseSearchItem } from '@/types/case';
import type { FilterToolOutput, NewCaseDTO, NestedCaseListData, StaffItem } from '@/types/caseFilters';

export const FILTER_PAGE_SIZE = 10;

interface CacheEntry { at: number; cases: CaseSearchItem[] }
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 8;
const cache = new Map<string, CacheEntry>();

function readCache(key: string): CaseSearchItem[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.cases;
}

function writeCache(key: string, cases: CaseSearchItem[]): void {
  cache.set(key, { at: Date.now(), cases });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function mapDTO(dto: NewCaseDTO): CaseSearchItem {
  return {
    id: dto.id,
    caseNumber: dto.caseNumber,
    fileNumber: dto.fileNumber ?? '',
    caseName: dto.caseName ?? dto.caseNumber,
    caseTypeId: 0,
    caseType: '',
    caseStatusDescription: dto.caseStatusDescription ?? '',
    caseAttorneyNickName: dto.caseAttorneyName ?? '',
    caseCoordinatorNickName: '',
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

interface CallOpts {
  apiBaseUrl: string;
  jwtToken: string;
  endpoint: string;
  body: Record<string, unknown>;
  cacheKey: string;
  filterType: string;
  filterLabel: string;
  filterValue: string;
  page: number;
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

async function callFilter(opts: CallOpts): Promise<FilterToolOutput> {
  const { apiBaseUrl, jwtToken, endpoint, body, cacheKey, filterType, filterLabel, filterValue, page } = opts;

  const fail = (error: string): FilterToolOutput => ({
    success: false, filterType, filterLabel, filterValue,
    cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
  });

  let all = readCache(cacheKey);

  if (!all) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/Case/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!res.ok) return fail(`API error ${res.status}`);
      const data = (await res.json()) as { succeeded?: boolean; message?: string; data?: NewCaseDTO[] };
      if (!data.succeeded) return fail(data.message ?? 'Filter failed');
      all = (data.data ?? []).map(mapDTO);
      writeCache(cacheKey, all);
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Unexpected error');
    }
  }

  const totalRecords = all.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / FILTER_PAGE_SIZE);
  const safePage = totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * FILTER_PAGE_SIZE;

  return {
    success: true, filterType, filterLabel, filterValue,
    cases: all.slice(start, start + FILTER_PAGE_SIZE),
    totalRecords, totalPages,
    hasMorePages: safePage < totalPages,
    page: safePage,
  };
}

// ── 8 public filter functions ──────────────────────────────────────────────

export async function fetchByStatusId(opts: {
  apiBaseUrl: string; jwtToken: string; caseStatusId: number; page?: number;
}): Promise<FilterToolOutput> {
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseStatusId',
    body: { caseStatusId: opts.caseStatusId },
    cacheKey: `statusId:${opts.caseStatusId}`,
    filterType: 'caseStatusId',
    filterLabel: `Status ID ${opts.caseStatusId}`,
    filterValue: String(opts.caseStatusId),
  });
}

export async function fetchBySubTypeId(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubTypeId: number; page?: number;
}): Promise<FilterToolOutput> {
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseSubTypeId',
    body: { caseSubTypeId: opts.caseSubTypeId },
    cacheKey: `subTypeId:${opts.caseSubTypeId}`,
    filterType: 'caseSubTypeId',
    filterLabel: `Sub-Type ID ${opts.caseSubTypeId}`,
    filterValue: String(opts.caseSubTypeId),
  });
}

export async function fetchBySubStatusId(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubStatusId: number; page?: number;
}): Promise<FilterToolOutput> {
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseSubStatusId',
    body: { caseSubStatusId: opts.caseSubStatusId },
    cacheKey: `subStatusId:${opts.caseSubStatusId}`,
    filterType: 'caseSubStatusId',
    filterLabel: `Sub-Status ID ${opts.caseSubStatusId}`,
    filterValue: String(opts.caseSubStatusId),
  });
}

export async function fetchBySubStatusId2(opts: {
  apiBaseUrl: string; jwtToken: string; caseSubStatusId2: number; page?: number;
}): Promise<FilterToolOutput> {
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseSubStatusId2',
    body: { caseSubStatusId2: opts.caseSubStatusId2 },
    cacheKey: `subStatusId2:${opts.caseSubStatusId2}`,
    filterType: 'caseSubStatusId2',
    filterLabel: `Sub-Status 2 ID ${opts.caseSubStatusId2}`,
    filterValue: String(opts.caseSubStatusId2),
  });
}

export async function fetchByVenueId(opts: {
  apiBaseUrl: string; jwtToken: string; venueId: number; page?: number;
}): Promise<FilterToolOutput> {
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByCaseVenueId',
    body: { venueId: opts.venueId },
    cacheKey: `venueId:${opts.venueId}`,
    filterType: 'venueId',
    filterLabel: `Venue ID ${opts.venueId}`,
    filterValue: String(opts.venueId),
  });
}

export async function fetchBySpecialInstruction(opts: {
  apiBaseUrl: string; jwtToken: string; specialInstructions: string; page?: number;
}): Promise<FilterToolOutput> {
  const kw = opts.specialInstructions.trim();
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListBySpecialInstruction',
    body: { specialInstructions: kw },
    cacheKey: `special:${kw.toLowerCase()}`,
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
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListBySolDate',
    body: { ...(solFromDate ? { solFromDate } : {}), ...(solToDate ? { solToDate } : {}) },
    cacheKey: `sol:${solFromDate ?? ''}:${solToDate ?? ''}`,
    filterType: 'solDate',
    filterLabel: `SOL ${solFromDate ?? ''}–${solToDate ?? ''}`,
    filterValue: `${solFromDate ?? ''}~${solToDate ?? ''}`,
  });
}

export async function fetchByBodyPartIds(opts: {
  apiBaseUrl: string; jwtToken: string; bodyPartIds: number[]; page?: number;
}): Promise<FilterToolOutput> {
  const sorted = [...opts.bodyPartIds].sort((a, b) => a - b);
  return callFilter({
    apiBaseUrl: opts.apiBaseUrl, jwtToken: opts.jwtToken, page: opts.page ?? 1,
    endpoint: 'GetCaseListByBodyPartIds',
    body: { bodyPartIds: sorted },
    cacheKey: `bodyParts:${sorted.join(',')}`,
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
    body: {
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      subOutFilter: subOutFilter ?? 'include',
    },
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
 * Spec describing one filter endpoint to fetch in FULL (for combined / AND
 * filtering by client-side intersection). `shape` selects the response parser:
 * 'flat' = older endpoints returning data[]; 'nested' = newer data.cases.
 */
export interface FetchAllSpec {
  endpoint: string;
  body: Record<string, unknown>;
  shape: 'flat' | 'nested';
}

/**
 * Fetch the COMPLETE matching set for one filter (no pagination), mapped to
 * CaseSearchItem[]. Nested endpoints are asked for a very large pageSize so the
 * server returns everything in one call (verified: pageSize=100000 → full set).
 */
export async function fetchAllCases(
  deps: { apiBaseUrl: string; jwtToken: string },
  spec: FetchAllSpec,
): Promise<{ success: boolean; cases: CaseSearchItem[]; error?: string }> {
  try {
    const body = spec.shape === 'nested'
      ? { ...spec.body, page: 1, pageSize: 100000 }
      : spec.body;
    const res = await fetch(`${deps.apiBaseUrl}/api/Case/${spec.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) return { success: false, cases: [], error: `API error ${res.status}` };
    const json = (await res.json()) as {
      succeeded?: boolean; message?: string;
      data?: NewCaseDTO[] | NestedCaseListData;
    };
    if (!json.succeeded) return { success: false, cases: [], error: json.message ?? 'Filter failed' };

    if (spec.shape === 'nested') {
      const rows = (json.data as NestedCaseListData)?.cases ?? [];
      return { success: true, cases: rows.map(mapNestedDTO) };
    }
    const rows = (json.data as NewCaseDTO[]) ?? [];
    return { success: true, cases: rows.map(mapDTO) };
  } catch (err) {
    return { success: false, cases: [], error: err instanceof Error ? err.message : 'Unexpected error' };
  }
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
