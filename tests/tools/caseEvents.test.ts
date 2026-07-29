import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseEventsTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseEventsTool(deps) as any).execute(input, {} as any);

describe('getCaseEvents tool', () => {
  it('slices events + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003583',
        caseName: 'Philip Alexander vs Slate Healthcare LLC',
        events: [{ id: 1, title: 'Status Conference', type: 'Hearing', when: '2026-08-03 09:30', location: 'Dept 4, RIV', status: 'Scheduled', notes: null }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003583');
    expect(out.events).toHaveLength(1);
    expect(out.events[0].title).toBe('Status Conference');
  });

  it('passes through ambiguous:true + candidates without guessing a case', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: false,
      ambiguous: true,
      candidates: [
        { id: 7007, caseNumber: 'RP003668', caseName: 'Elgin Perdomo vs Allied Universal', caseType: 'WCAB', caseStatus: 'Open' },
      ],
    });

    const out = await run({ caseName: 'Elgin Perdomo vs Allied Universal' });
    expect(out.success).toBe(false);
    expect(out.ambiguous).toBe(true);
    expect(out.candidates).toHaveLength(1);
    expect(out.events).toBeUndefined();
  });

  it('passes through a not-found error without inventing an empty events list', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.events).toBeUndefined();
  });

  it('returns an empty events array (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'Philip Alexander vs Slate Healthcare LLC', events: [] } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.events).toEqual([]);
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "when is the next hearing") or "full_list" (e.g.
  // "what hearings are scheduled") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x', events: [] } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
