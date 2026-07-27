import { describe, it, expect } from 'vitest';
import {
  makeGetByVenueIdTool,
  makeGetByStatusIdTool,
  makeGetBySubTypeIdTool,
  makeGetByCaseTypeIdTool,
} from '@/lib/tools/impl/filters';

/**
 * Guard: a filter tool called with a garbage 0 / missing id (e.g. an anaphoric
 * "cases in that venue" with no number) must NOT silently query id 0 and return a
 * misleading "0 cases" — it returns a clarification (success:false) instead.
 */
const deps = { apiBaseUrl: 'http://localhost', jwtToken: 'test' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (t: any, input: Record<string, unknown>) => t.execute(input, {} as any);

describe('filter tools reject a missing/zero id with a clarification (no silent "0 cases")', () => {
  it('venue id 0 → asks which venue, no network call', async () => {
    const out = await run(makeGetByVenueIdTool(deps), { venueId: 0, page: 1 });
    expect(out.success).toBe(false);
    expect(out.totalRecords).toBe(0);
    expect(out.error).toMatch(/which venue/i);
  });

  it('status id 0 → asks which status', async () => {
    const out = await run(makeGetByStatusIdTool(deps), { caseStatusId: 0, page: 1 });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/status/i);
  });

  it('sub-type id 0 → asks which sub-type', async () => {
    const out = await run(makeGetBySubTypeIdTool(deps), { caseSubTypeId: 0, page: 1 });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/sub-type/i);
  });

  it('case type id 0 → asks which type', async () => {
    const out = await run(makeGetByCaseTypeIdTool(deps), { caseTypeId: 0, page: 1 });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/case type/i);
  });

  it('a valid id passes the guard (would proceed to fetch)', async () => {
    // venueId 5 passes the guard; we don't assert the network result here, only
    // that the guard did NOT short-circuit with the "which venue" clarification.
    const out = await run(makeGetByVenueIdTool(deps), { venueId: 5, page: 1 }).catch(() => ({ error: 'network' }));
    expect(out.error ?? '').not.toMatch(/which venue/i);
  });
});
