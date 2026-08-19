import { describe, it, expect, vi } from 'vitest';

// tests/lib/caseFullDetail.test.ts covers fetchCaseFullDetail/mapCaseFullDetail
// directly; this covers only the getCaseFullDetail TOOL wrapper's own logic —
// passthrough of the result plus the answerScope -> narrow mapping.
vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseFullDetailTool, makeGetCaseTasksTool, SECTION_SAMPLE_CAP } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseFullDetailTool(deps) as any).execute(input, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runForQuestion = (queryText: string, input: Record<string, unknown>) =>
  (makeGetCaseFullDetailTool({ ...deps, queryText }) as any).execute(input, {} as any);

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

  it('returns exact requested body-part ADJ matches without borrowing another head variant', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      data: {
        caseNumber: 'AE-00224', caseName: 'x',
        injuries: [
          { bodyPartId: 1, bodyPart: '100 - Head - not specified', adjNumber: 'ADJ1234123' },
          { bodyPartId: 16, bodyPart: '198 - Head - multiple injury', adjNumber: 'ADJ89745' },
          { bodyPartId: 8, bodyPart: '141 - Jaw', adjNumber: 'ADJ333333' },
        ],
        tasks: [], events: [], documents: [], notes: [], activities: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await runForQuestion(
      'What is the ADJ number for the knee and head injury on case AE00224?',
      { caseNumber: 'AE00224', answerScope: 'single_fact' },
    );

    expect(out.requestedInjuryAdjNumbers).toEqual({ knee: [], head: ['ADJ1234123'] });
  });
});

// Live regression fixed 2026-08-13 — see SECTION_SAMPLE_CAP's doc comment. Once
// the backend started returning every section populated at once (case AE-00224:
// 230 tasks / 187 events / 82 documents / 38 notes / 1156 activities), a single
// getCaseFullDetail result was ~108,000 tokens and blew gpt-4o-mini's 128K
// limit, which the UI shows as a blank reply. The arrays are now sampled and
// the TRUE counts travel separately so answers stay exact.
describe('section capping', () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const fullData = {
    caseNumber: 'AE-00224',
    caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
    tasks: big(230), events: big(187), documents: big(82), notes: big(38), activities: big(1156),
  };

  it('caps every section of getCaseFullDetail but reports the real totals', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({ success: true, data: fullData as any });

    const out = await run({ caseNumber: 'AE-00224' });

    expect(out.data.tasks).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.data.events).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.data.documents).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.data.notes).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.data.activities).toHaveLength(SECTION_SAMPLE_CAP);
    // The counts the prompt quotes back to the user must be the REAL ones.
    expect(out.sectionTotals).toEqual({ tasks: 230, events: 187, documents: 82, notes: 38, activities: 1156 });
    // Non-array case fields are untouched.
    expect(out.data.caseNumber).toBe('AE-00224');
  });

  it('leaves a section shorter than the cap alone', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      success: true, data: { ...fullData, notes: big(3) } as any,
    });

    const out = await run({ caseNumber: 'AE-00224' });
    expect(out.data.notes).toHaveLength(3);
    expect(out.sectionTotals.notes).toBe(3);
  });

  it('caps a single-section tool too, alongside its own total', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({ success: true, data: fullData as any });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (makeGetCaseTasksTool(deps) as any).execute({ caseNumber: 'AE-00224' }, {} as any);
    expect(out.tasks).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.tasksTotal).toBe(230);
  });

  it('does not add sectionTotals to a failed lookup', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({ success: false, error: 'Case "ZZ1" not found.' });

    const out = await run({ caseNumber: 'ZZ1' });
    expect(out.success).toBe(false);
    expect(out.sectionTotals).toBeUndefined();
  });
});
