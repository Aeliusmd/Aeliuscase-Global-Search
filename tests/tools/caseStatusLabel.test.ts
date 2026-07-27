import { describe, it, expect } from 'vitest';
import { listCaseTypes, resolveStatusIds, suggestStatusLabels, type CaseStatusEntry } from '@/lib/caseStatus';
import { classifyIntents } from '@/lib/tools/intentRouter';
import { selectToolsForIntents } from '@/lib/tools/selector';
import { buildToolRegistry } from '@/lib/tools/registry';

// Mirrors the real shape live-verified against the UAT backend 2026-07-16:
// duplicate legacy ID blocks for the same label, scoped per case type.
const ENTRIES: CaseStatusEntry[] = [
  { id: 1, caseStatusDescription: 'Open', caseStatusGroupId: 1, caseTypeId: 1, caseType: 'WCAB' },
  { id: 9, caseStatusDescription: 'Settled', caseStatusGroupId: 1, caseTypeId: 1, caseType: 'WCAB' },
  { id: 82, caseStatusDescription: 'Settled', caseStatusGroupId: 1, caseTypeId: 1, caseType: 'WCAB' },
  { id: 144, caseStatusDescription: 'Settled', caseStatusGroupId: 1, caseTypeId: 1, caseType: 'WCAB' },
  { id: 200, caseStatusDescription: 'Settled', caseStatusGroupId: 2, caseTypeId: 1, caseType: 'WCAB' }, // sub-workflow group — should NOT match group-1 lookup
  { id: 198, caseStatusDescription: 'Settled', caseStatusGroupId: 1, caseTypeId: 4, caseType: 'WCAB_Defense' },
  { id: 4, caseStatusDescription: 'Sub-d Out', caseStatusGroupId: 1, caseTypeId: 1, caseType: 'WCAB' },
];

describe('lib/caseStatus (live status-ID lookup)', () => {
  it('listCaseTypes returns each firm case type once', () => {
    const types = listCaseTypes(ENTRIES);
    expect(types).toEqual([
      { caseTypeId: 1, caseType: 'WCAB' },
      { caseTypeId: 4, caseType: 'WCAB_Defense' },
    ]);
  });

  it('resolveStatusIds sums ALL duplicate legacy IDs for one label+type (group 1 only)', () => {
    expect(resolveStatusIds(ENTRIES, 'Settled', { caseTypeId: 1 })).toEqual([9, 82, 144]);
  });

  it('resolveStatusIds is scoped per case type — same label, different type, different ids', () => {
    expect(resolveStatusIds(ENTRIES, 'Settled', { caseTypeId: 4 })).toEqual([198]);
  });

  it('resolveStatusIds is case-insensitive and trims whitespace', () => {
    expect(resolveStatusIds(ENTRIES, '  settled  ', { caseTypeId: 1 })).toEqual([9, 82, 144]);
  });

  it('resolveStatusIds across ALL types when caseTypeId is omitted', () => {
    expect(resolveStatusIds(ENTRIES, 'Settled')).toEqual([9, 82, 144, 198]);
  });

  it('returns empty for an unknown label (this firm does not have it)', () => {
    expect(resolveStatusIds(ENTRIES, 'Nonexistent Status', { caseTypeId: 1 })).toEqual([]);
  });

  it('suggestStatusLabels offers close matches for a partial/typo\'d label', () => {
    expect(suggestStatusLabels(ENTRIES, 'sub', { caseTypeId: 1 })).toContain('Sub-d Out');
  });
});

describe('filter_status_label intent routing', () => {
  it('classifyIntents detects common detailed-status words', () => {
    expect(classifyIntents("show me Raj Patel's Settled cases")).toContain('filter_status_label');
    expect(classifyIntents('how many are Sub-d Out')).toContain('filter_status_label');
    expect(classifyIntents('list the Dismissed ones')).toContain('filter_status_label');
    expect(classifyIntents('any Re Opened cases?')).toContain('filter_status_label');
  });

  it('does NOT fire for an unrelated message', () => {
    expect(classifyIntents('find case RP2010')).not.toContain('filter_status_label');
  });

  it('selector routes filter_status_label to combinedSearch only (no dedicated single tool)', () => {
    const registry = buildToolRegistry({
      apiBaseUrl: 'https://x', jwtToken: 't', enforcedSearchType: 1, enforcedLabel: 'All Cases',
    });
    const result = selectToolsForIntents(['filter_status_label'], registry, {});
    expect(result.activeTools).toEqual(['combinedSearch']);
    expect(result.requireTool).toBe(true);
  });
});
