import type { CaseParty, CasePartyDoc, PartiesToolOutput } from '@/types/caseParties';

interface FetchCasePartiesOpts {
  apiBaseUrl: string;
  jwtToken: string;
  caseId?: number;
  caseNumber?: string;
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

export async function fetchCaseParties(
  opts: FetchCasePartiesOpts,
): Promise<PartiesToolOutput> {
  const { apiBaseUrl, jwtToken, caseId, caseNumber } = opts;

  if (caseId === undefined && !caseNumber) {
    return { success: false, error: 'Provide caseId or caseNumber.' };
  }

  const caseRef: string = caseNumber ?? `case-${caseId}`;

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
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error';
    return { success: false, error: message };
  }
}
