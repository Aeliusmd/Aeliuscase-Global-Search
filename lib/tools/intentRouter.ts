export type IntentKey =
  | 'case_search'
  | 'case_parties'
  | 'filter_status'
  | 'filter_sub_type'
  | 'filter_sub_status'
  | 'filter_sub_status2'
  | 'filter_venue'
  | 'filter_sol'
  | 'filter_body_part'
  | 'filter_special'
  | 'filter_case_date'
  | 'filter_case_type'
  | 'filter_last_name'
  | 'filter_staff'
  | 'conversational';

// Evaluated top-to-bottom. classifyIntents returns ALL matches, so order only
// matters for the more-specific-vs-broader pairs noted below.
const RULES: [IntentKey, RegExp][] = [
  ['case_parties',       /\b(parties|party|contacts|who\s+is\s+on|documents\s+for)\b/i],
  ['filter_status',      /\bstatus\s*id\b|\bcaseStatusId\b/i],
  ['filter_sub_status2', /\bsub[\s-]?status\s*2\b|\bcaseSubStatusId2\b/i],
  ['filter_sub_status',  /\bsub[\s-]?status\s*(id)?\b|\bcaseSubStatusId\b/i],
  ['filter_sub_type',    /\bsub[\s-]?type\s*(id)?\b|\bcaseSubTypeId\b/i],
  ['filter_venue',       /\bvenue\s*(id)?\b|\bvenueId\b/i],
  ['filter_sol',         /\bsol\b|\bstatute\s+of\s+lim|\bexpir(?:e|es|ed|ing|ation|y)?\b/i],
  ['filter_body_part', new RegExp(
    String.raw`\bbody[\s-]?part(?:s)?\b|\bbodyParts?\b` +
    String.raw`|\b(?:head|brain|ear|eye|face|jaw|mouth|teeth?|nose|scalp|skull|neck|shoulder|arm|elbow|wrist|hand|finger|thumb|back|spine|spinal|chest|rib|hip|thigh|knee|leg|ankle|foot|toes?|lumbar|cervical|thoracic|hernia|groin|tailbone|coccyx)\s+(?:injur\w*|cases?|pain\w*|claim\w*)\b` +
    String.raw`|\binjur(?:y|ies|ed)\s+(?:to\s+(?:the\s+)?)?(?:head|brain|ear|eye|face|jaw|mouth|teeth?|nose|scalp|skull|neck|shoulder|arm|elbow|wrist|hand|finger|thumb|back|spine|spinal|chest|rib|hip|thigh|knee|leg|ankle|foot|toes?|lumbar|cervical|thoracic|hernia|groin|tailbone|coccyx)\b` +
    String.raw`|\bheart\s+attack\b|\bcovid(?:-?19)?\b`,
    'i',
  )],
  ['filter_special',     /\bspecial\s+instruction|\brush\b|\bon[\s-]?hold\b/i],
  // Staff / role — a role word, or "handled by / assigned to". Also matches the
  // short clarification answers users give ("staff", "she is a paralegal", etc.).
  ['filter_staff',       /\b(attorney|paralegal|coordinator|legal\s+secretary|legal\s+assistant|staff(\s+member)?|handled\s+by|assigned\s+to)\b/i],
  // Case (open) date — kept distinct from SOL (filter_sol) above.
  ['filter_case_date',   /\bcase\s*date\b|\b(opened|created|filed)\s+(in|on|between|from)\b/i],
  ['filter_case_date',   /\b(last|this)\s+month\b|\btoday\b|\byesterday\b/i],
  // Relative trailing ranges: "last 3 months", "past 30 days", "last year", "last week".
  ['filter_case_date',   /\b(?:last|past|previous)\s+\d+\s*(?:day|week|month|year)s?\b|\b(?:last|past|previous)\s+(?:week|year)\b/i],
  // Future ranges: "next 3 months", "next year", "next month", "this year" (e.g. SOL/expiry).
  ['filter_case_date',   /\bnext\s+\d+\s*(?:day|week|month|year)s?\b|\bnext\s+(?:week|month|year)\b|\bthis\s+year\b/i],
  ['filter_case_date',   /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+month)?(?:\s+(?:of\s+)?\d{4})?\b/i],
  ['filter_case_date',   /\bcases?\s+(?:open|closed|active|pending|sub[\s-]?out\s+)?(?:in|from|during|on)\s+(?:\d{4})\b|\b(?:in|from|during|on)\s+(?:\d{4})\s+cases?\b|\b(?:\d{4})\s+cases?\b/i],
  // Main case type — "type" or a known type name. (sub-type already matched above if present.)
  ['filter_case_type',   /\b(case\s*)?type\s*(id)?\b|\b(personal\s+injury|wcab|employment|immigration|civil|class\s+action|social\s+security|dui)\b/i],
  // Last-name initial.
  ['filter_last_name',   /\blast\s*name\b|\b(name\s+)?starts?\s+with\b|\binitial\b/i],
  ['case_search',        /\b(find|show|search|look\s*up|get|list|send|give|pull|fetch|bring|display|see|check|ewanna|pennanna|search)\b/i],
];

// Returns ALL matched intents so multi-intent queries get multiple tools exposed.
// Falls back to ['case_search'] when nothing matches (same behaviour as before).
export function classifyIntents(message: string): IntentKey[] {
  const matched = RULES
    .filter(([, regex]) => regex.test(message))
    .map(([intent]) => intent);
  return matched.length > 0 ? matched : ['case_search'];
}
