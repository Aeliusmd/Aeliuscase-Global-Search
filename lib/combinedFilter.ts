import type { CaseSearchItem } from '@/types/case';
import type { FilterToolOutput } from '@/types/caseFilters';
import { FILTER_PAGE_SIZE, fetchAllCases, type FetchAllSpec, caseDateRequestBody } from '@/lib/caseFilters';
import { filterCasesByType, searchCasesPaginated } from '@/lib/caseSearch';

/**
 * Combined (AND) filtering across the case filters, client-side.
 *
 * Engine: for each supplied concrete filter, fetch its FULL matching set from
 * the existing endpoint, then INTERSECT the sets by case id. The smallest set
 * is used as the base we iterate (cheapest). `status` (searchType 1–4) is
 * applied in-memory on caseStatusDescription because the filter endpoints
 * ignore searchType. Omitted filters are simply not fetched — so any subset of
 * filters works, and a case is returned only if it matches ALL supplied ones.
 */
export interface CombinedFilters {
  caseTypeId?: number;
  venueId?: number;
  staffId?: number;
  staffName?: string;          // label only (resolved to staffId by the tool)
  staffJobRole?: string;       // verified case-slot string (Attorney/Paralegal/…) for the staff filter
  applicantName?: string;      // client / injured-worker name (free-text case search)
  status?: number;             // searchType 1–4, applied in-memory
  lastNameInitial?: string;
  bodyPartIds?: number[];
  solFromDate?: string;
  solToDate?: string;
  caseFromDate?: string;
  caseToDate?: string;
  specialInstructions?: string;
  caseSubTypeId?: number;
  caseSubStatusId?: number;
  caseSubStatusId2?: number;
  subOutFilter?: string;
}

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

/** Stable key so pagination + repeat queries hit the cache regardless of field order. */
export function encodeCombinedFilters(f: CombinedFilters): string {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(f).sort()) {
    const v = (f as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) ordered[k] = v;
  }
  return JSON.stringify(ordered);
}

/** Build the set-fetch specs for every CONCRETE filter present (status excluded — it's in-memory). */
function buildSpecs(f: CombinedFilters): { label: string; spec: FetchAllSpec }[] {
  const sub = f.subOutFilter ?? 'include';
  const specs: { label: string; spec: FetchAllSpec }[] = [];
  // IDs are always positive in this system — treat 0 / null as "not supplied"
  // (the model tends to fill unused numeric fields with 0).
  const has = (n?: number): n is number => typeof n === 'number' && n > 0;

  if (has(f.caseTypeId))
    specs.push({ label: `Type ${f.caseTypeId}`, spec: { endpoint: 'GetCaseListByCaseTypeId', shape: 'nested', body: { caseTypeId: f.caseTypeId, subOutFilter: sub } } });
  if (has(f.staffId)) {
    const who = f.staffName ? f.staffName : `Staff ${f.staffId}`;
    specs.push({
      label: f.staffJobRole ? `${who} — ${f.staffJobRole}` : who,
      spec: {
        endpoint: 'GetCaseListByStaffId', shape: 'nested',
        body: { staffId: f.staffId, ...(f.staffJobRole ? { jobRole: f.staffJobRole } : {}), subOutFilter: sub },
      },
    });
  }
  if (f.lastNameInitial)
    specs.push({ label: `Last name ${f.lastNameInitial.toUpperCase()}`, spec: { endpoint: 'GetCaseListByLastNameInitial', shape: 'nested', body: { lastNameInitial: f.lastNameInitial.trim().charAt(0).toUpperCase(), subOutFilter: sub } } });
  if (f.caseFromDate || f.caseToDate)
    specs.push({ label: `Case date ${f.caseFromDate ?? ''}–${f.caseToDate ?? ''}`, spec: { endpoint: 'GetCaseListByCaseDate', shape: 'nested', body: caseDateRequestBody(f.caseFromDate, f.caseToDate, sub) } });
  if (has(f.venueId))
    specs.push({ label: `Venue ${f.venueId}`, spec: { endpoint: 'GetCaseListByCaseVenueId', shape: 'flat', body: { venueId: f.venueId } } });
  if (has(f.caseSubTypeId))
    specs.push({ label: `Sub-Type ${f.caseSubTypeId}`, spec: { endpoint: 'GetCaseListByCaseSubTypeId', shape: 'flat', body: { caseSubTypeId: f.caseSubTypeId } } });
  if (has(f.caseSubStatusId))
    specs.push({ label: `Sub-Status ${f.caseSubStatusId}`, spec: { endpoint: 'GetCaseListByCaseSubStatusId', shape: 'flat', body: { caseSubStatusId: f.caseSubStatusId } } });
  if (has(f.caseSubStatusId2))
    specs.push({ label: `Sub-Status2 ${f.caseSubStatusId2}`, spec: { endpoint: 'GetCaseListByCaseSubStatusId2', shape: 'flat', body: { caseSubStatusId2: f.caseSubStatusId2 } } });
  if (f.specialInstructions)
    specs.push({ label: `Special "${f.specialInstructions}"`, spec: { endpoint: 'GetCaseListBySpecialInstruction', shape: 'flat', body: { specialInstructions: f.specialInstructions.trim() } } });
  if (f.solFromDate || f.solToDate)
    specs.push({ label: `SOL ${f.solFromDate ?? ''}–${f.solToDate ?? ''}`, spec: { endpoint: 'GetCaseListBySolDate', shape: 'flat', body: { ...(f.solFromDate ? { solFromDate: f.solFromDate } : {}), ...(f.solToDate ? { solToDate: f.solToDate } : {}) } } });
  if (f.bodyPartIds && f.bodyPartIds.length > 0)
    specs.push({ label: `Body parts [${[...f.bodyPartIds].sort((a, b) => a - b).join(',')}]`, spec: { endpoint: 'GetCaseListByBodyPartIds', shape: 'flat', body: { bodyPartIds: [...f.bodyPartIds].sort((a, b) => a - b) } } });

  return specs;
}

