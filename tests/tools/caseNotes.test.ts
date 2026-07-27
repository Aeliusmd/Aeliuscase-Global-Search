import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { makeGetCaseNotesTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseNotesTool(deps) as any).execute(input, {} as any);

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

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });
});
