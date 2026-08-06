import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeUpstreamError, searchCasesPaginated } from '@/lib/caseSearch';

// Live bug fixed 2026-08-06: the upstream /api/Case/Search endpoint returned a
// raw SQL error ("PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination
// does not exist") as its `message` field, and that text was shown to the end
// user verbatim in a red error box — internal backend implementation detail
// that should never reach a real client.
describe('sanitizeUpstreamError', () => {
  it('replaces an obviously technical/internal-looking message with a generic one', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = sanitizeUpstreamError(
      'PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination does not exist',
      'caseSearch',
    );
    expect(out).not.toContain('PROCEDURE');
    expect(out).not.toContain('zzztestempeformsantarosa');
    expect(out.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledWith(
      '[caseSearch] upstream returned an internal-looking error:',
      expect.stringContaining('PROCEDURE'),
    );
    spy.mockRestore();
  });

  it('also catches SqlException / stack-trace-shaped messages', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(sanitizeUpstreamError('SqlException: Invalid column name', 'x')).not.toContain('SqlException');
    expect(sanitizeUpstreamError('at System.Data.SqlClient.SqlCommand.Execute', 'x')).not.toContain('System.');
    vi.restoreAllMocks();
  });

  it('passes through a genuine, human-readable backend message unchanged', () => {
    expect(sanitizeUpstreamError('Case not found.', 'x')).toBe('Case not found.');
    expect(sanitizeUpstreamError('No case matched the supplied caseId/caseNumber/caseName.', 'x'))
      .toBe('No case matched the supplied caseId/caseNumber/caseName.');
  });

  it('falls back to a generic message when there is no message at all', () => {
    expect(sanitizeUpstreamError(null, 'x').length).toBeGreaterThan(0);
    expect(sanitizeUpstreamError(undefined, 'x').length).toBeGreaterThan(0);
  });
});

describe('searchCasesPaginated — error sanitization', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sanitizes a raw SQL error from the upstream search endpoint before returning it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        succeeded: false,
        message: 'PROCEDURE zzztestempeformsantarosa.GetMainSearchListWithPagination does not exist',
      }),
    }));

    const result = await searchCasesPaginated({
      apiBaseUrl: 'https://uatapi.aeliuscase.com', jwtToken: 'test', searchText: 'RP0036 ' + Date.now(), searchType: 2, page: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('PROCEDURE');
  });
});