const STATUS_LABELS: Record<number, string> = { 1: 'All', 2: 'Open', 3: 'Closed', 4: 'Sub-Out' };

function buildLabel(f: CombinedFilters, specs: { label: string }[]): string {
  const parts = specs.map((s) => s.label);
  if (f.applicantName) parts.push(`Applicant "${f.applicantName}"`);
  if (f.status && f.status !== 1) parts.unshift(STATUS_LABELS[f.status] ?? `Status ${f.status}`);
  return parts.join(' + ') || 'Combined search';
}

export async function combinedSearch(
  deps: { apiBaseUrl: string; jwtToken: string },
  filters: CombinedFilters,
  page = 1,
): Promise<FilterToolOutput> {
  const filterValue = encodeCombinedFilters(filters);
  const specs = buildSpecs(filters);
  const filterLabel = buildLabel(filters, specs);

  console.log('[combinedSearch] filters:', JSON.stringify(filters), '| specs:', specs.map((s) => s.spec.endpoint).join(','));

  const fail = (error: string): FilterToolOutput => ({
    success: false, filterType: 'combined', filterLabel, filterValue,
    cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
  });

  if (specs.length === 0 && !filters.applicantName) {
    return fail('Please provide at least one concrete filter (name, type, venue, staff, dates, body part, etc.).');
  }

  let all = readCache(filterValue);
  if (!all) {
    // Fetch every endpoint-based filter's full set in parallel.
    const results = await Promise.all(specs.map((s) => fetchAllCases(deps, s.spec)));
    console.log('[combinedSearch] fetched sizes:', specs.map((s, i) => `${s.spec.endpoint}=${results[i].success ? results[i].cases.length : 'FAIL:' + results[i].error}`).join(', '));
    const bad = results.find((r) => !r.success);
    if (bad) return fail(bad.error ?? 'A filter lookup failed.');

    // Each set is tagged "rich" when it carries the full row (status/type/
    // applicant). Nested filter endpoints are rich; flat ones are not.
    const sets: { rich: boolean; cases: CaseSearchItem[] }[] = specs.map((s, idx) => ({
      rich: s.spec.shape === 'nested',
      cases: results[idx].cases,
    }));

    // Applicant / client NAME filter — matched via the main case-search endpoint
    // (it searches applicant + company + case number). It returns full rows, so
    // it's a RICH set; fetched whole and intersected like any other filter.
    if (filters.applicantName) {
      const appRes = await searchCasesPaginated({
        apiBaseUrl: deps.apiBaseUrl, jwtToken: deps.jwtToken,
        searchText: filters.applicantName, searchType: 1, page: 1, pageSize: 100000,
      });
      console.log('[combinedSearch] applicant set:', appRes.success ? appRes.cases.length : 'FAIL:' + appRes.error);
      if (!appRes.success) return fail(appRes.error ?? 'Applicant search failed.');
      if (appRes.cases.length === 0) return fail(`No cases found for applicant/client "${filters.applicantName}".`);
      sets.push({ rich: true, cases: appRes.cases });
    }

    const richSets = sets.filter((s) => s.rich).map((s) => s.cases);

    // Display base must be rich so status filtering + card rendering work.
    // Prefer the smallest rich set; if the combo is all-flat, derive a rich base
    // from a status-scoped search (when a status is set) else use the flat set.
    let base: CaseSearchItem[];
    if (richSets.length > 0) {
      base = richSets.slice().sort((a, b) => a.length - b.length)[0];
    } else if (filters.status && filters.status !== 1) {
      const st = await searchCasesPaginated({
        apiBaseUrl: deps.apiBaseUrl, jwtToken: deps.jwtToken,
        searchText: '', searchType: filters.status, page: 1, pageSize: 100000,
      });
      base = st.success && st.cases.length > 0
        ? st.cases
        : sets.slice().sort((a, b) => a.cases.length - b.cases.length)[0].cases;
    } else {
      base = sets.slice().sort((a, b) => a.cases.length - b.cases.length)[0].cases;
    }

    // Intersect the base against EVERY supplied filter set by id (a set ∩ itself
    // is a harmless no-op).
    for (const s of sets) {
      const idSet = new Set(s.cases.map((c) => c.id));
      base = base.filter((c) => idSet.has(c.id));
    }

    // Status (searchType) in-memory — endpoints ignore it. Idempotent if base was
    // already status-scoped above.
    if (filters.status && filters.status !== 1) base = filterCasesByType(base, filters.status);

    all = base;
    writeCache(filterValue, all);
  }

  console.log('[combinedSearch] result totalRecords:', all.length);
  const totalRecords = all.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / FILTER_PAGE_SIZE);
  const safePage = totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * FILTER_PAGE_SIZE;

  return {
    success: true, filterType: 'combined', filterLabel, filterValue,
    cases: all.slice(start, start + FILTER_PAGE_SIZE),
    totalRecords, totalPages,
    hasMorePages: safePage < totalPages,
    page: safePage,
  };
}
