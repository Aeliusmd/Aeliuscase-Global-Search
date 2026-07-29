import { describe, it, expect, vi } from 'vitest';

// tests/lib/caseFullDetail.test.ts covers fetchCaseFullDetail/mapCaseFullDetail
// directly; this covers only the getCaseFullDetail TOOL wrapper's own logic —
// passthrough of the result plus the answerScope -> narrow mapping.
vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseFullDetailTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseFullDetailTool(deps) as any).execute(input, {} as any);

describe('getCaseFullDetail tool', () => {
  it('passes the fetch result through unchanged aside from narrow', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x' } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.data?.caseNumber).toBe('RP003583');
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "what is the venue on this case") or "full_list"
  // (e.g. "show me everything on this case") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x' } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
