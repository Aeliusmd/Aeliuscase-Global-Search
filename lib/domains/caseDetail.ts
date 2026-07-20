import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Case Detail domain (Phase 2, docs/Phase 02.html §10) — single-case venue,
 * injury/body-part, SOL, DOI, ADJ#, and demographics questions, via the
 * getCaseFullDetail tool. Does not overlap with the existing Cases domain's
 * getCaseParties (basic party listing) — this owns the richer per-case detail
 * that getCaseParties never returned.
 *
 * `match` requires BOTH a topic word AND evidence the message is about ONE
 * specific case (the word "case", a case-number-shaped token like "RP003583",
 * or a "X vs Y" case name) — a bare topic word alone is not enough. Without
 * this, "personal injury cases opened in 2024" (a case-TYPE list filter,
 * already handled by the Cases domain) false-positived into this domain purely
 * because it contains "injury" — caught live during Section 1 testing.
 *
 * `defendant` and `jet\s*file` added 2026-07-19 after a QA pass against the
 * PM's acceptance-criteria examples: "Who is the defendant on [case]?" and
 * "When was [case] submitted to JetFile?" had NO trigger word in any domain
 * and fell through to searchCases. getCaseFullDetail returns both the
 * defendant object and jetFileId, so it's the right tool for both.
 *
 * `expir\w*` added 2026-07-19 (QA round 2): "has case X expired yet" (an
 * indirect SOL/statute-of-limitations question) had no trigger here, so only
 * Phase-1's filter_sol list-intent fired (getBySolDate/combinedSearch) even
 * though a specific case was named — mirrors the same word already used by
 * lib/tools/intentRouter.ts's filter_sol intent.
 *
 * `attorney|paralegal|coordinator` added 2026-07-19 (QA round 3, live
 * end-to-end testing): "who is the attorney for Elgin Perdomo vs Allied
 * Universal" (a case referenced by NAME, not number) got misrouted to a
 * STAFF-name search ("No staff member found matching Elgin Perdomo") because
 * Phase-1's getCaseParties tool (lib/tools/impl/parties.ts) only accepts
 * caseNumber/caseId — it has no caseName parameter at all, so it structurally
 * cannot resolve a case referenced only by name, even though the case_parties
 * intent fires for this phrasing. getCaseFullDetail already supports caseName
 * AND already maps attorney/supervisorAttorney/coordinator/paralegal (see
 * lib/caseFullDetail.ts's mapCaseFullDetail), so it's the right tool for a
 * role-word question specifically when the case is named rather than
 * numbered. Additive only — for a case-NUMBER reference this just offers a
 * second, equally-correct path alongside the existing getCaseParties route.
 */
export const caseDetailDomain: DomainModule = {
  key: 'caseDetail',
  label: 'Case Detail',
  llmHint: 'full detail for ONE specific case — venue, injury/body parts, statute of limitations (SOL) / expiry, date of injury (DOI), ADJ number, defendant, applicant/employer/insurance-carrier demographics, JetFile submission, or the case\'s attorney/paralegal/coordinator — especially when the case is referenced by NAME ("X vs Y") rather than case number',
  match: new RegExp(
    String.raw`(?=.*\b(?:venue|injur\w*|body\s*part|sol|statute\s*of\s*limitations|expir\w*|doi|date\s*of\s*injury` +
      String.raw`|adj\s*(?:number|#|no)?|demographics?|defendant|jet\s*file|full\s*detail|everything\s*on\s*case` +
      String.raw`|attorney|paralegal|coordinator)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseFullDetail')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseFullDetail: def },
      activeTools: ['getCaseFullDetail'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
