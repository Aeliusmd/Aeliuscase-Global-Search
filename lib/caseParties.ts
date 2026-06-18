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

export async function fetchCaseParties(
  opts: FetchCasePartiesOpts,
): Promise<PartiesToolOutput> {
  const { apiBaseUrl, jwtToken, caseId, caseNumber } = opts;

  if (caseId === undefined && !caseNumber) {
    return { success: false, error: 'Provide caseId or caseNumber.' };
  }

  let url: string;
  const caseRef: string = caseNumber ?? `case-${caseId}`;

  if (caseNumber) {
    url = `${apiBaseUrl}/api/CaseParties/GetAllPartiesWithDocsbyCaseNumber/${encodeURIComponent(caseNumber)}`;
  } else {
    url = `${apiBaseUrl}/api/CaseParties/GetAllPartiesWithDocsbyCaseId/${caseId}`;
  }

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
