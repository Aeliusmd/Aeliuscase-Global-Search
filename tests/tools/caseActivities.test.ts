import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseActivitiesTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseActivitiesTool(deps) as any).execute(input, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runForQuestion = (queryText: string, input: Record<string, unknown>) =>
  (makeGetCaseActivitiesTool({ ...deps, queryText }) as any).execute(input, {} as any);

describe('getCaseActivities tool', () => {
  it('slices activities + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003668',
        caseName: 'Elgin Perdomo vs Allied Universal',
        activities: [{ id: 1, description: 'Case Demographics sent to Matrix', type: 'DEMOGRAPHICS_SENT', performedBy: 'Aditi Mandal', timestamp: '2026-07-01T14:22:00Z', relatedEntity: null }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003668' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003668');
    expect(out.activities).toHaveLength(1);
    expect(out.activities[0].description).toBe('Case Demographics sent to Matrix');
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
    expect(out.activities).toBeUndefined();
  });

  it('passes through a not-found error without inventing an empty activities list', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.activities).toBeUndefined();
  });

  it('returns an empty activities array (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'Philip Alexander vs Slate Healthcare LLC', activities: [] } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.activities).toEqual([]);
  });

  it('filters Matrix demographics activities before applying the 25-row sample cap', async () => {
    const unrelated = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      description: `Unrelated activity ${index + 1}`,
      type: 'OTHER',
    }));
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE00224',
        caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
        activities: [
          ...unrelated,
          {
            id: 13110,
            description: 'Demographic sheet for Case AE-00224 sent to matrix by Suvi dison',
            type: 'MATRIX_REFERRAL_EXPORTED',
            timestamp: '2026-07-31T07:27:29.362913',
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await runForQuestion(
      'When were Case Demographics sent to Matrix for case AE00224?',
      { caseNumber: 'AE00224', answerScope: 'full_list' },
    );

    expect(out.activities).toHaveLength(1);
    expect(out.activities[0].id).toBe(13110);
    expect(out.activitiesTotal).toBe(1);
  });

  it('keeps generated-form events and excludes nearby stacked-document events', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE00224',
        caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
        activities: [
          {
            id: 13808,
            description: '<b>Declaration_LC_4906(g)</b> genarated by DELETED USER',
            type: 'COMPLETED_FORMS',
            performedBy: 'DELETEDu1',
          },
          {
            id: 13803,
            description: 'Document saved from legal form docs — stacked by Thomas Smith.',
            type: 'DOCUMENT_CREATED',
            performedBy: 'Thomas Smith',
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await runForQuestion(
      'Who generated the last legal form on case AE00224?',
      { caseNumber: 'AE00224', answerScope: 'single_fact' },
    );

    expect(out.activities).toHaveLength(1);
    expect(out.activities[0].id).toBe(13808);
    expect(out.activities[0].description).toContain('DELETED USER');
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "when was the last activity performed") or
  // "full_list" (e.g. "5 most recent activities") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x', activities: [] } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
