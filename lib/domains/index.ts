import type { AiTool } from '@/lib/tools/registry';
import { casesDomain } from './cases';
import { caseDetailDomain } from './caseDetail';
import { tasksDomain } from './tasks';
import { eventsDomain } from './events';
import { documentsDomain } from './documents';
import { notesDomain } from './notes';
import { activitiesDomain } from './activities';
import { accountingDomain } from './accounting';
import { classifyDomainsLLM } from './llmClassifier';
import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The domain registry. Adding a new resource domain (Tasks, Events, Documents,
 * Notes, Activities, Accounting…) is a ONE-file change: write the module, add it
 * here. Nothing else in the routing path needs editing.
 *
 * Phase 2 (docs/Phase 02.html §11–§17) is now complete: all 7 sections
 * (caseDetail, tasks, events, documents, notes, activities, accounting) built.
 */
export const DOMAINS: DomainModule[] = [
  casesDomain,
  caseDetailDomain,
  tasksDomain,
  eventsDomain,
  documentsDomain,
  notesDomain,
  activitiesDomain,
  accountingDomain,
];

function regexHits(message: string): DomainModule[] {
  return DOMAINS.filter((d) => d.match.test(message));
}

/**
 * Stage-1 router: which domain(s) does this message touch? Falls back to the
 * Cases domain (the historical default) when nothing matches, so the model is
 * never left with zero tools for a legitimate case query.
 *
 * Pure regex, synchronous, unchanged behavior — kept as-is (rather than folded
 * into resolveDomains) so existing callers/tests that rely on a sync API keep
 * working untouched. Use resolveDomains() in new code that can await.
 */
export function detectDomains(message: string): DomainModule[] {
  const hits = regexHits(message);
  return hits.length > 0 ? hits : [casesDomain];
}

/** Cheap, zero-LLM-cost heuristic: is this message plausibly bundling more than
 *  one topic, such that regex (which only OR's independent domain patterns)
 *  might have caught one but missed another? Multiple conjunctions, multiple
 *  case-number-shaped tokens, or unusual length are the signals — deliberately
 *  loose (false positives here just mean one extra cheap LLM call, not a
 *  correctness issue). */
function looksComplex(message: string): boolean {
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  const hasConjunction = /\b(and|also|as\s+well\s+as|plus|additionally)\b/i.test(message) || message.includes(',');
  const caseRefCount = (message.match(/\b[A-Z]{1,4}\d{3,}\b/gi) ?? []).length;
  return wordCount > 12 || hasConjunction || caseRefCount > 1;
}

/** Does the message reference ONE specific case at all (by number, name, or
 *  the bare word "case")? Every Phase-2 domain requires this alongside its own
 *  topic word, so a message that has this but matched NO Phase-2 domain is a
 *  much stronger "regex might have missed the topic word" signal than zero
 *  hits alone — casesDomain's own regex includes the bare word "case", so
 *  relying on "zero hits total" almost never fires for genuinely on-topic
 *  messages (this is what the real "demographics sent" gap turned out to be:
 *  casesDomain matched via the word "case", hits.length was NOT zero, so a
 *  zero-hits-only gate silently never double-checked it). */
function hasCaseReference(message: string): boolean {
  return /\bcase\b/i.test(message) || /\b[A-Z]{1,4}\d{3,}\b/.test(message) || /\bvs\.?\b/i.test(message) || /\bv\.\s/i.test(message);
}

/**
 * Stage-1 (regex) + Stage-1.5 (LLM fallback) domain resolution. Same safety
 * invariant as isRefinementLLM (app/api/chat/route.ts): the LLM here only
 * decides which tool MENU is exposed this turn — it never calls a tool itself,
 * never touches streamText's function-calling. The primary chat model still
 * makes 100% of the real tool-selection/argument-extraction decisions.
 *
 * Double-checks with the LLM in three situations:
 * - Zero regex hits at all (not even the always-broad casesDomain matched).
 * - NO Phase-2 (non-Cases) domain matched, but the message clearly references
 *   ONE case — the real gap found live while building Section 6 ("when was
 *   the demographics sent on case RP003668" matches casesDomain via the bare
 *   word "case", so hits.length is NOT zero, but no Phase-2 topic word fired).
 * - A Phase-2 domain DID match, but the message looksComplex() — it might be
 *   bundling a second topic regex missed.
 *
 * In every case where regex already found something, the LLM result is
 * MERGED into the regex hits (never replaces them), so a wrong/hallucinated
 * LLM classification can at worst add one extra harmless tool — it can never
 * remove a domain regex already matched correctly.
 *
 * Known accepted limitation: a message that matches the WRONG Phase-2 domain
 * via regex (not just the generic Cases fallback) is not double-checked
 * unless it also looksComplex() — would require running the LLM on every
 * turn, losing the zero-cost common case.
 */
export async function resolveDomains(message: string): Promise<DomainModule[]> {
  const hits = regexHits(message);
  const hasPhase2Domain = hits.some((d) => d.key !== casesDomain.key);

  const noHitsAtAll = hits.length === 0;
  const missedPhase2Signal = !hasPhase2Domain && hasCaseReference(message);
  const multiTopicSignal = hasPhase2Domain && looksComplex(message);
  const shouldDoubleCheck = noHitsAtAll || missedPhase2Signal || multiTopicSignal;

  if (!shouldDoubleCheck) return hits.length > 0 ? hits : [casesDomain];

  const keys = await classifyDomainsLLM(message, DOMAINS).catch((err) => {
    console.error('[domains] resolveDomains: classifyDomainsLLM rejected unexpectedly:', err);
    return [] as string[];
  });
  if (keys.length > 0) console.log('[domains] LLM fallback fired:', message, '→', keys);
  const llmHits = DOMAINS.filter((d) => keys.includes(d.key));

  const merged = new Map(hits.map((d) => [d.key, d] as const));
  for (const d of llmHits) merged.set(d.key, d);
  return merged.size > 0 ? [...merged.values()] : [casesDomain];
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
