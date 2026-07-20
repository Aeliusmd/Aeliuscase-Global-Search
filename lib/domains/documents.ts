import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Documents domain (Phase 2, docs/Phase 02.html §14) — case uploaded-file
 * questions for ONE specific case, via the getCaseDocuments tool. Same "topic
 * word + case-reference" match pattern as lib/domains/tasks.ts.
 *
 * Note: casesDomain's existing `documents?` word (and getCaseParties) already
 * handles PARTY-attached documents via GetAllPartiesWithDocsByCaseId — this
 * domain is additive and covers the fuller case-level document list from
 * GetCaseFullDetail instead. Both can be active together (system prompt tells
 * the model when to prefer which).
 */
export const documentsDomain: DomainModule = {
  key: 'documents',
  label: 'Documents',
  llmHint: 'uploaded documents/files for ONE specific case — has X been uploaded, who uploaded it, file list',
  match: new RegExp(
    String.raw`(?=.*\b(?:document|documents|upload(?:ed|s)?|files?)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseDocuments')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseDocuments: def },
      activeTools: ['getCaseDocuments'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
