import { describe, it, expect, vi } from 'vitest';

// Isolates the tool's own narrow/description logic from the real network call
// (lib/caseParties.test.ts already covers fetchCaseParties itself).
vi.mock('@/lib/caseParties', () => ({
  fetchCaseParties: vi.fn(),
}));

import { fetchCaseParties } from '@/lib/caseParties';
import { makeGetCasePartiesTool } from '@/lib/tools/impl/parties';

const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (toolDeps: Record<string, unknown>, input: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (makeGetCasePartiesTool(toolDeps as any) as any).execute(input, {} as any);

// Live UX issue fixed 2026-07-29: a single-field question ("who is the
// insurance carrier for AE00224") rendered the full 39-row parties table and
// got a padded-out text answer, same as a general "list the parties" request
// — both went through the identical getCaseParties call with no way to tell
// them apart. narrowField (set server-side by the chat route, never by the
// model) marks the OUTPUT so the client can hide the table and the tool
// description tells the model to answer in one sentence.
describe('getCaseParties tool — narrowField', () => {
  it('adds narrow:true to the output when narrowField is set', async () => {
    vi.mocked(fetchCaseParties).mockResolvedValueOnce({
      success: true,
      caseRef: 'AE00224',
      parties: [{ partyType: 'Insurance Carrier', partyName: 'MEDICAL ACCESS NETWORK FRESNO INS CARR', docs: [] }],
      partyDocs: [],
      partyGroups: [],
    });

    const out = await run({ apiBaseUrl: 'http://localhost', jwtToken: 'test', narrowField: true }, { caseNumber: 'AE00224' });

    expect(out.narrow).toBe(true);
    expect(out.success).toBe(true);
  });

  it('does not add narrow when narrowField is omitted (general parties listing)', async () => {
    vi.mocked(fetchCaseParties).mockResolvedValueOnce({
      success: true, caseRef: 'AE00224', parties: [], partyDocs: [], partyGroups: [],
    });

    const out = await run(deps, { caseNumber: 'AE00224' });

    expect(out.narrow).toBeUndefined();
  });

  it('still passes narrow:true through even when the underlying fetch fails', async () => {
    vi.mocked(fetchCaseParties).mockResolvedValueOnce({ success: false, error: 'Case "ZZ99999999" not found.' });

    const out = await run({ apiBaseUrl: 'http://localhost', jwtToken: 'test', narrowField: true }, { caseNumber: 'ZZ99999999' });

    expect(out.success).toBe(false);
    expect(out.narrow).toBe(true);
  });

  it('adds the short-answer instruction to the tool description only when narrowField is true', () => {
    const narrowDef = makeGetCasePartiesTool({ ...deps, narrowField: true });
    const generalDef = makeGetCasePartiesTool(deps);

    expect(narrowDef.description).toContain('ONE specific field');
    expect(generalDef.description).not.toContain('ONE specific field');
  });
});
