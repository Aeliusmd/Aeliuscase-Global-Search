import type { CaseParty, CasePartyCandidate, CasePartyDoc, CasePartyGroup, PartiesToolOutput } from '@/types/caseParties';

interface FetchCasePartiesOpts {
  apiBaseUrl: string;
  jwtToken: string;
  caseId?: number;
  caseNumber?: string;
  caseName?: string;
}

interface UpstreamResponse {
  status?: number;
  succeeded?: boolean;
  data?: unknown[];
}

/**
 * Resolve a human case number (e.g. "RP2476") to its numeric caseId using the
 * combined search endpoint (searchText matches the case number). Needed because
 * the parties-by-caseNumber endpoint is broken (404); only by-caseId works.
 */
async function resolveCaseId(
  apiBaseUrl: string, jwtToken: string, caseNumber: string,
): Promise<number | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/Case/GetCaseListCombined`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ searchText: caseNumber.trim(), page: 1, pageSize: 5 }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { cases?: { id: number; caseNumber?: string; fileNumber?: string }[] } };
    const cases = json?.data?.cases ?? [];
    if (cases.length === 0) return null;
    // Prefer an exact caseNumber/fileNumber match; else fall back to the first row.
    const want = caseNumber.trim().toLowerCase();
    const exact = cases.find(
      (c) => c.caseNumber?.toLowerCase() === want || c.fileNumber?.toLowerCase() === want,
    );
    return (exact ?? cases[0]).id ?? null;
  } catch {
    return null;
  }
}

type CaseNameResolution =
  | { kind: 'found'; id: number }
  | { kind: 'ambiguous'; candidates: CasePartyCandidate[] }
  | { kind: 'not-found' };

type CaseSearchRow = { id?: number; caseNumber?: string; caseName?: string; caseType?: string; caseStatus?: string };

async function searchCasesByText(
  apiBaseUrl: string, jwtToken: string, searchText: string, pageSize: number,
): Promise<CaseSearchRow[]> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/Case/GetCaseListCombined`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ searchText: searchText.trim(), page: 1, pageSize }),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { cases?: CaseSearchRow[] } };
    return json?.data?.cases ?? [];
  } catch {
    return [];
  }
}

/** Matches the "vs"/"v." separator in dashboard-style case names ("[Applicant] vs [Company]"). */
const VS_SEPARATOR_RE = /\s+(?:vs\.?|v\.)\s+/i;

/**
 * Live bug fixed 2026-07-29: getCaseParties previously only accepted
 * caseNumber/caseId, so a question naming the case by NAME ("what are the
 * parties in the Tharushi samindika Perera vs MedcubeUSA LLC case?") gave the
 * model no correct field to put it in — it jammed the full name string into
 * caseNumber, which 404'd even though the case genuinely exists (confirmed
 * live: same case resolves fine via caseNumber "AE00224").
 *
 * Adding the field surfaced a SECOND live bug: the backend's own search
 * (GetCaseListCombined) doesn't match the full "[Applicant] vs [Company]"
 * string at all — verified directly: searchText="Tharushi samindika Perera vs
 * MedcubeUSA LLC" returns 0 results, while searchText="Tharushi samindika
 * Perera" (just the applicant-name portion) returns exactly the 1 correct
 * case. So a search with the caseName AS GIVEN is retried with just the
 * portion before " vs "/" v. " when it comes up empty.
 *
 * Unlike caseNumber (unique, exact-match-or-first-row via resolveCaseId
 * above), a case NAME is free text and can genuinely match more than one
 * case, so this mirrors GetCaseFullDetail's own ambiguous/candidates
 * handling (lib/caseFullDetail.ts) rather than silently picking a row.
 */
