import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseNotesTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>, queryText?: string) =>
  (makeGetCaseNotesTool({ ...deps, queryText }) as any).execute(input, {} as any);

describe('getCaseNotes tool', () => {
  it('slices notes + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003668',
        caseName: 'Elgin Perdomo vs Allied Universal',
        notes: [{ id: 1, subject: 'General Note', text: 'Filed application', category: 'General', createdBy: 'Aditi Mandal', createdDate: '2025-10-23T10:20:00' }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003668' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003668');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].subject).toBe('General Note');
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
    expect(out.notes).toBeUndefined();
  });

  it('passes through a not-found error without inventing an empty notes list', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.notes).toBeUndefined();
  });

  it('returns an empty notes array (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'Philip Alexander vs Slate Healthcare LLC', notes: [] } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.notes).toEqual([]);
  });

  it('returns only settlement notes for a settlement-note question', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE-00224',
        caseName: 'Example',
        notes: [
          { id: 1, subject: 'General Note', text: 'ordinary update', category: 'General', createdBy: 'A', createdDate: null },
          { id: 2, subject: 'Settlement Note', text: 'demand accepted', category: 'General', createdBy: 'B', createdDate: null },
          { id: 3, subject: 'Negotiations note', text: 'offer made', category: 'General', createdBy: 'C', createdDate: null },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'AE00224', answerScope: 'full_list' }, 'Give me all settlement notes for case AE00224');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].subject).toBe('Settlement Note');
    expect(out.notesTotal).toBe(1);
  });

  it('uses the same settlement subset for a creator question', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE-00224',
        caseName: 'Example',
        notes: [
          { id: 1, subject: 'Settlement Note', text: 'settled', category: 'General', createdBy: 'Suvi Dison', createdDate: null },
          { id: 2, subject: 'Negotiations note', text: 'offer', category: 'General', createdBy: 'Tharushi', createdDate: null },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'AE00224', answerScope: 'single_fact' }, 'Who created the settlement notes on case AE00224?');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].createdBy).toBe('Suvi Dison');
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "who created the settlement note") or "full_list"
  // (e.g. "give me all settlement notes") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x', notes: [] } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});
