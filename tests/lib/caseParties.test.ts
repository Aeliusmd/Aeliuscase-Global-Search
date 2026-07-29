import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCaseParties } from '@/lib/caseParties';

describe('fetchCaseParties', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // Live PII exposure bug (2026-07-27, case RP003668): the upstream
  // GetAllPartiesWithDocsbyCaseId row for this case carried raw ssn/dob/
  // occupation fields alongside partyType/partyName, and the old code
  // (`{...party, docs: ...}`) spread every one of them straight through to
  // the tool output — which the chatbot then read out to the user, including
  // the applicant's Social Security Number. The fix allowlists exactly the
  // 3 documented fields (partyType, partyName, docs) no matter what else the
  // raw row contains.
  it('never lets raw upstream fields (ssn, dob, occupation, ...) through, even if the row carries them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 200,
          succeeded: true,
          data: [
            {
              partyType: 'Applicant',
              partyName: 'Elgin Perdomo',
              ssn: '623-76-0507',
              dob: '1978-09-23',
              occupation: 'Security Guard',
              docs: [],
            },
          ],
        }),
      }),
    );

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseId: 9686,
    });

    expect(result.success).toBe(true);
    expect(result.parties).toHaveLength(1);
    const party = result.parties?.[0] as unknown as Record<string, unknown>;
    expect(party.partyType).toBe('Applicant');
    expect(party.partyName).toBe('Elgin Perdomo');
    expect(Object.keys(party).sort()).toEqual(['docs', 'partyName', 'partyType']);
    expect(JSON.stringify(result)).not.toContain('623-76-0507');
    expect(JSON.stringify(result)).not.toContain('Security Guard');
  });

  it('defaults partyType/partyName to empty strings and docs to [] when the row is missing/malformed fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, succeeded: true, data: [{}] }),
      }),
    );

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseId: 1,
    });

    expect(result.parties?.[0]).toEqual({ partyType: '', partyName: '', docs: [] });
  });
});

