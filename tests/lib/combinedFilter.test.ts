import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/caseFilters', () => ({
  fetchCombinedCases: vi.fn(),
  fetchCasesByStatusLabel: vi.fn(),
}));

import { fetchCombinedCases, fetchCasesByStatusLabel } from '@/lib/caseFilters';
import { combinedSearch } from '@/lib/combinedFilter';

const deps = { apiBaseUrl: 'https://x', jwtToken: 't' };

beforeEach(() => {
  vi.mocked(fetchCombinedCases).mockReset();
  vi.mocked(fetchCasesByStatusLabel).mockReset();
});

// Regression test for a live bug found 2026-07-19 (QA round 3, end-to-end
// testing with real AI + real backend calls): a status-label-ONLY query (e.g.
// "dismissed cases", "settled cases", "cases closed by stipulation") was
// wrongly rejected with "Please provide at least one concrete filter" — even
// though a status label IS a concrete filter. Root cause: caseStatusLabel is
// deliberately excluded from `body` (buildCombinedRequestBody's comment: it's
// resolved separately below via fetchCasesByStatusLabel, not a literal API
// field), so a caseStatusLabel-only call left `body` with zero keys, and the
// "reject empty call" guard fired BEFORE the code ever reached the
// caseStatusLabel branch that would have handled it correctly. Verified live
// via curl-equivalent calls through /api/chat for every one of these labels.
describe('combinedSearch — a detailed status label alone is a valid, concrete filter', () => {
  it('does NOT reject a caseStatusLabel-only query as "no concrete filter" — it calls fetchCasesByStatusLabel', async () => {
    vi.mocked(fetchCasesByStatusLabel).mockResolvedValueOnce({
      success: true, filterType: 'combined', filterLabel: 'Dismissed', filterValue: '{}',
      cases: [], totalRecords: 3, totalPages: 1, hasMorePages: false, page: 1,
    });
    const result = await combinedSearch(deps, { caseStatusLabel: 'Dismissed', status: 3, subOutFilter: 'include' });
    expect(result.success).toBe(true);
    expect(fetchCasesByStatusLabel).toHaveBeenCalledWith(expect.objectContaining({ statusLabel: 'Dismissed' }));
    expect(fetchCombinedCases).not.toHaveBeenCalled();
  });

  it('still rejects a genuinely empty call (no filters at all, no status label)', async () => {
    const result = await combinedSearch(deps, { subOutFilter: 'include' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/provide at least one concrete filter/i);
    expect(fetchCombinedCases).not.toHaveBeenCalled();
    expect(fetchCasesByStatusLabel).not.toHaveBeenCalled();
  });

  it('still calls the plain combined-cases path when a normal (non-label) filter is given', async () => {
    vi.mocked(fetchCombinedCases).mockResolvedValueOnce({
      success: true, filterType: 'combined', filterLabel: 'Venue 13', filterValue: '{}',
      cases: [], totalRecords: 5, totalPages: 1, hasMorePages: false, page: 1,
    });
    const result = await combinedSearch(deps, { venueId: 13 });
    expect(result.success).toBe(true);
    expect(fetchCombinedCases).toHaveBeenCalled();
    expect(fetchCasesByStatusLabel).not.toHaveBeenCalled();
  });
});
