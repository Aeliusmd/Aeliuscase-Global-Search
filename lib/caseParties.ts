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
  data?: CaseParty[];
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

    const parties: CaseParty[] = (body?.data ?? []).map((party) => ({
      ...party,
      partyDocs: party?.partyDocs ?? [],
    }));

    const partyDocs: CasePartyDoc[] = parties.flatMap(
      (party) => party.partyDocs ?? [],
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