const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pick the candidates that actually match the FULL "[Applicant] vs [Company]"
 * name the user gave.
 *
 * The applicant-part retry below is what makes a name resolvable at all, but it
 * throws away the half that disambiguates: searching "Thomas Smith" returns
 * "Thomas Smith vs Matrix", "Thomas Smith vs YUGANDD" and "Thomas Smith", so a
 * perfectly specific question was answered with "which one did you mean?"
 * (live 2026-08-24). Comparing the full name against each candidate's own
 * caseName picks the one the user actually named; a genuinely ambiguous name
 * still returns everything.
 */
function narrowByFullName(cases: CaseSearchRow[], caseName: string): CaseSearchRow[] {
  const target = normalizeName(caseName);
  if (!target) return cases;

  const exact = cases.filter((c) => typeof c.caseName === 'string' && normalizeName(c.caseName) === target);
  if (exact.length > 0) return exact;

  // The stored name often carries a suffix the user omits ("... LLC"), so fall
  // back to candidates containing every word of what they typed.
  const words = target.split(' ').filter((w) => w.length > 1);
  if (words.length === 0) return cases;
  const contains = cases.filter((c) => {
    if (typeof c.caseName !== 'string') return false;
    const haystack = normalizeName(c.caseName);
    return words.every((w) => haystack.includes(w));
  });
  return contains.length > 0 ? contains : cases;
}

async function resolveCaseIdByName(
  apiBaseUrl: string, jwtToken: string, caseName: string,
): Promise<CaseNameResolution> {
  let cases = await searchCasesByText(apiBaseUrl, jwtToken, caseName, 10);

  if (cases.length === 0) {
    const match = caseName.match(VS_SEPARATOR_RE);
    const applicantPart = match?.index ? caseName.slice(0, match.index).trim() : '';
    if (applicantPart) {
      cases = await searchCasesByText(apiBaseUrl, jwtToken, applicantPart, 10);
    }
  }

  if (cases.length === 0) return { kind: 'not-found' };
  if (cases.length > 1) cases = narrowByFullName(cases, caseName);

  if (cases.length === 1) {
    const id = cases[0]?.id;
    return typeof id === 'number' ? { kind: 'found', id } : { kind: 'not-found' };
  }

  return {
    kind: 'ambiguous',
    candidates: cases.map((c) => ({
      id: typeof c?.id === 'number' ? c.id : null,
      caseNumber: typeof c?.caseNumber === 'string' ? c.caseNumber : null,
      caseName: typeof c?.caseName === 'string' ? c.caseName : null,
      caseType: typeof c?.caseType === 'string' ? c.caseType : null,
      caseStatus: typeof c?.caseStatus === 'string' ? c.caseStatus : null,
    })),
  };
}

/**
 * Resolve a human case number to the numeric venueId of that case, via the
 * combined endpoint (whose rows carry venueId). Used to answer anaphoric
 * "how many cases are in THAT venue?" — the venue of the case the user was just
 * viewing — without asking them to name the venue.
 */
