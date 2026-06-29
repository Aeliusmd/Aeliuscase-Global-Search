import type { IntentKey } from './intentRouter';
import type { AiTool, ToolEntry } from './registry';

const INTENT_TOOLS: Record<IntentKey, string[]> = {
  case_search:        ['searchCases'],
  case_parties:       ['getCaseParties'],
  filter_status:      ['getByStatusId'],
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
}

const FILTER_INTENTS = new Set<IntentKey>([
  'filter_status', 'filter_sub_type', 'filter_sub_status', 'filter_sub_status2',
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
  opts: { explicitStatus?: boolean } = {},
): SelectedTools {
  const filterCount = intents.filter((i) => FILTER_INTENTS.has(i)).length;
  const forceCombined = filterCount >= 2 || (filterCount >= 1 && !!opts.explicitStatus);
  const offerCombined = filterCount >= 1;

  let names: string[];
  if (forceCombined) {
    const nonFilter = [...new Set(
      intents.filter((i) => !FILTER_INTENTS.has(i)).flatMap((i) => INTENT_TOOLS[i] ?? []),
    )];
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
  return { tools, activeTools: Object.keys(tools) };
}
