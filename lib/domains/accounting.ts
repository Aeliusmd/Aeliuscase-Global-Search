import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Accounting domain (Phase 2, docs/Phase 02.html §17) — case financial
 * questions for ONE specific case, via the getCaseAccounting tool. Same
 * "topic word + case-reference" match pattern as lib/domains/tasks.ts. This is
 * the last and most sensitive Phase-2 domain (financial data) — relies
 * entirely on the backend's own Bearer JWT permission scoping, no additional
 * chatbot-side filtering.
 *
 * Second alternative branch ("amount/balance/payment" + "due") added after a
 * confirmed collision found live 2026-07-19: tasksDomain's bare "due" trigger
 * matches financial phrasing like "what amount is due on case X" too (a
 * legitimate task-due meaning also exists for bare "due", so that trigger is
 * kept, not removed — see lib/domains/tasks.ts). Rather than trying to make
 * regex perfectly disambiguate "due" by itself, this branch makes
 * accountingDomain ALSO fire alongside tasksDomain when the message pairs
 * "due" with a financial word, so both tools are offered and the model (with
 * system-prompt guidance) picks the right one — same additive philosophy
 * already used for the documentsDomain/casesDomain overlap.
 */
export const accountingDomain: DomainModule = {
  key: 'accounting',
  label: 'Accounting',
  llmHint: 'financial summary for ONE specific case — cheque requests, payments, client costs paid, settlement fees, balances',
  match: new RegExp(
    String.raw`(?:(?=.*\b(?:accounting|cheques?|invoices?|settlement\s*fees?|client\s*costs?|current\s*balance)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s)))` +
      String.raw`|(?:(?=.*\b(?:amount|balance|payment)\b)(?=.*\bdue\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s)))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseAccounting')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseAccounting: def },
      activeTools: ['getCaseAccounting'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
