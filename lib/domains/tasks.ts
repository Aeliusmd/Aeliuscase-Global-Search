import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Tasks domain (Phase 2, docs/Phase 02.html §12) — case task/to-do
 * questions (due, overdue, assigned, category, status) for ONE specific case,
 * via the getCaseTasks tool. Same "topic word + case-reference" match pattern
 * as lib/domains/caseDetail.ts, for the same reason: a bare topic word alone
 * (e.g. "assigned") is too easy to false-positive against ordinary Cases
 * wording ("cases assigned to attorney Rita").
 */
export const tasksDomain: DomainModule = {
  key: 'tasks',
  label: 'Tasks',
  llmHint: 'case tasks/to-dos for ONE specific case — due dates, overdue, assigned staff, status, category',
  match: new RegExp(
    String.raw`(?=.*\b(?:task|tasks|to-?dos?|due|overdue)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseTasks')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseTasks: def },
      activeTools: ['getCaseTasks'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
