import type { FilterToolOutput } from '@/types/caseFilters';
import { fetchCombinedCases, fetchCasesByStatusLabel } from '@/lib/caseFilters';

/**
 * Combined (AND) filtering across the case filters.
 *
 * Engine: ONE server-side call to POST /api/Case/GetCaseListCombined, which
 * AND-combines every supplied filter and returns the standard nested envelope
 * (rich rows + real pagination). Any subset of filters works; a case is returned
 * only if it matches ALL supplied ones. `status` maps to the endpoint's
 * `searchType` (honoured server-side — no in-memory status pass), and the
 * applicant/client NAME maps to `searchText` (which matches applicant, company,
 * and case number). Replaces the previous client-side "fetch every filter's full
 * set and intersect by id" approach.
 */
export interface CombinedFilters {
  caseTypeId?: number;
  venueId?: number;
  staffId?: number;
  staffName?: string;          // label only (resolved to staffId by the tool)
  staffJobRole?: string;       // verified case-slot string (Attorney/Paralegal/…) for the staff filter
  applicantName?: string;      // client / injured-worker name (mapped to searchText)
  status?: number;             // searchType 1–4 (mapped to the endpoint's searchType)
  /**
   * A detailed case-status LABEL (e.g. "Settled", "Sub-d Out", "Dismissed") —
   * the granular categories on the backend's "Employee Workload" admin screen,
   * distinct from `status` (the simple Open/Closed/Sub-Out toggle). Resolved to
   * live status ID(s) via lib/caseStatus.ts at query time — never hard-coded,
   * since IDs (and even which labels exist) are firm-specific data.
   */
  caseStatusLabel?: string;
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

/** Stable key so pagination + repeat queries encode identically regardless of field order. */
export function encodeCombinedFilters(f: CombinedFilters): string {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(f).sort()) {
    const v = (f as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) ordered[k] = v;
  }
  return JSON.stringify(ordered);
}

const STATUS_LABELS: Record<number, string> = { 1: 'All', 2: 'Open', 3: 'Closed', 4: 'Sub-Out' };

const has = (n?: number): n is number => typeof n === 'number' && n > 0;
const str = (s?: string): s is string => typeof s === 'string' && s.trim() !== '';

/** Map CombinedFilters → the GetCaseListCombined request body (only supplied fields). */
function buildCombinedRequestBody(f: CombinedFilters): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (has(f.caseTypeId)) body.caseTypeId = f.caseTypeId;
  if (has(f.venueId)) body.venueId = f.venueId;
  if (has(f.staffId)) body.staffId = f.staffId;
  if (str(f.staffJobRole)) body.staffRole = f.staffJobRole.trim();
  // status 1 (All) and undefined both mean "no status restriction" → omit.
  // A caseStatusLabel query is already fully specific — layering the coarse
  // Open/Closed/Sub-Out toggle on top would silently AND-narrow it further
  // (e.g. "Settled" gets misread by explicitStatusFromText as status=Closed,
  // "Sub-d Out" as status=Sub-Out), risking a wrong or zeroed count on any
  // label that isn't a strict subset of that guessed toggle. Skip it here.
  if (!str(f.caseStatusLabel) && f.status && f.status >= 2 && f.status <= 4) body.searchType = f.status;
  if (str(f.lastNameInitial)) body.lastNameInitial = f.lastNameInitial.trim().charAt(0).toUpperCase();
  if (f.bodyPartIds && f.bodyPartIds.length > 0) body.bodyPartIds = [...f.bodyPartIds].sort((a, b) => a - b);
  if (str(f.solFromDate)) body.solFromDate = f.solFromDate;
  if (str(f.solToDate)) body.solToDate = f.solToDate;
  if (str(f.caseFromDate)) body.caseFromDate = f.caseFromDate;
  if (str(f.caseToDate)) body.caseToDate = f.caseToDate;
  if (str(f.specialInstructions)) body.specialInstructions = f.specialInstructions.trim();
  if (has(f.caseSubTypeId)) body.caseSubTypeId = f.caseSubTypeId;
  if (has(f.caseSubStatusId)) body.caseSubStatusId = f.caseSubStatusId;
  if (has(f.caseSubStatusId2)) body.caseSubStatusId2 = f.caseSubStatusId2;
  // caseStatusLabel is NOT a literal API field — combinedSearch() resolves it to
  // live status id(s) via fetchCasesByStatusLabel instead of sending it here.
  // Applicant / client name → searchText (endpoint matches applicant + company + case number).
  if (str(f.applicantName)) body.searchText = f.applicantName.trim();
  body.subOutFilter = f.subOutFilter ?? 'include';
  return body;
}

