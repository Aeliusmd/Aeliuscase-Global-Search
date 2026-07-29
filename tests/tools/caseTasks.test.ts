import { describe, it, expect, vi } from 'vitest';

// Isolate the tool's shaping logic (success/ambiguous/error passthrough) from
// the real network call — lib/caseFullDetail.test.ts already covers the
// mapper, and the live smoke test (run manually against UAT) covers the real
// HTTP round trip. This test covers the getCaseTasks tool's OWN logic: does it
// correctly slice `tasks` off a successful fetch, and correctly pass through
// ambiguous/error results without inventing data.
vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseTasksTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseTasksTool(deps) as any).execute(input, {} as any);

describe('getCaseTasks tool', () => {
  it('slices tasks + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003583',
        caseName: 'Philip Alexander vs Slate Healthcare LLC',
        tasks: [{ id: 1, title: 'Follow up', description: null, category: 'Standard', assignedTo: ['Raj Patel'], dueDate: '2026-01-01', status: 'Open', priority: 'Normal', createdDate: '2025-01-01' }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003583');
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].title).toBe('Follow up');
  });

  it('passes through ambiguous:true + candidates without guessing a case', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: false,
      ambiguous: true,
      candidates: [
        { id: 7007, caseNumber: 'RP003668', caseName: 'Elgin Perdomo vs Allied Universal', caseType: 'WCAB', caseStatus: 'Open' },
        { id: 7042, caseNumber: 'RP003701', caseName: 'Elgin Perdomo vs Allied Universal', caseType: 'WCAB', caseStatus: 'Closed' },
      ],
    });

    const out = await run({ caseName: 'Elgin Perdomo vs Allied Universal' });
    expect(out.success).toBe(false);
    expect(out.ambiguous).toBe(true);
    expect(out.candidates).toHaveLength(2);
    expect(out.tasks).toBeUndefined();
  });

  it('passes through a not-found error without inventing an empty task list', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.tasks).toBeUndefined();
  });

  it('returns an empty tasks array (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'Philip Alexander vs Slate Healthcare LLC', tasks: [] } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.tasks).toEqual([]);
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "who is assigned to the settlement task") or
  // "full_list" (e.g. "what are the tasks") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x', tasks: [] } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
