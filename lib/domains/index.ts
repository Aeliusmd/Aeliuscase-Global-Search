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

/**
 * A "how do I …" User Guide question rather than a request for case data.
 *
 * Live bug fixed 2026-08-19: every Phase-2 domain matches on a topic word plus
 * the word "case", which a guide question contains just as naturally as a data
 * question does — "How do I upload a document to a case?" matches
 * documentsDomain, which then forces getCaseDocuments (requireTool). With no
 * case to look up the call is useless, and the model answered
 * "I can only help with AeliusCase case searches and User Guide questions" —
 * refusing a question the User Guide answers. It was inconsistent too: the
 * same shape asking about tasks forced getCaseTasks but recovered, while notes
 * and events happened not to force anything and answered correctly.
 *
 * A concrete case reference (case number, "X vs Y") means it IS about one
 * case whatever the phrasing, so those are deliberately excluded — this must
 * never catch "what is the venue on case RP2010". Only the unambiguous
 * instructional shapes are matched, which is why "what is a venue" is left
 * alone: telling it apart from "what is the venue on <case>" is not worth the
 * risk, and that phrasing already answers correctly.
 */
const HOW_TO_RE = /\bhow\s+(?:do|can|could|would|should)\s+(?:i|we|you|one)\b|\bhow\s+to\b|\bwhere\s+(?:do|can)\s+(?:i|we)\b|\bexplain\s+how\b/i;
const CONCRETE_CASE_REF_RE = /\b[A-Za-z]{1,4}\d{2,}\b|\bvs\.?\b|\bv\.\s/i;

export function isGuideQuestion(message: string): boolean {
  return HOW_TO_RE.test(message) && !CONCRETE_CASE_REF_RE.test(message);
}

function regexHits(message: string): DomainModule[] {
  // A guide question keeps only the Cases fallback, whose tool selection never
  // forces a call — so the model is free to answer from the User Guide.
  if (isGuideQuestion(message)) return [casesDomain];
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

/**
 * Stage-1 (regex) + Stage-1.5 (LLM classifier, now unconditional) domain
 * resolution. Same safety invariant as isRefinementLLM (app/api/chat/route.ts):
 * the LLM here only decides which tool MENU is exposed this turn — it never
 * calls a tool itself, never touches streamText's function-calling. The
 * primary chat model still makes 100% of the real tool-selection/argument-
 * extraction decisions.
 *
 * Previously this only double-checked with the LLM when a heuristic
 * (zero regex hits / a Phase-2 topic word missing despite a case reference /
 * looksComplex()) guessed a gap might exist. That heuristic itself kept
 * missing real gaps this session (e.g. "demographics sent" matched casesDomain
 * via the bare word "case", so the zero-hits gate never even considered it) —
 * every miss meant hand-adding another regex trigger word. Now the classifier
 * runs on every message, unconditionally, removing the "did the heuristic
 * itself miss this gap" failure mode entirely.
 *
 * The LLM result is always MERGED into the regex hits (never replaces them),
 * so a wrong/hallucinated LLM classification can at worst add one extra
 * harmless tool — it can never remove a domain regex already matched
 * correctly. This merge-only behavior is what makes calling the LLM on every
 * turn safe rather than just cheaper-but-riskier.
 */
export async function resolveDomains(message: string): Promise<DomainModule[]> {
  const hits = regexHits(message);

  // A guide question must not have a Phase-2 domain merged back in by the
  // classifier — "how do I upload a document" is about the FEATURE, and any
  // domain that fires here forces a pointless single-case lookup (see
  // isGuideQuestion). Skipping the call also saves a round-trip.
  if (isGuideQuestion(message)) return hits;

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
 *
 * Live bug fixed 2026-07-29: casesDomain's own `match` regex includes bare
 * words like "case", "attorney", "paralegal", "coordinator" (by design — it's
 * the fallback domain, so a message that only mentions "case" and nothing
 * else still lands here). But that same bare-word match ALSO fires whenever
 * a more specific domain's own topic word appears alongside the literal word
 * "case" — e.g. "tasks due next week for CASE AE00224" matches tasksDomain
 * (task/due + case) AND casesDomain (bare "case"); "who is the paralegal on
 * [case]" matches caseDetailDomain (paralegal + case) AND casesDomain (bare
 * "paralegal", since Phase-1 treats it as a staff-search signal). Both got
 * merged together, diluting the specific domain's `requireTool`-forced
 * EXCLUSIVE tool with casesDomain's combinedSearch/searchCases/staff tools —
 * gpt-4o-mini non-deterministically picked the wrong one in both live tests.
 *
 * casesDomain's own doc comment already says it's meant to be a fallback
 * ("anything it misses still lands here") — so when another active domain
 * wants EXCLUSIVE control of its own single tool (requireTool), casesDomain
 * steps aside rather than merging in search/filter tools that were never
 * relevant to the question. A message that genuinely wants both a case
 * search AND case detail together (no domain demanding exclusivity) is
 * unaffected — this only excludes casesDomain, never another domain.
 */
export function selectToolsForDomains(
  domains: DomainModule[],
  ctx: DomainContext,
): DomainToolSelection {
  const selections = domains.map((d) => ({ key: d.key, sel: d.selectTools(ctx) }));

  const others = selections.filter((s) => s.key !== 'cases');
  const effective = others.length > 0 && others.some((s) => s.sel.requireTool) ? others : selections;

  const tools: Record<string, AiTool> = {};
  let forcedCombined = false;
  let requireTool = false;
  for (const { sel } of effective) {
    Object.assign(tools, sel.tools);
    forcedCombined = forcedCombined || sel.forcedCombined;
    requireTool = requireTool || sel.requireTool;
  }

  // A guide question keeps the tool MENU (the model may still choose to search
  // if it turns out to want data) but must never be FORCED into a call — the
  // answer lives in the User Guide excerpts, not in a case lookup. casesDomain
  // reaches here even for "how do I assign an attorney to a case", because
  // intentRouter reads "attorney"/"venue" as filter intents and those set
  // requireTool on their own. See isGuideQuestion.
  if (isGuideQuestion(ctx.message)) {
    return { tools, activeTools: Object.keys(tools), forcedCombined: false, requireTool: false };
  }

  return { tools, activeTools: Object.keys(tools), forcedCombined, requireTool };
}

export { casesDomain };
export type { DomainModule, DomainContext, DomainToolSelection } from './types';