// Live bug fixed 2026-07-29: getCaseParties only accepted caseNumber/caseId,
// so "what are the parties in the Tharushi samindika Perera vs MedcubeUSA LLC
// case?" gave the model no correct field for the case NAME — it jammed the
// full name string into caseNumber, which 404'd even though the case (real
// caseNumber "AE-00224") genuinely exists. caseName now resolves via a
// GetCaseListCombined search, mirroring GetCaseFullDetail's own
// ambiguous/candidates handling for a name that matches more than one case.
describe('fetchCaseParties — caseName resolution', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(searchCases: unknown[], partiesRows: unknown[] = []) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('GetCaseListCombined')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { cases: searchCases } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, succeeded: true, data: partiesRows }),
      });
    }));
  }

  /** Simulates the real backend: the FIRST search call (full "X vs Y" string) returns
   *  empty, the SECOND call (applicant-name-only retry) returns the match. */
  function mockFetchEmptyThenMatch(retryCases: unknown[], partiesRows: unknown[] = []) {
    const searchCalls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => {
      if (String(url).includes('GetCaseListCombined')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        searchCalls.push(body.searchText);
        const cases = searchCalls.length === 1 ? [] : retryCases;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { cases } }) });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ status: 200, succeeded: true, data: partiesRows }),
      });
    }));
    return searchCalls;
  }

  // Live bug fixed 2026-07-29 (second layer, found right after the first):
  // the backend's own search doesn't match the full "[Applicant] vs [Company]"
  // case name at all (0 results), only the applicant-name portion before the
  // separator. Confirmed directly: searchText="Tharushi samindika Perera vs
  // MedcubeUSA LLC" -> 0 results; searchText="Tharushi samindika Perera" -> 1.
  it('retries with just the applicant-name portion when the full "X vs Y" string matches nothing', async () => {
    const searchCalls = mockFetchEmptyThenMatch(
      [{ id: 224, caseNumber: 'AE-00224', caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC ' }],
      [{ partyType: 'Attorney', partyName: 'Medcube USA', docs: [] }],
    );

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
    });

    expect(searchCalls).toEqual(['Tharushi samindika Perera vs MedcubeUSA LLC', 'Tharushi samindika Perera']);
    expect(result.success).toBe(true);
    expect(result.parties).toHaveLength(1);
  });

  it('resolves a unique caseName match and fetches its parties', async () => {
    mockFetch(
      [{ id: 224, caseNumber: 'AE-00224', caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC' }],
      [{ partyType: 'Attorney', partyName: 'Medcube USA', docs: [] }],
    );

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
    });

    expect(result.success).toBe(true);
    expect(result.ambiguous).toBeUndefined();
    expect(result.parties).toHaveLength(1);
  });

  it('returns ambiguous:true with candidates when caseName matches more than one case', async () => {
    mockFetch([
      { id: 1, caseNumber: 'RP0001', caseName: 'Smith vs Acme', caseType: 'WC', caseStatus: 'Open' },
      { id: 2, caseNumber: 'RP0002', caseName: 'Smith vs Acme Corp', caseType: 'WC', caseStatus: 'Closed' },
    ]);

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseName: 'Smith vs Acme',
    });

    expect(result.success).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toEqual([
      { id: 1, caseNumber: 'RP0001', caseName: 'Smith vs Acme', caseType: 'WC', caseStatus: 'Open' },
      { id: 2, caseNumber: 'RP0002', caseName: 'Smith vs Acme Corp', caseType: 'WC', caseStatus: 'Closed' },
    ]);
    expect(result.parties).toBeUndefined();
  });

  it('returns a not-found error when caseName matches no case', async () => {
    mockFetch([]);

    const result = await fetchCaseParties({
      apiBaseUrl: 'https://uatapi.aeliuscase.com',
      jwtToken: 'test-token',
      caseName: 'Totally Fake Case vs Nobody',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('still requires at least one identifier, now including caseName', async () => {
    const result = await fetchCaseParties({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test-token' });
    expect(result).toEqual({ success: false, error: 'Provide caseId, caseNumber, or caseName.' });
  });
});

// Live UAT data quality issue (2026-07-29, case AE-00224): its real party
// list has 12+ separate rows all typed "Applicant Attorney" with junk
// partyName test values ("fdsfs"), confirmed genuine via the dashboard's own
// Parties tab (not a chatbot mapping bug). Listing every row individually in
// a chat reply is unreadable, so fetchCaseParties also returns partyGroups —
// same-partyType rows collapsed into one summary the model can render as
// "Applicant Attorney (12)".
describe('fetchCaseParties — partyGroups', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('collapses many same-type rows into one group with a capped, deduped name list', async () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ partyType: 'Applicant Attorney', partyName: 'fdsfs', docs: [] })),
      { partyType: 'Applicant Attorney', partyName: 'BABCOCK HOLLOWAY SAN DIEGO', docs: [] },
      { partyType: 'Applicant Attorney', partyName: 'faff', docs: [] },
      { partyType: 'Lien Holder', partyName: 'Lien company', docs: [] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 200, succeeded: true, data: rows }),
    }));

    const result = await fetchCaseParties({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test-token', caseId: 224 });

    expect(result.partyGroups).toEqual([
      { partyType: 'Applicant Attorney', count: 12, names: ['fdsfs', 'BABCOCK HOLLOWAY SAN DIEGO', 'faff'], truncated: false },
      { partyType: 'Lien Holder', count: 1, names: ['Lien company'], truncated: false },
    ]);
  });

  it('caps names at 5 and marks truncated when a type has more unique names than that', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ partyType: 'Applicant Attorney', partyName: `Firm ${i}`, docs: [] }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 200, succeeded: true, data: rows }),
    }));

    const result = await fetchCaseParties({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test-token', caseId: 224 });

    expect(result.partyGroups).toEqual([
      { partyType: 'Applicant Attorney', count: 7, names: ['Firm 0', 'Firm 1', 'Firm 2', 'Firm 3', 'Firm 4'], truncated: true },
    ]);
  });

  it('groups rows with an empty partyType under "Unknown" and drops empty partyName from the name list', async () => {
    const rows = [{ partyType: '', partyName: '', docs: [] }, { partyType: '', partyName: 'Someone', docs: [] }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 200, succeeded: true, data: rows }),
    }));

    const result = await fetchCaseParties({ apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test-token', caseId: 224 });

    expect(result.partyGroups).toEqual([
      { partyType: 'Unknown', count: 2, names: ['Someone'], truncated: false },
    ]);
  });
});
