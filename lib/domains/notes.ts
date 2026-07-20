import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Notes domain (Phase 2, docs/Phase 02.html §15) — case notes questions for
 * ONE specific case, via the getCaseNotes tool. Same "topic word +
 * case-reference" match pattern as lib/domains/tasks.ts.
 */
export const notesDomain: DomainModule = {
  key: 'notes',
  label: 'Notes',
  llmHint: 'notes for ONE specific case — subject, text/content, category, author, date',
  match: new RegExp(
    String.raw`(?=.*\bnotes?\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseNotes')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseNotes: def },
      activeTools: ['getCaseNotes'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
