import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Activities domain (Phase 2, docs/Phase 02.html §16) — case activity/audit
 * history questions for ONE specific case, via the getCaseActivities tool.
 * Same "topic word + case-reference" match pattern as lib/domains/tasks.ts.
 *
 * Includes "demographics?"/"sent" alongside the core activity words after a
 * confirmed collision found live 2026-07-19: "when was the demographics sent
 * on case X" matches caseDetailDomain directly (via its own "demographics?"
 * trigger) but NOT this domain, so getCaseActivities was never offered even
 * though the real intent was an audit-trail question. Rather than trying to
 * make regex perfectly pick ONE domain, this domain now ALSO fires alongside
 * caseDetailDomain for that phrasing, so both tools are offered — same
 * additive philosophy as the documentsDomain/casesDomain overlap.
 *
 * `llmHint` explicitly calls out "what changed / recent updates" phrasing
 * after a live QA-round-3 finding (2026-07-19): "what changed on RP2021
 * recently" has no regex trigger word here, so it fell to the LLM fallback —
 * which, with the ORIGINAL hint wording, genuinely classified it as NONE
 * (verified directly against the real classifier). The model then only had
 * generic search tools available, repeatedly called searchCases with
 * identical input, and exhausted its step budget with no final answer at
 * all. Naming this exact phrasing in the hint is the same fix pattern used
 * for every regex gap this session — just applied to the LLM's hint text.
 */
export const activitiesDomain: DomainModule = {
  key: 'activities',
  label: 'Activities',
  llmHint: 'activity/audit history for ONE specific case — a log of actions taken on the case (notes added, documents uploaded, letters/forms generated, things sent to third parties, etc.) with who did it and when, NOT the case\'s own tasks/events/notes/documents themselves. Also matches vague phrasing like "what changed/happened on this case recently", "recent updates", or "what\'s new".',
  match: new RegExp(
    String.raw`(?=.*\b(?:activit(?:y|ies)|audit|history|activity\s*log|demographics?|sent)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseActivities')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseActivities: def },
      activeTools: ['getCaseActivities'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
