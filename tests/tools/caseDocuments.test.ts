import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/caseFullDetail', () => ({
  fetchCaseFullDetail: vi.fn(),
}));

import { fetchCaseFullDetail } from '@/lib/caseFullDetail';
import { SECTION_SAMPLE_CAP } from '@/lib/tools/impl/caseDetail';
import { makeGetCaseDocumentsTool } from '@/lib/tools/impl/caseDetail';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: Record<string, unknown>) => (makeGetCaseDocumentsTool(deps) as any).execute(input, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runForQuestion = (queryText: string, input: Record<string, unknown>) =>
  (makeGetCaseDocumentsTool({ ...deps, queryText }) as any).execute(input, {} as any);

describe('getCaseDocuments tool', () => {
  it('slices documents + case identity off a successful fetch', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'RP003583',
        caseName: 'Philip Alexander vs Slate Healthcare LLC',
        documents: [{ id: 1, name: 'Settlement Agreement.pdf', category: null, uploadedBy: 'Raj Patel', uploadedDate: '2026-06-15', fileUrl: '/x/1' }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.caseNumber).toBe('RP003583');
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0].name).toBe('Settlement Agreement.pdf');
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
    expect(out.documents).toBeUndefined();
  });

  it('passes through a not-found error without inventing an empty documents list', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({ success: false, error: 'Case "ZZ999999" not found.' });

    const out = await run({ caseNumber: 'ZZ999999' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(out.documents).toBeUndefined();
  });

  it('returns an empty documents array (not an error) when the case genuinely has none', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'Philip Alexander vs Slate Healthcare LLC', documents: [] } as any,
    });

    const out = await run({ caseNumber: 'RP003583' });
    expect(out.success).toBe(true);
    expect(out.documents).toEqual([]);
  });

  it('filters settlement documents before applying the 25-row sample cap', async () => {
    const unrelated = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      name: `Unrelated document ${index + 1}`,
      category: null,
    }));
    vi.mocked(fetchCaseFullDetail).mockResolvedValueOnce({
      success: true,
      data: {
        caseNumber: 'AE00224',
        caseName: 'Tharushi samindika Perera vs MedcubeUSA LLC',
        documents: [
          ...unrelated,
          { id: 464, name: 'Information guidelines for submission of settlement documents', category: null },
          { id: 435, name: 'Information guidelines for submission of settlement documents', category: null },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const out = await runForQuestion(
      'Show all settlement-related documents for case AE00224.',
      { caseNumber: 'AE00224', answerScope: 'full_list' },
    );

    expect(out.documents).toHaveLength(2);
    expect(out.documents.every((row: { name: string }) => /settlement/i.test(row.name))).toBe(true);
    expect(out.documentsTotal).toBe(2);
  });

  it('rejects a call with no caseNumber/caseId/caseName (zod refine)', async () => {
    await expect(run({})).rejects.toBeTruthy();
  });

  // Live UX fix (2026-07-29): the model classifies every call as answerScope
  // "single_fact" (e.g. "who uploaded the settlement document") or
  // "full_list" (e.g. "show me all documents") — no server-side keyword list.
  it('sets narrow:true only when answerScope is single_fact', async () => {
    vi.mocked(fetchCaseFullDetail).mockResolvedValue({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { caseNumber: 'RP003583', caseName: 'x', documents: [] } as any,
    });

    expect((await run({ caseNumber: 'RP003583', answerScope: 'single_fact' })).narrow).toBe(true);
    expect((await run({ caseNumber: 'RP003583', answerScope: 'full_list' })).narrow).toBe(false);
    expect((await run({ caseNumber: 'RP003583' })).narrow).toBe(false);
  });
});

// Live bug fixed 2026-08-19 — see keywordMatches in lib/tools/impl/caseDetail.ts.
// Only the newest SECTION_SAMPLE_CAP rows reach the model, so a record further
// down the list was invisible and the model answered from a row it COULD see:
// "who uploaded the Verification form" returned "Suvi Dison" when the real
// uploader was Bhagya Adhikara (that document sits at position 30 of 90).
describe('searchKeyword — searches the whole section, not just the newest rows', () => {
  const docs = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Filler ${i}`, uploadedBy: 'Suvi dison' })),
    { id: 99, name: 'Verification form', uploadedBy: 'Bhagya Adhikara' },
    ...Array.from({ length: 59 }, (_, i) => ({ id: 200 + i, name: `Tail ${i}`, uploadedBy: 'Suvi dison' })),
  ];
  const mockDocs = () => vi.mocked(fetchCaseFullDetail).mockResolvedValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    success: true, data: { caseNumber: 'AE-00224', caseName: 'x', documents: docs } as any,
  });

  it('finds a record that sits past the sample cap', async () => {
    mockDocs();
    const out = await run({ caseNumber: 'AE-00224', searchKeyword: 'Verification form' });

    expect(out.documents).toHaveLength(1);
    expect(out.documents[0].uploadedBy).toBe('Bhagya Adhikara');
    expect(out.documentsTotal).toBe(1);
    expect(out.searchMatched).toBe(true);
    expect(out.searchedFor).toBe('Verification form');
    // The match count must never be mistaken for the section total.
    expect(out.sectionSize).toBe(90);
  });

  it('reports a miss instead of returning a near-miss row', async () => {
    mockDocs();
    const out = await run({ caseNumber: 'AE-00224', searchKeyword: 'Medical Records' });

    expect(out.documents).toEqual([]);
    expect(out.searchMatched).toBe(false);
    expect(out.sectionSize).toBe(90);
  });

  it('returns the newest rows and the real total when no keyword is given', async () => {
    mockDocs();
    const out = await run({ caseNumber: 'AE-00224' });

    expect(out.documents).toHaveLength(SECTION_SAMPLE_CAP);
    expect(out.documentsTotal).toBe(90);
    expect(out.searchedFor).toBeUndefined();
    expect(out.searchMatched).toBeUndefined();
  });

  it('matches case-insensitively and tolerates extra whitespace', async () => {
    mockDocs();
    const out = await run({ caseNumber: 'AE-00224', searchKeyword: '  verification   FORM ' });
    expect(out.documents).toHaveLength(1);
    expect(out.searchMatched).toBe(true);
  });
});