export async function resolveCaseVenueId(
  apiBaseUrl: string, jwtToken: string, caseNumber: string,
): Promise<number | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/Case/GetCaseListCombined`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ searchText: caseNumber.trim(), page: 1, pageSize: 5 }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { cases?: { caseNumber?: string; fileNumber?: string; venueId?: number }[] } };
    const cases = json?.data?.cases ?? [];
    if (cases.length === 0) return null;
    const want = caseNumber.trim().toLowerCase();
    const exact = cases.find(
      (c) => c.caseNumber?.toLowerCase() === want || c.fileNumber?.toLowerCase() === want,
    );
    const v = (exact ?? cases[0]).venueId;
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}

const GROUP_NAME_CAP = 5;

/**
 * Collapses parties with the same partyType into one summary row — see
 * CasePartyGroup's doc comment for why (live UAT case with 12+ near-duplicate
 * "Applicant Attorney" rows). Order follows first appearance in `parties`;
 * names are deduped and capped so one messy party type can't blow up the
 * response even when the row count is large.
 */
function groupParties(parties: CaseParty[]): CasePartyGroup[] {
  const order: string[] = [];
  const byType = new Map<string, { count: number; nameSet: Set<string>; names: string[] }>();

  for (const party of parties) {
    const type = party.partyType || 'Unknown';
    let group = byType.get(type);
    if (!group) {
      group = { count: 0, nameSet: new Set(), names: [] };
      byType.set(type, group);
      order.push(type);
    }
    group.count += 1;
    const name = party.partyName.trim();
    if (name && !group.nameSet.has(name)) {
      group.nameSet.add(name);
      group.names.push(name);
    }
  }

  return order.map((type) => {
    const group = byType.get(type)!;
    return {
      partyType: type,
      count: group.count,
      names: group.names.slice(0, GROUP_NAME_CAP),
      truncated: group.names.length > GROUP_NAME_CAP,
    };
  });
}

export async function fetchCaseParties(
  opts: FetchCasePartiesOpts,
): Promise<PartiesToolOutput> {
  const { apiBaseUrl, jwtToken, caseId, caseNumber, caseName } = opts;

  if (caseId === undefined && !caseNumber && !caseName) {
    return { success: false, error: 'Provide caseId, caseNumber, or caseName.' };
  }

  const caseRef: string = caseNumber ?? caseName ?? `case-${caseId}`;

  // The by-caseNumber parties endpoint returns 404; only by-caseId works. When a
  // case NUMBER is given we resolve it to a caseId ourselves — and we PREFER the
  // resolved id over any model-supplied caseId, because the model often invents a
  // caseId that doesn't match the case number it also passed.
  let effectiveCaseId = caseId;
  if (caseNumber) {
    const resolved = await resolveCaseId(apiBaseUrl, jwtToken, caseNumber);
    if (resolved === null) {
      return { success: false, error: `Case "${caseNumber}" not found.` };
    }
    effectiveCaseId = resolved;
  } else if (caseName) {
    const resolution = await resolveCaseIdByName(apiBaseUrl, jwtToken, caseName);
    if (resolution.kind === 'not-found') {
      return { success: false, error: `Case "${caseName}" not found.` };
    }
    if (resolution.kind === 'ambiguous') {
      return { success: false, ambiguous: true, candidates: resolution.candidates };
    }
    effectiveCaseId = resolution.id;
  }

  const url = `${apiBaseUrl}/api/CaseParties/GetAllPartiesWithDocsbyCaseId/${effectiveCaseId}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return { success: false, error: `API error ${res.status}` };
    }

    const body = (await res.json()) as UpstreamResponse;

    // Live PII exposure bug (2026-07-27, case RP003668) — `{...party}` spread
    // the ENTIRE raw upstream party row through to the model/chat response
    // unfiltered. The CaseParty type here only declares partyType/partyName/
    // docs (verified 2026-07-13), but that's a compile-time annotation only —
    // it does nothing to stop extra raw fields (this case's row apparently
    // carried SSN, DOB, and injury/occupation detail) from surviving the
    // spread at runtime. Explicitly allowlisting exactly the 3 documented
    // fields, whatever else the upstream row contains, is the fix — same
    // discipline already used by every Phase 2 mapper in lib/caseFullDetail.ts.
    const parties: CaseParty[] = (body?.data ?? []).map((raw) => {
      const p = raw as { partyType?: unknown; partyName?: unknown; docs?: unknown };
      return {
        partyType: typeof p?.partyType === 'string' ? p.partyType : '',
        partyName: typeof p?.partyName === 'string' ? p.partyName : '',
        docs: Array.isArray(p?.docs) ? (p.docs as CasePartyDoc[]) : [],
      };
    });

    const partyDocs: CasePartyDoc[] = parties.flatMap(
      (party) => party.docs ?? [],
    );

    return {
      success: true,
      caseRef,
      parties,
      partyDocs,
      partyGroups: groupParties(parties),
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error';
    return { success: false, error: message };
  }
}
