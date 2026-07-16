/**
 * Live lookup for the backend's detailed case-status taxonomy, sourced from
 * GET /api/SettlementReport/GetCaseStatus. Unlike body parts (a fixed, universal
 * list — see lib/bodyParts.ts), case statuses are FIRM-SPECIFIC data: the same
 * label (e.g. "Settled") can carry different IDs per case type, and — verified
 * live against the UAT backend, 2026-07-16 — the SAME label can even have
 * several different IDs within one case type (legacy duplicate rows). Hard-
 * coding any ID here would silently break on a different firm's data or miss
 * a duplicate block, so every lookup goes through this module at request time.
 */
export interface CaseStatusEntry {
  id: number;
  caseStatusDescription: string;
  caseStatusGroupId: number;
  caseTypeId: number;
  caseType: string;
}

interface CaseStatusCache {
  token: string;
  entries: CaseStatusEntry[];
  fetchedAt: number;
}

let cache: CaseStatusCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Fetches (and briefly caches, per JWT/firm) the full case-status reference table. */
export async function fetchCaseStatusList(opts: {
  apiBaseUrl: string;
  jwtToken: string;
}): Promise<CaseStatusEntry[]> {
  if (cache && cache.token === opts.jwtToken && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.entries;
  }

  const res = await fetch(`${opts.apiBaseUrl}/api/SettlementReport/GetCaseStatus`, {
    headers: { Authorization: `Bearer ${opts.jwtToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GetCaseStatus failed: ${res.status}`);
  const json = (await res.json()) as { data?: CaseStatusEntry[] } | CaseStatusEntry[];
  const entries = Array.isArray(json) ? json : (json.data ?? []);

  cache = { token: opts.jwtToken, entries, fetchedAt: Date.now() };
  return entries;
}

/** Distinct case types this firm actually has configured (from the live table). */
export function listCaseTypes(entries: CaseStatusEntry[]): { caseTypeId: number; caseType: string }[] {
  const seen = new Map<number, string>();
  for (const e of entries) if (!seen.has(e.caseTypeId)) seen.set(e.caseTypeId, e.caseType);
  return [...seen.entries()].map(([caseTypeId, caseType]) => ({ caseTypeId, caseType }));
}

/**
 * Every status ID whose label matches (case-insensitive, trimmed) — across ALL
 * legacy duplicate rows for that label, optionally narrowed to one case type.
 * `groupId` defaults to 1 (the primary/dropdown status, matching what the admin
 * "Employee Workload" screen shows) — groups 2/3 are detailed litigation
 * sub-stages, a different concept.
 */
export function resolveStatusIds(
  entries: CaseStatusEntry[],
  label: string,
  opts: { caseTypeId?: number; groupId?: number } = {},
): number[] {
  const norm = label.trim().toLowerCase();
  const groupId = opts.groupId ?? 1;
  return entries
    .filter((e) => e.caseStatusDescription.trim().toLowerCase() === norm)
    .filter((e) => opts.caseTypeId === undefined || e.caseTypeId === opts.caseTypeId)
    .filter((e) => e.caseStatusGroupId === groupId)
    .map((e) => e.id);
}

/** Up to `limit` distinct labels that CONTAIN the search text — used to suggest
 *  a correction when the exact label isn't found (typo, or firm doesn't have it). */
export function suggestStatusLabels(
  entries: CaseStatusEntry[],
  label: string,
  opts: { caseTypeId?: number; groupId?: number; limit?: number } = {},
): string[] {
  const norm = label.trim().toLowerCase();
  const groupId = opts.groupId ?? 1;
  const seen = new Set<string>();
  for (const e of entries) {
    if (opts.caseTypeId !== undefined && e.caseTypeId !== opts.caseTypeId) continue;
    if (e.caseStatusGroupId !== groupId) continue;
    const desc = e.caseStatusDescription.trim();
    if (desc.toLowerCase().includes(norm) || norm.includes(desc.toLowerCase())) seen.add(desc);
  }
  return [...seen].slice(0, opts.limit ?? 5);
}
