import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Events domain (Phase 2, docs/Phase 02.html §13) — case calendar
 * event/hearing questions for ONE specific case, via the getCaseEvents tool.
 * Same "topic word + case-reference" match pattern as lib/domains/tasks.ts.
 */
export const eventsDomain: DomainModule = {
  key: 'events',
  label: 'Events',
  llmHint: 'calendar events/hearings for ONE specific case — upcoming or past, location, status',
  match: new RegExp(
    String.raw`(?=.*\b(?:event|events|hearing|hearings|conference|calendar)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    const def = ctx.registry.get('getCaseEvents')?.definition;
    if (!def) return { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
    return {
      tools: { getCaseEvents: def },
      activeTools: ['getCaseEvents'],
      forcedCombined: false,
      requireTool: true,
    };
  },
};
