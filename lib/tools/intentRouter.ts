export type IntentKey =
  | 'case_search'
  | 'case_parties'
  | 'filter_status'
  | 'filter_status_label'
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
  // Parties/contacts/docs for a case, OR a single-case party-field lookup
  // ("who is the attorney/venue/applicant/carrier ON/FOR case X"). The
  // "<field> (on|for)" shape implies one specific case, not a list filter —
  // e.g. "attorney on RP2476", "venue for case RP2010" (≠ "cases for attorney Raj").
  //
  // The field-lookup half was originally an ADJACENT-token pattern (field word
  // directly followed by "on/for/assigned to" then a case-NUMBER) — found live
  // 2026-07-19 (QA round 2) to miss two realistic cases: (a) "insurance
  // company" (only "insurance carrier" was recognized), and (b) any case-NAME
  // reference ("the Smith vs Wallmart matter") plus any phrasing where words
  // sit between the field word and the case reference ("who the attorney IS
  // FOR the ... matter") — the adjacency requirement rejected both, even
  // though every Phase-2 domain (lib/domains/*.ts) already handles case names
  // and non-adjacent phrasing via two independent lookaheads. Rewritten to the
  // same style: the field word and a case-reference (word "case", a
  // case-number token, or "vs"/"v.") just need to BOTH appear anywhere in the
  // message, not be adjacent.
  ['case_parties', new RegExp(
    String.raw`\b(?:parties|party|contacts?|who\s+is\s+on|documents\s+for|insurance\s+(?:carrier|company))\b` +
      String.raw`|(?=.*\b(?:attorney|applicant|defendant|coordinator|venue|carrier|employer)\b)` +
      String.raw`(?=.*(?:\bcase\b|\b[A-Za-z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s))`,
    'i',
  )],
  ['filter_status',      /\bstatus\s*id\b|\bcaseStatusId\b/i],
  // Detailed case-status LABEL (the "Employee Workload" screen's categories) —
  // distinct from the simple Open/Closed/Sub-Out toggle. This regex is a
  // starting-point heuristic built from labels verified live on this firm's
  // data; the actual lookup (lib/caseStatus.ts) is fully dynamic per firm, so
  // a firm with different label wording just won't trigger this fast-path
  // (the model can still ask a clarifying question).
  ['filter_status_label', /\bsettled\b|\bdismiss(?:ed)?\b|\bdropped\b|\bre[\s-]?opened\b|\breopen(?:ed)?\b|\bsettlement\s+pending\b|\binactive\b|\bsub[\s-]?d[\s-]?(?:out|in)\b|\bclosed\s+by\s+(?:c\s*&\s*r|stipulation)\b/i],
  ['filter_sub_status2', /\bsub[\s-]?status\s*2\b|\bcaseSubStatusId2\b/i],
  ['filter_sub_status',  /\bsub[\s-]?status\s*(id)?\b|\bcaseSubStatusId\b/i],
  ['filter_sub_type',    /\bsub[\s-]?type\s*(id)?\b|\bcaseSubTypeId\b/i],
  ['filter_venue',       /\bvenue\s*(id)?\b|\bvenueId\b/i],
  ['filter_sol',         /\bsol\b|\bstatute\s+of\s+lim|\bexpir(?:e|es|ed|ing|ation|y)?\b/i],
  ['filter_body_part', new RegExp(
    String.raw`\bbody[\s-]?part(?:s)?\b|\bbodyParts?\b` +
    String.raw`|\b(?:head|brain|ear|eye|face|jaw|mouth|teeth?|nose|scalp|skull|neck|shoulder|arm|elbow|wrist|hand|finger|thumb|back|spine|spinal|chest|rib|hip|thigh|knee|leg|ankle|foot|toes?|lumbar|cervical|thoracic|hernia|groin|tailbone|coccyx)\s+(?:injur\w*|cases?|pain\w*|claim\w*)\b` +
    String.raw`|\binjur(?:y|ies|ed)\s+(?:to\s+)?(?:the\s+|their\s+|his\s+|her\s+|a\s+)?(?:head|brain|ear|eye|face|jaw|mouth|teeth?|nose|scalp|skull|neck|shoulder|arm|elbow|wrist|hand|finger|thumb|back|spine|spinal|chest|rib|hip|thigh|knee|leg|ankle|foot|toes?|lumbar|cervical|thoracic|hernia|groin|tailbone|coccyx)\b` +
    String.raw`|\bheart\s+attack\b|\bcovid(?:-?19)?\b`,
    'i',
  )],
  ['filter_special',     /\bspecial\s+instruction|\brush\b|\bon[\s-]?hold\b/i],
  // Staff / role — a role word, or "handled by / assigned to". Also matches the
  // short clarification answers users give ("staff", "she is a paralegal", etc.).
  ['filter_staff',       /\b(attorney|paralegal|coordinator|legal\s+secretary|legal\s+assistant|senior\s+associate|hearing\s+rep(?:resentative)?|supervis(?:e|es|or|ed|ing)|staff(\s+member)?|handled\s+by|assigned\s+to)\b/i],
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
  ['filter_case_type',   /\b(case\s*)?type\s*(id)?\b|\b(personal\s+injury|wcab|workers?\s+comp(?:ensation)?|employment|immigration|civil|class\s+action|social\s+security|dui)\b|\bpi\s+cases?\b/i],
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
