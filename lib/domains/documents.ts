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
  // "NOT ... submitted to JetFile" added 2026-08-12 (Phase-02 live QA): the
  // Stage-1.5 classifier read "when was case X submitted to JetFile" as a
  // document upload and returned `documents`, which merged alongside
  // caseDetail's (correct, regex-matched) selection and let the model pick
  // getCaseDocuments — it then answered about the last uploaded file instead
  // of the JetFile submission date. The regex above never matched that
  // phrasing; only the classifier did, so the fix belongs in this hint.
  llmHint: 'uploaded documents/files for ONE specific case — has X been uploaded, who uploaded it, file list. NOT for "submitted to JetFile"/EAMS submission questions (that is the caseDetail category, not a file upload)',
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
