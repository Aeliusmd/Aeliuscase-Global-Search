import type { IntentKey } from './intentRouter';
import type { AiTool, ToolEntry } from './registry';

const INTENT_TOOLS: Record<IntentKey, string[]> = {
  case_search:        ['searchCases'],
  case_parties:       ['getCaseParties'],
  filter_status:      ['getByStatusId'],
  // No dedicated single-filter tool — resolving a status LABEL to id(s) needs
  // the live per-firm lookup only combinedSearch's engine does (see combined.ts).
  filter_status_label: [],
  filter_sub_type:    ['getBySubTypeId'],
  filter_sub_status:  ['getBySubStatusId'],
  filter_sub_status2: ['getBySubStatusId2'],
  filter_venue:       ['getByVenueId'],
  filter_sol:         ['getBySolDate'],
  filter_body_part:   ['getByBodyPartIds'],
  filter_special:     ['getBySpecialInstruction'],
  filter_case_date:   ['getByCaseDate'],
  filter_case_type:   ['getByCaseTypeId'],
  filter_last_name:   ['getByLastNameInitial'],
  filter_staff:       ['getByStaff'],
  conversational:     [],
};

export interface SelectedTools {
  tools: Record<string, AiTool>;
  activeTools: string[];
  /** True when combinedSearch was FORCED (multi-criteria) — the model must call it, not narrate. */
  forcedCombined: boolean;
  /**
   * True whenever ANY concrete filter intent fired (forced or merely offered
   * alongside combinedSearch) — gpt-4o-mini sometimes narrates ("I'll search
   * for...") instead of calling the tool even for a single-filter query, so the
   * caller should require SOME tool call (not necessarily combinedSearch) on the
   * first step. False for pure conversational/case-search/parties turns, where a
   * text-only reply (e.g. asking for a missing case number) is legitimate.
   */
  requireTool: boolean;
}

const FILTER_INTENTS = new Set<IntentKey>([
  'filter_status', 'filter_status_label', 'filter_sub_type', 'filter_sub_status', 'filter_sub_status2',
  'filter_venue', 'filter_sol', 'filter_body_part', 'filter_special',
  'filter_case_date', 'filter_case_type', 'filter_last_name', 'filter_staff',
]);

// Accepts multiple intents, merges their tool sets (deduped).
//
// combinedSearch (AND across all criteria) is handled in two ways:
//   • FORCE — replace the individual filter tools with combinedSearch when we
//     KNOW it's multi-criteria: two or more filter intents, OR one filter intent
//     plus an explicit status word (the single filter tools ignore status).
//   • OFFER — when only a single filter intent is present (no status), expose
//     combinedSearch ALONGSIDE the individual tools. This lets the model combine
//     that filter with a person's NAME it detects in the message (staffName or
//     applicantName) — a name isn't its own filter intent, so it can't be counted
//     here, but the prompt decides combined-vs-single from the name's presence.
// Any non-filter tools still requested (e.g. parties, search) are kept alongside.
export function selectToolsForIntents(
  intents: IntentKey[],
  registry: Map<string, ToolEntry>,
  opts: { explicitStatus?: boolean; hasPerson?: boolean; hasResolvedDate?: boolean; forceContinuation?: boolean } = {},
): SelectedTools {
  const filterCount = intents.filter((i) => FILTER_INTENTS.has(i)).length;
  // FORCE combinedSearch (hide single filter tools) when it's genuinely multi-
  // criteria: 2+ filters, OR one filter plus a status word, OR one filter plus a
  // PERSON (staff/applicant), OR a server-resolved date range (so the model can't
  // pick the wrong date tool or drop the exact dates), OR a REFINEMENT of a prior
  // search that carried filters forward (even with 0 new filter intents — e.g.
  // "closed ones instead" keeps the prior type) — otherwise the model picks a
  // single filter tool and silently drops a criterion.
  const forceCombined = filterCount >= 2
    || (filterCount >= 1 && (!!opts.explicitStatus || !!opts.hasPerson || !!opts.hasResolvedDate))
    || !!opts.forceContinuation;
  const offerCombined = filterCount >= 1 || !!opts.forceContinuation;

  let names: string[];
  if (forceCombined) {
    // Drop the free-text searchCases here. When a structured/combined search is
    // required (2+ filters, or a filter + status, or a filter + a person), the
    // plain text search ignores EVERY structured filter and misleads — e.g.
    // "cases with Aditi as coordinator" → searchCases("Aditi") hits 0 applicants,
    // while combinedSearch resolves her staffId + Coordinator slot → real cases.
    // Exposing both let the model pick non-deterministically (same prompt, two
    // answers). Keep other non-filter tools (e.g. getCaseParties — different job).
    const nonFilter = [...new Set(
      intents.filter((i) => !FILTER_INTENTS.has(i)).flatMap((i) => INTENT_TOOLS[i] ?? []),
    )].filter((name) => name !== 'searchCases');
    names = ['combinedSearch', ...nonFilter];
  } else if (offerCombined) {
    names = [...new Set([...intents.flatMap((i) => INTENT_TOOLS[i] ?? []), 'combinedSearch'])];
  } else {
    names = [...new Set(intents.flatMap((i) => INTENT_TOOLS[i] ?? []))];
  }

  const tools: Record<string, AiTool> = {};
  for (const name of names) {
    const entry = registry.get(name);
    if (entry) tools[name] = entry.definition;
  }
  return { tools, activeTools: Object.keys(tools), forcedCombined: forceCombined, requireTool: offerCombined };
}