/** Human-readable label for the result card header. */
function buildLabel(f: CombinedFilters): string {
  const parts: string[] = [];
  // Skip the coarse Open/Closed/Sub-Out label when a detailed caseStatusLabel is
  // present — it's redundant at best (and was never applied to the query; see
  // buildCombinedRequestBody) and misleadingly implies a second filter was used.
  if (!str(f.caseStatusLabel) && f.status && f.status !== 1) parts.push(STATUS_LABELS[f.status] ?? `Status ${f.status}`);
  if (str(f.caseStatusLabel)) parts.push(f.caseStatusLabel.trim());
  if (has(f.caseTypeId)) parts.push(`Type ${f.caseTypeId}`);
  if (has(f.caseSubTypeId)) parts.push(`Sub-Type ${f.caseSubTypeId}`);
  if (has(f.caseSubStatusId)) parts.push(`Sub-Status ${f.caseSubStatusId}`);
  if (has(f.caseSubStatusId2)) parts.push(`Sub-Status2 ${f.caseSubStatusId2}`);
  if (has(f.venueId)) parts.push(`Venue ${f.venueId}`);
  if (has(f.staffId)) {
    const who = f.staffName ? f.staffName : `Staff ${f.staffId}`;
    parts.push(f.staffJobRole ? `${who} — ${f.staffJobRole}` : who);
  }
  if (str(f.lastNameInitial)) parts.push(`Last name ${f.lastNameInitial.trim().charAt(0).toUpperCase()}`);
  if (f.caseFromDate || f.caseToDate) parts.push(`Case date ${f.caseFromDate ?? ''}–${f.caseToDate ?? ''}`);
  if (f.solFromDate || f.solToDate) parts.push(`SOL ${f.solFromDate ?? ''}–${f.solToDate ?? ''}`);
  if (f.bodyPartIds && f.bodyPartIds.length > 0) parts.push(`Body parts [${[...f.bodyPartIds].sort((a, b) => a - b).join(',')}]`);
  if (str(f.specialInstructions)) parts.push(`Special "${f.specialInstructions.trim()}"`);
  if (str(f.applicantName)) parts.push(`Applicant "${f.applicantName.trim()}"`);
  return parts.join(' + ') || 'Combined search';
}

export async function combinedSearch(
  deps: { apiBaseUrl: string; jwtToken: string },
  filters: CombinedFilters,
  page = 1,
): Promise<FilterToolOutput> {
  const filterValue = encodeCombinedFilters(filters);
  const filterLabel = buildLabel(filters);

  const fail = (error: string): FilterToolOutput => ({
    success: false, filterType: 'combined', filterLabel, filterValue,
    cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
  });

  // Client-side date-range guard — the endpoint silently returns 0 for a reversed
  // range instead of an error, which reads as "no matches." Tell the user instead.
  if (str(filters.caseFromDate) && str(filters.caseToDate) && filters.caseFromDate > filters.caseToDate)
    return fail('The case date range looks reversed — the "from" date is after the "to" date. Please give the earlier date first.');
  if (str(filters.solFromDate) && str(filters.solToDate) && filters.solFromDate > filters.solToDate)
    return fail('The SOL date range looks reversed — the "from" date is after the "to" date. Please give the earlier date first.');

  const body = buildCombinedRequestBody(filters);
  // Reject an empty combined call (no real filter — subOutFilter alone doesn't count),
  // so we never return the entire case list when the model calls the tool with nothing.
  // caseStatusLabel is deliberately NOT one of `body`'s keys (see buildCombinedRequestBody
  // above — it's resolved separately via fetchCasesByStatusLabel below), so it must be
  // checked here explicitly too — otherwise a status-label-ONLY query (e.g. "dismissed
  // cases", "settled cases") has zero keys in `body` and was wrongly rejected as if no
  // filter had been given at all, live-verified 2026-07-19 (QA round 3) across every
  // detailed status label.
  const filterKeys = Object.keys(body).filter((k) => k !== 'subOutFilter');
  if (filterKeys.length === 0 && !str(filters.caseStatusLabel)) {
    return fail('Please provide at least one concrete filter (name, type, venue, staff, dates, body part, etc.).');
  }

  console.log('[combinedSearch] filters:', JSON.stringify(filters), '| body:', JSON.stringify(body), '| page:', page);

  if (str(filters.caseStatusLabel)) {
    // Detailed status label (Settled/Sub-d Out/…) needs live id resolution +
    // client-side merge across firm-specific (caseTypeId, statusId) pairs —
    // a different engine than the single-shot combined call below. `body` has
    // no caseStatusId of its own (CombinedFilters doesn't expose one), so it's
    // a safe base to layer the resolved caseTypeId/caseStatusId onto per pair.
    return fetchCasesByStatusLabel({
      apiBaseUrl: deps.apiBaseUrl, jwtToken: deps.jwtToken,
      statusLabel: filters.caseStatusLabel.trim(),
      baseBody: body, page, filterLabel, filterValue,
    });
  }

  return fetchCombinedCases({
    apiBaseUrl: deps.apiBaseUrl, jwtToken: deps.jwtToken,
    body, filterLabel, filterValue, page,
  });
}
