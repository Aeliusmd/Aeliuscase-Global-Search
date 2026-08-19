import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseAccountingTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseAccountingTool(deps) as any).execute(input, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runForQuestion = (queryText: string, input: Record<string, unknown>) =>
  (makeGetCaseAccountingTool({ ...deps, queryText }) as any).execute(input, {} as any);

describe('getCaseAccounting tool', () => {
  it('slices accounting + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003668',
        caseName: 'Elgin Perdomo vs Allied Universal',
        accounting: {
          chequeRequests: [{ id: 601, amount: 850, description: 'Medical records fee', requestedDate: '2026-06-10', status: 'Pending' }],
          payments: [],
          clientCostsPaid: [],
          settlementFees: [],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003668' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003668');
    expect(out.accounting.chequeRequests).toHaveLength(1);
    expect(out.accounting.chequeRequests[0].description).toBe('Medical records fee');
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
    expect(out.accounting).toBeUndefined();
  });

  it('passes through a not-found error without inventing empty accounting', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.accounting).toBeUndefined();
  });

  it('returns all-empty accounting arrays (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003583',
        caseName: 'Philip Alexander vs Slate Healthcare LLC',
        accounting: { chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.accounting).toEqual({ chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] });
  });

  it('marks a case-wide current balance unavailable instead of selecting an invoice balance', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE00224', caseName: 'x',
        accounting: {
          chequeRequests: [], payments: [], clientCostsPaid: [],
          settlementFees: [{ id: 163, invoice: 'ORD-AE-00224-10', amount: 100, remainingBalance: 70 }],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await runForQuestion(
      'What is the current balance on case AE00224?',
      { caseNumber: 'AE00224', answerScope: 'single_fact' },
    );

    expect(out.currentBalanceAvailable).toBe(false);
    expect(out.currentBalance).toBeNull();
    expect(out.accounting.settlementFees[0].remainingBalance).toBe(70);
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "what is the current balance") or "full_list" (e.g.
  // "what are the settlement fees") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      data: {
        caseNumber: 'RP003583', caseName: 'x',
        accounting: { chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
