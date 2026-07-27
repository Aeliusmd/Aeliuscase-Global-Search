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
