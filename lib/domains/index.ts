import type { AiTool } from '@/lib/tools/registry';
import { casesDomain } from './cases';
import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The domain registry. Adding a new resource domain (Tasks, Events, Documents,
 * Notes, Activities, Accounting…) is a ONE-file change: write the module, add it
 * here. Nothing else in the routing path needs editing.
 */
export const DOMAINS: DomainModule[] = [
  casesDomain,
  // Phase 2 (docs §11–§17): tasksDomain, eventsDomain, documentsDomain,
  //                         notesDomain, activitiesDomain, accountingDomain
];

/**
 * Stage-1 router: which domain(s) does this message touch? Falls back to the
 * Cases domain (the historical default) when nothing matches, so the model is
 * never left with zero tools for a legitimate case query.
 */
export function detectDomains(message: string): DomainModule[] {
  const hits = DOMAINS.filter((d) => d.match.test(message));
  return hits.length > 0 ? hits : [casesDomain];
}

/**
 * Merge the tool selections of every active domain: dedupe tools, OR the flags.
 * With a single active domain (today) this is just that domain's selection.
 */
export function selectToolsForDomains(
  domains: DomainModule[],
  ctx: DomainContext,
): DomainToolSelection {
  const tools: Record<string, AiTool> = {};
  let forcedCombined = false;
  let requireTool = false;
  for (const d of domains) {
    const sel = d.selectTools(ctx);
    Object.assign(tools, sel.tools);
    forcedCombined = forcedCombined || sel.forcedCombined;
    requireTool = requireTool || sel.requireTool;
  }
  return { tools, activeTools: Object.keys(tools), forcedCombined, requireTool };
}

export { casesDomain };
export type { DomainModule, DomainContext, DomainToolSelection } from './types';
