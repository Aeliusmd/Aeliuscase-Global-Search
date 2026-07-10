import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText } from 'ai';
import type { UIMessage } from 'ai';
import OpenAI from 'openai';
import { classifyIntents, type IntentKey } from '@/lib/tools/intentRouter';
import { buildToolRegistry } from '@/lib/tools/registry';
import { selectToolsForIntents } from '@/lib/tools/selector';
import { formatTodayContext, parseDateRange } from '@/lib/dateRange';
import { BODY_PART_IDS_TEXT } from '@/lib/bodyParts';

export const maxDuration = 30;

// How many recent turns the AI sees. Each "turn" = one UIMessage (user or assistant).
// Keeping this small reduces token cost while still giving the model enough context
// to stack filters (e.g. open → open+Maria → open+Maria+2024).
const CONTEXT_WINDOW = 4;

const SEARCH_TYPE_LABELS: Record<number, string> = {
  1: 'All Cases',
  2: 'Open Cases',
  3: 'Closed Cases',
  4: 'Sub-Out Cases',
};

type ToolPart = {
  type: string;
  output?: { searchType?: number; searchText?: string; totalRecords?: number };
};

/**
 * Which CombinedFilters fields the user's words actually license, derived from
 * the intents that fired. The model frequently invents structured filters it was
 * never asked for (e.g. caseTypeId:1 / venueId:1 for "cases with Aditi as
 * coordinator") — and a hallucinated value like "1" survives the >0 guard, then
 * WIPES the result via set-intersection. combinedSearch only honours a structured
 * filter whose key is in this set. Person fields (staffName/applicantName/jobRole)
 * are intentionally absent — they're governed by personSignal. `status` is absent
 * too — it's handled via enforcedSearchType, not an intent.
 */
const INTENT_COMBINED_KEYS: Partial<Record<IntentKey, string[]>> = {
  filter_case_type:   ['caseTypeId'],
  filter_venue:       ['venueId'],
  filter_sub_type:    ['caseSubTypeId'],
  filter_sub_status:  ['caseSubStatusId'],
  filter_sub_status2: ['caseSubStatusId2'],
  filter_sol:         ['solFromDate', 'solToDate'],
  filter_body_part:   ['bodyPartIds'],
  filter_special:     ['specialInstructions'],
  filter_case_date:   ['caseFromDate', 'caseToDate'],
  filter_last_name:   ['lastNameInitial'],
};

function allowedCombinedKeys(intents: IntentKey[]): Set<string> {
  const keys = new Set<string>();
  for (const it of intents) for (const k of INTENT_COMBINED_KEYS[it] ?? []) keys.add(k);
  return keys;
}

/** Pull the plain text out of a UIMessage (first text part). */
function textOf(msg: UIMessage | undefined): string {
  if (!msg) return '';
  return (
    (msg.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)?.text ?? ''
  );
}

/** Map an explicit status keyword in a message to a searchType (0 = none found). */
function explicitStatusFromText(text: string): number {
  const t = text.toLowerCase();
  if (/\b(open|active|current|pending|not closed)\b/.test(t)) return 2;
  if (/\b(clos(e|ed|es|ing)?|resolv(e|ed)?|settl(e|ed)?|complet(e|ed)?|done|finish(ed)?)\b/.test(t)) return 3;
  // Sub-Out (searchType 4) = "Sub-d Out" only. "Sub-d In" is NOT sub-out — don't map it here.
  if (/\bsub(?:bed|['’-]?d)?[\s-]?out\b/.test(t)) return 4;
  return 0;
}

/**
 * Detect a request that references a PERSON by name to find their cases, e.g.
 * "julia's open cases", "cases for Maria", "Raj ge cases". Returns the extracted
 * name, or null when the message is not a clear person-name search (case numbers,
 * "these cases", company suffixes, etc. are rejected). Used to deterministically
 * force the staff-or-client question even when no other filter is present — the
 * model alone does not reliably ask.
 */
function detectBarePersonName(text: string): string | null {
  const patterns = [
    // "X's [open] cases" / possessive
    /\b([a-z]+(?:\s+[a-z]+){0,2})'s\s+(?:open\s+|closed\s+|active\s+|pending\s+|sub[\s-]?out\s+|all\s+)?cases\b/i,
    // "cases for/of/by X" (handled by / assigned to are staff-signalled elsewhere)
    /\bcases?\s+(?:for|of|belonging\s+to|by)\s+([a-z]+(?:\s+[a-z]+){0,2})\b/i,
    // Singlish "X ge cases"
    /\b([a-z]+(?:\s+[a-z]+){0,2})\s+ge\s+cases\b/i,
  ];
  const STOP = new Set([
    'all', 'these', 'those', 'this', 'that', 'my', 'the', 'his', 'her', 'their',
    'our', 'your', 'above', 'open', 'closed', 'active', 'pending', 'rush', 'me',
    'client', 'applicant', 'staff', 'attorney', 'paralegal', 'coordinator', 'everyone',
    'recent', 'new', 'old', 'some', 'any', 'more', 'other', 'such',
    // Relative-date words — "cases for the last 4 months" must NOT be read as a
    // person named "last". Covers both counted ("last 4 months") and bare
    // ("last month") phrasings, since a trailing digit breaks the name capture.
    'last', 'next', 'past', 'previous', 'day', 'days', 'week', 'weeks',
    'month', 'months', 'year', 'years',
  ]);
  // Leading filler verbs/pronouns to peel off the front of a capture, and
  // trailing connectors to trim from the end, so we keep just the name.
  const LEAD = new Set([
    'show', 'me', 'send', 'give', 'gimme', 'find', 'get', 'list', 'pull', 'fetch',
    'bring', 'display', 'see', 'check', 'please', 'can', 'you', 'us', 'also', 'now',
    'the', 'my', 'a', 'an', 'to', 'do', 'i', 'want', 'need', 'look', 'up', 'all',
  ]);
  const TRAIL = new Set(['in', 'with', 'on', 'at', 'today', 'now', 'please', 'and', 'for', 'open', 'closed', 'cases', 'case']);
  const COMPANY = /\b(inc|llc|corp|ltd|co|company|services|trucking|markets|hospital|group|systems|industries|enterprises)\b/i;

  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let words = m[1].trim().split(/\s+/);
    while (words.length && LEAD.has(words[0].toLowerCase())) words.shift();
    while (words.length && TRAIL.has(words[words.length - 1].toLowerCase())) words.pop();
    if (words.length > 3) words = words.slice(-3);                   // a name is ≤3 words; keep the tail
    const name = words.join(' ');
    if (!name) continue;
    if (/\d/.test(name)) continue;                                   // case numbers / years
    if (COMPANY.test(name)) continue;                                // employer, not a person
    if (words.some((w) => w.length < 2)) continue;                   // stray single letters
    if (words.every((w) => STOP.has(w.toLowerCase()))) continue;     // pronouns / keywords only
    return name;
  }
  return null;
}

/**
 * Extract the PERSON NAME that follows a staff/applicant signal word, so we can
 * route it deterministically (the model otherwise drops applicant names or maps
 * them to a last-name initial). Returns the cleaned name or null.
 * e.g. "WCAB cases for client Martinez" → "Martinez"; "handled by Maria" → "Maria".
 */
function extractPersonName(text: string): string | null {
  if (!text) return null;
  const NAME = String.raw`([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})`;
  const ROLES = String.raw`other\s+attorney|other\s+staff|sup\.?\s*attorney|supervis(?:or|ing)\s*attorney|supervisor|attorney|paralegal|coordinator|legal\s+secretary|legal\s+assistant|hearing\s+rep(?:resentative)?`;
  const patterns = [
    new RegExp(String.raw`\b(?:client|applicant|claimant|injured\s+worker)\s+${NAME}`, 'i'),
    new RegExp(String.raw`\b(?:handled\s+by|assigned\s+to)\s+${NAME}`, 'i'),
    // "ROLE NAME" — role word precedes the name (e.g. "coordinator Aditi Mandal").
    new RegExp(String.raw`\b(?:${ROLES})\s+${NAME}`, 'i'),
    // "NAME as [the] ROLE" / "NAME work(s)/working as ROLE" — name precedes the
    // role (e.g. "cases with Aditi Mandal as coordinator", "Raj works as paralegal").
    new RegExp(String.raw`\b${NAME}\s+(?:works?\s+|working\s+)?as\s+(?:the\s+|a\s+)?(?:${ROLES})\b`, 'i'),
    new RegExp(String.raw`\b${NAME}'s\s+(?:open\s+|closed\s+|active\s+|sub[\s-]?out\s+|all\s+)?cases\b`, 'i'),
  ];
  const STOPCUT = new Set(['in', 'with', 'on', 'at', 'for', 'and', 'venue', 'open', 'closed', 'active', 'pending', 'sub', 'cases', 'case', 'that', 'who', 'the', 'a', 'an', 'last', 'name', 'starts', 'type', 'as', 'is', 'of', 'from', 'to', 'wcab', 'dui', 'civil', 'employment', 'immigration', 'injury', 'personal']);
  const LEAD = new Set(['show', 'me', 'send', 'give', 'find', 'get', 'list', 'pull', 'please', 'can', 'you', 'the', 'my', 'a', 'an', 'i', 'want', 'need', 'for', 'with', 'cases', 'case', 'where', 'whose', 'who', 'that']);
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const words = m[1].trim().split(/\s+/);
    while (words.length && LEAD.has(words[0].toLowerCase())) words.shift();
    const out: string[] = [];
    for (const w of words) { if (/\d/.test(w) || STOPCUT.has(w.toLowerCase())) break; out.push(w); }
    if (out.length) return out.slice(0, 3).join(' ');
  }
  return null;
}

/**
 * When the assistant's most recent message was the "staff member or
 * applicant/client?" disambiguation question, the current user message is just a
 * short answer ("applicant") that has lost the original filter words. Return the
 * PRIOR user message so intent classification + status detection can recover the
 * venue/type/status context and re-expose combinedSearch. Empty when not in a
 * clarification turn.
 */
function getClarificationPriorText(messages: UIMessage[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const atext = textOf(lastAssistant);
  if (!/staff member.*applicant\/client|applicant\/client.*staff member/i.test(atext)) return '';
  const users = messages.filter((m) => m.role === 'user');
  return users.length >= 2 ? textOf(users[users.length - 2]) : '';
}

/**
 * True when the assistant just asked "Which year should I check for expiring
 * cases?". On that turn the user's reply is a bare year/range ("2027", "2027 to
 * 2028"), so we re-inject the "expiring" context to route it back to the SOL date.
 */
function isSolYearAnswerTurn(messages: UIMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return /which year.*expiring cases/i.test(textOf(lastAssistant));
}

/**
 * Detect the intended searchType.
 *
 * Priority:
 * 1. Explicit status keyword in the CURRENT user message (always wins).
 * 2. searchType carried forward from the most recent tool result in history
 *    — so "Maria ge cases ewanna" after "open cases" stays as Open.
 * 3. Default: 1 (All Cases).
 */
function detectSearchType(messages: UIMessage[]): number {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return 1;

  // 1 — explicit override in the current message
  const explicit = explicitStatusFromText(textOf(lastUser));
  if (explicit) return explicit;

  // 2 — carry forward the most recent tool result's searchType
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as ToolPart[]) {
      if (part.type === 'tool-searchCases' && part.output?.searchType) {
        const t = part.output.searchType;
        if (t >= 1 && t <= 4) return t;
      }
    }
  }

  return 1;
}

/**
 * Carry forward the structured filter keys from the most recent combinedSearch
 * result so a follow-up that only ADDS a new criterion (e.g. "Is Raj Patel
 * handling these cases as attorney?" after "open knee injury cases last year")
 * doesn't silently drop the earlier filters. Without this, allowedFilterKeys is
 * rebuilt from scratch each turn from THIS message's own intents — a pure
 * follow-up naturally doesn't re-mention "knee" or "last year", so those keys
 * would be absent from the allow-set and combinedSearch would zero them out
 * even though the model correctly remembered and resent their values.
 * Mirrors detectSearchType's carry-forward pattern above for status.
 */
function carryForwardFilterKeys(messages: UIMessage[]): Set<string> {
  const keys = new Set<string>();
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as { type: string; output?: { filterValue?: string } }[]) {
      if (part.type !== 'tool-combinedSearch' || !part.output?.filterValue) continue;
      try {
        const prior = JSON.parse(part.output.filterValue) as Record<string, unknown>;
        for (const k of Object.keys(prior)) keys.add(k);
      } catch {
        // malformed/empty filterValue — nothing to carry forward
      }
      return keys;
    }
  }
  return keys;
}

/**
 * Extract the most recent successful search context from message history so we
 * can inject it into the system prompt. Gives the AI explicit knowledge of what
 * was last searched even when history is trimmed to CONTEXT_WINDOW messages.
 */
function getLastSearchContext(messages: UIMessage[]): string {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as ToolPart[]) {
      if (part.type === 'tool-searchCases' && part.output?.searchType) {
        const { searchType, searchText, totalRecords } = part.output;
        const label = SEARCH_TYPE_LABELS[searchType ?? 1] ?? 'All Cases';
        const term = searchText ? ` | keyword: "${searchText}"` : ' | keyword: (none — all)';
        const count = totalRecords !== undefined ? ` | found: ${totalRecords}` : '';
        return `${label}${term}${count}`;
      }
    }
  }
  return 'none';
}

/**
 * Search the OpenAI Vector Store for User Guide chunks relevant to the user's message.
 * Returns the top chunks joined as plain text, or an empty string if unavailable.
 */
async function fetchGuideContext(userMessage: string): Promise<string> {
  const vsId = process.env.OPENAI_VECTOR_STORE_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!vsId || !apiKey || !userMessage.trim()) return '';

  try {
    const client = new OpenAI({ apiKey });
    const page = await client.vectorStores.search(vsId, {
      query: userMessage,
      max_num_results: 5,
    });

    const chunks = page.data
      .filter((r) => r.score > 0.25)
      .slice(0, 3)                          // max 3 chunks
      .flatMap((r) => r.content)
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);                      // hard cap ~750 tokens

    return chunks;
  } catch {
    return '';
  }
}

/**
 * Strip large `cases` arrays from historical tool outputs before converting to
 * model messages. The model rendered those results already — it doesn't need to
 * re-read hundreds of case objects in the context window. Keeps the summary
 * fields (totalRecords, searchText, etc.) so the model still knows what was found.
 */
function trimToolOutputs(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = (msg.parts ?? []).map((part: any) => {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return part;
      if (!part.output || !Array.isArray(part.output.cases)) return part;
      return { ...part, output: { ...part.output, cases: [] } };
    });
    return { ...msg, parts } as UIMessage;
  });
}

export async function POST(req: Request) {
  const jwtToken = process.env.JWT_TOKEN;
  const apiBaseUrl = process.env.API_BASE_URL;

  console.log('[/api/chat] POST — jwt:', !!jwtToken, '| apiBase:', !!apiBaseUrl, '| openai:', !!process.env.OPENAI_API_KEY);

  if (!jwtToken || !apiBaseUrl) {
    console.error('[/api/chat] Missing JWT_TOKEN or API_BASE_URL');
    return Response.json(
      { error: 'Server configuration error: JWT_TOKEN or API_BASE_URL is not set.' },
      { status: 500 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('[/api/chat] Missing OPENAI_API_KEY');
    return Response.json(
      { error: 'OPENAI_API_KEY is not configured.', isConfigError: true },
      { status: 500 },
    );
  }

  let messages: UIMessage[];
  let clientNow: string | undefined;
  let clientTimeZone: string | undefined;
  try {
    const body = await req.json() as {
      messages: UIMessage[];
      clientNow?: string;
      clientTimeZone?: string;
    };
    messages = body.messages;
    clientNow = body.clientNow;
    clientTimeZone = body.clientTimeZone;
  } catch (err) {
    console.error('[/api/chat] req.json() failed:', err);
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // If this is a clarification answer to the "staff member or applicant/client?"
  // question, recover the prior request's words so the filters + status aren't
  // lost on this turn.
  const clarificationPrior = getClarificationPriorText(messages);

  // Detect searchType scanning the FULL history (so carry-forward works even
  // when older messages are outside the context window).
  let enforcedSearchType = detectSearchType(messages);
  if (enforcedSearchType === 1 && clarificationPrior) {
    const s = explicitStatusFromText(clarificationPrior);
    if (s) enforcedSearchType = s;
  }
  const enforcedLabel = SEARCH_TYPE_LABELS[enforcedSearchType];

  // Last search context injected into the system prompt so the AI knows the
  // active filter even if that tool result is outside the trimmed window.
  const lastSearchContext = getLastSearchContext(messages);

  // Only send the last CONTEXT_WINDOW messages to the model — trims token cost
  // while preserving enough turns for multi-step filter refinement.
  const contextMessages = messages.slice(-CONTEXT_WINDOW);

  // Fetch User Guide context in parallel with message preparation.
  const lastUserText = (
    [...messages].reverse().find((m) => m.role === 'user')?.parts
      ?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined
  )?.text ?? '';

  // Text used for INTENT classification. On a clarification turn, prepend the
  // prior request so venue/type/date intents resurface and combinedSearch is
  // exposed for the routed name. When answering the "which year?" question for an
  // expiring/SOL search, wrap the bare year so it routes back to the SOL date.
  const solYearAnswer = isSolYearAnswerTurn(messages);
  const classifyText = clarificationPrior
    ? `${clarificationPrior} ${lastUserText}`
    : solYearAnswer && /\b(19|20)\d{2}\b/.test(lastUserText)
      ? `cases expiring in ${lastUserText}`
      : lastUserText;

  // Deterministic STAFF-vs-CLIENT signal from the user's own words (current turn
  // + any clarification answer). Governs combinedSearch name routing so a bare
  // name is never silently assumed to be staff — the tool asks instead.
  const personSignal: 'staff' | 'applicant' | 'none' =
    /\b(applicant|claimant|injured\s+worker|client)\b/i.test(classifyText) ? 'applicant'
      : /\b(attorney|paralegal|coordinator|legal\s+secretary|legal\s+assistant|staff(\s+member)?|handled\s+by|assigned\s+to)\b/i.test(classifyText) ? 'staff'
        : 'none';

  // The actual person name following that signal — passed to combinedSearch so the
  // name is routed deterministically (model tends to drop applicant names or turn
  // them into a last-name initial).
  const personName = personSignal !== 'none' ? extractPersonName(classifyText) : null;

  let guideContext: string;
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    [guideContext, modelMessages] = await Promise.all([
      fetchGuideContext(lastUserText),
      convertToModelMessages(trimToolOutputs(contextMessages)),
    ]);
  } catch (err) {
    console.error('[/api/chat] convertToModelMessages failed:', err);
    return Response.json({ error: 'Message preparation failed', detail: String(err) }, { status: 500 });
  }

  const guideSection = guideContext
    ? `━━━ AELIUSCASE USER GUIDE — RELEVANT EXCERPTS ━━━
Use the following excerpts to answer questions about AeliusCase features, procedures, and usage.

${guideContext}
━━━ END OF GUIDE EXCERPTS ━━━`
    : '';

  // Deterministic bare-name gate: when the user references a person by name with
  // NO staff/client signal (and we're not already mid-clarification), force the
  // staff-or-client question by withholding ALL tools and giving an explicit
  // directive. The model cannot search without tools, so it must ask first.
  const bareName = !clarificationPrior && personSignal === 'none'
    ? detectBarePersonName(lastUserText)
    : null;

  const bareNameDirective = bareName
    ? `

‼️ THIS TURN — MANDATORY OVERRIDE: The user referred to a person by name ("${bareName}") without indicating whether they are a staff member or an applicant/client, and it is not yet established. You have NO search tools available this turn. Do NOT attempt any search. Reply with EXACTLY this, and nothing else:
"Is ${bareName} a staff member (e.g. attorney, paralegal) or an applicant/client? I'll search the right way once you let me know."`
    : '';

  const intents = classifyIntents(classifyText);
  // Structured filters the user's words actually license — passed to combinedSearch
  // so it ignores any filter the model invented (caseTypeId/venueId/…) that would
  // otherwise wipe the result via intersection.
  const allowedFilterKeys = allowedCombinedKeys(intents);
  for (const k of carryForwardFilterKeys(messages)) allowedFilterKeys.add(k);

  const anchorDate = clientNow ? new Date(clientNow) : new Date();
  const timeZone = clientTimeZone?.trim() || 'UTC';
  const todayContext = formatTodayContext(
    Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate,
    timeZone,
  );
  const resolvedDateRange = parseDateRange(
    classifyText,
    Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate,
    timeZone,
  );
  if (resolvedDateRange) {
    if (resolvedDateRange.kind === 'sol') {
      // SOL / expiry date range → statute-of-limitations fields + intent.
      allowedFilterKeys.add('solFromDate');
      allowedFilterKeys.add('solToDate');
      if (!intents.includes('filter_sol')) intents.push('filter_sol');
    } else {
      allowedFilterKeys.add('caseFromDate');
      allowedFilterKeys.add('caseToDate');
      if (!intents.includes('filter_case_date')) intents.push('filter_case_date');
    }
  }

  // Expiry / SOL query with NO resolvable year or timeframe → ask which year
  // instead of guessing or returning nothing. When a year/relative date IS given,
  // parseDateRange yields a kind='sol' range above and this stays false.
  const solNeedsYear =
    /\bexpir(?:e|es|ed|ing|ation|y)?\b|\bstatute\s+of\s+lim|\bsol\b/i.test(lastUserText)
    && !resolvedDateRange
    && /\bcase|\bexpir/i.test(lastUserText)                              // a case search, not a feature Q
    && !/\bhow\b|\bwhat\s+is\b|\bwhat\s+does\b|\bexplain\b/i.test(lastUserText);

  const solYearDirective = solNeedsYear
    ? `

‼️ THIS TURN — MANDATORY: The user asked about cases EXPIRING (SOL date) but gave NO year or timeframe. You cannot search without one. Do NOT call any tool. Reply with EXACTLY:
"Which year should I check for expiring cases? For example 2027, or a range like 2027–2028."`
    : '';

  const dateContextSection = `
TODAY (user device): ${todayContext.isoDate} (${todayContext.weekday})
USER TIMEZONE: ${todayContext.timeZone}
Use this as the anchor for "today", "yesterday", "last month", and "this month". Never guess the current date from memory.`;

  const resolvedDateSection = resolvedDateRange
    ? (resolvedDateRange.kind === 'sol'
      ? `
RESOLVED SOL DATE RANGE (server-computed — use these EXACT values, do not recalculate):
  solFromDate: "${resolvedDateRange.from}"
  solToDate:   "${resolvedDateRange.to}"
  (${resolvedDateRange.label})
This is a STATUTE OF LIMITATIONS / EXPIRY date question ("expiring", "SOL"). You MUST call combinedSearch with the exact solFromDate/solToDate above (NOT caseFromDate). Never answer from memory without calling a tool.`
      : `
RESOLVED DATE RANGE (server-computed — use these EXACT values, do not recalculate):
  caseFromDate: "${resolvedDateRange.from}"
  caseToDate:   "${resolvedDateRange.to}"
  (${resolvedDateRange.label})
You MUST call combinedSearch with the exact caseFromDate/caseToDate above (plus any other filter/status/person also mentioned). Pass the exact ISO dates above. Never answer date-filter questions from memory without calling a tool.`)
    : '';

  const selectedTools = (bareName || solNeedsYear)
    ? { tools: {}, activeTools: [], forcedCombined: false, requireTool: false }
    : selectToolsForIntents(
        intents,
        buildToolRegistry({
          apiBaseUrl, jwtToken, enforcedSearchType, enforcedLabel,
          personSignal, personName, allowedFilterKeys, resolvedDateRange,
        }),
        { explicitStatus: enforcedSearchType !== 1, hasPerson: personSignal !== 'none', hasResolvedDate: !!resolvedDateRange },
      );

  let result;
  try {
    result = streamText({
    model: openai('gpt-4o-mini'),
    system: `You are a smart assistant for Aeliuscase, a law firm case management platform.
You help with two things only:
  A) Searching cases in the database → use the searchCases tool.
  B) Answering questions about AeliusCase features and usage → use the User Guide excerpts below.

${guideSection}

━━━ HOW TO RESPOND ━━━
• Case search (find/show/look up cases — NOT when the user is asking about parties, contacts, or documents for a case) → call searchCases immediately. Never skip this. (EXCEPTION: the ambiguous bare-name rule below.)
• AMBIGUOUS BARE NAME — if the user asks for "cases for [Name]" / "[Name]'s cases" using a PERSON'S NAME, with NO role word (attorney/paralegal/coordinator) and NO "handled by"/"assigned to"/"staff member", AND the conversation has not already established whether that person is staff or a client:
  → Do NOT call any tool yet. Reply with exactly: "Is [Name] a staff member (e.g. attorney, paralegal) or an applicant/client? I'll search the right way once you let me know."
  → On the user's clarification, if the request was JUST the name (no other filters): staff/attorney/paralegal/coordinator/"handled by" → call getByStaff({ name: "[Name]" }); applicant/client/claimant → call searchCases({ searchText: "[Name]" }).
  → On the user's clarification, if the request ALSO had other filters (type/venue/status/date/body part/etc.): call combinedSearch with those filters PLUS staffName: "[Name]" (if staff) or applicantName: "[Name]" (if applicant/client). Do NOT use getByStaff/searchCases in that case.
  → This applies ONLY to a bare PERSON name. A case number (e.g. RP003613), a company/employer name, a status word (open/closed), or any other keyword → search normally with searchCases; do NOT ask.
• When the user asks for multiple things in one message (e.g. "show open cases for Maria AND parties for EL00503"), call EACH relevant tool in sequence — do not skip any. Handle them one by one within the same response.
• "What is AeliusCase", "how do I…", "what does X do", feature questions → answer from the User Guide excerpts above. Be helpful and specific. If the exact detail isn't in the excerpts, say you don't have that specific information from the guide.
• Greetings → reply warmly in 1-2 sentences.
• Questions completely unrelated to AeliusCase (world events, cooking, etc.) → reply: "I can only help with AeliusCase case searches and User Guide questions."
• After a tool result → ONE short sentence only (e.g. "Found 12 open cases for Maria.").
  NEVER list case numbers, names, employers, or any case details in text — the UI renders them automatically.
  Do NOT repeat or describe what is already shown in the result cards.
• If the user repeats a search (same or similar request), ALWAYS call the tool again — never say "I already showed that" or "you already asked that."
• Zero results → one sentence: suggest a broader or alternative search term.
• If the user asks about parties, contacts, or documents (e.g. "show me the parties", "who are the parties", "list parties", "show contacts") WITHOUT providing a case number (like RP00001) or a numeric case ID → do NOT call any tool. Reply with exactly: "Which case would you like to see parties for? Please provide a case number (e.g. RP00001) or case ID."
• Party/contact/document requests WITH a specific case number or case ID present → call getCaseParties immediately.
  Examples: "show parties for RP00001", "who is on case 12345", "get contacts for RP00056".
  REQUIRED: a case number (e.g. RP00001) or numeric case ID MUST appear in the user's message. If absent → ask first, never call the tool.

━━━ FILTER TOOLS (when user provides specific IDs or keywords) ━━━
• "status id N" / "caseStatusId N" → call getByStatusId({ caseStatusId: N })
• "sub-type id N" / "caseSubTypeId N" → call getBySubTypeId({ caseSubTypeId: N })
• "sub-status id N" / "caseSubStatusId N" → call getBySubStatusId({ caseSubStatusId: N })
• "sub-status2 id N" / "caseSubStatusId2 N" → call getBySubStatusId2({ caseSubStatusId2: N })
• "venue id N" / "venue N" → call getByVenueId({ venueId: N })
• "rush cases" / "on hold" / "special instruction [keyword]" → call getBySpecialInstruction({ specialInstructions: "keyword" })
• "SOL from [date] to [date]" / "statute of limitations [year]" → call getBySolDate({ solFromDate, solToDate })
  Dates must be ISO 8601 format (e.g. "2024-01-01"). Ask the user if dates are unclear.
• "body part id [N]" / "body part [N,M]" → call getByBodyPartIds({ bodyPartIds: [N, M] })
  Known IDs: ${BODY_PART_IDS_TEXT}.
  ‼️ These IDs are THIS APP'S OWN numbering (1=Head, 2=Brain, 3=Ear...) — a small sequential range, 1 through 63 ONLY. This is NOT the same as the common workers'-comp body-part code convention you may know (100=Head, 110=Brain, etc.) — that convention is WRONG here and must never be used. If user says a body part NAME, map it ONLY to the ID table above. If no match, ask for the numeric ID.
• "cases opened in 2024" / "case date from [date] to [date]" / "cases created between X and Y" → call getByCaseDate({ fromDate, toDate })
  Dates ISO 8601 (e.g. "2024-01-01"). A bare year "2024" → fromDate="2024-01-01", toDate="2024-12-31". This is the CASE date, NOT SOL.
• "[type] cases" / "main type N" / "type id N" → call getByCaseTypeId({ caseTypeId: N }). Map the type NAME to its ID:
  1=WCAB, 2=DUI, 3=Personal Injury, 4=WCAB Defense, 5=Class Action, 6=Civil, 7=Employment, 8=Immigration, 9=Social Security.
  (This is the MAIN type — different from sub-type. If the user clearly means "sub-type", use getBySubTypeId instead.)
• "last name starts with [letter]" / "last name initial [letter]" → call getByLastNameInitial({ lastNameInitial: "M" }) — one A–Z letter.
• "cases for [Role] [Name]" / "cases handled by [Name]" / "[Name]'s cases" / "[Name]'s cases as [role]" → call getByStaff({ name: "...", jobRole?: "..." })
  Pass the person's name. Pass jobRole with the EXACT case ROLE/SLOT the user named — one of: Attorney, Supervisor Attorney (a.k.a. "Sup Attorney"), Paralegal, Coordinator, Other Attorney, Other Staff, Hearing Rep. This returns ONLY the cases where the person holds that slot (e.g. "Raj's cases as paralegal"). Omit jobRole when no role is named → all their cases.
  If the tool reports multiple matches, ask the user which person (a fuller name). If none, say so.
For ALL filter tools: if the required ID or value is missing from the user's message, ask for it — never guess.

━━━ COMBINED / MULTI-FILTER SEARCH ━━━
• When the user gives TWO OR MORE filter criteria in ONE request (e.g. "Open WCAB cases for Attorney Raj in Venue 5", "Personal Injury cases opened in 2024 with last name D", "closed cases in venue 3 with a head injury") → call combinedSearch ONCE with ALL the criteria as parameters. Do NOT call the individual filter tools separately.
  - Map type names to caseTypeId (1=WCAB,2=DUI,3=Personal Injury,4=WCAB Defense,5=Class Action,6=Civil,7=Employment,8=Immigration,9=Social Security).
  - status: 2=Open, 3=Closed, 4=Sub-Out (the "open/closed/active" word).
  - body part names → bodyPartIds using ONLY the 1-63 ID table listed above — NEVER the common 100/110/120-style workers'-comp codes.
• PERSON NAME inside a combined search — decide which KIND of name it is, then pass the matching parameter (never both):
  - STAFF member — a role word (attorney/paralegal/coordinator/legal secretary/legal assistant) OR "handled by"/"assigned to" → pass staffName. ALSO pass jobRole with the exact case ROLE/SLOT if the user named one (Attorney, Supervisor Attorney, Paralegal, Coordinator, Other Attorney, Other Staff, Assistant Attorney, Senior Associate, Hearing Rep) to filter to that slot — e.g. "open cases where Raj is the paralegal". combinedSearch resolves the name to an ID.
  - APPLICANT/CLIENT — "applicant"/"client"/"claimant"/"injured worker", or the conversation already established the person is the client → pass applicantName.
  - BARE ambiguous name (no role word, not stated as a client, not already established) → do NOT call combinedSearch yet; follow the AMBIGUOUS BARE NAME rule above (ask staff-or-client first), THEN call combinedSearch with staffName OR applicantName plus the other filters.
• A SINGLE filter criterion PLUS a person's name (e.g. "WCAB cases for John Smith", "venue 5 cases handled by Maria") IS a combined search → call combinedSearch with that filter + the name (routed per the rule above).
• A SINGLE filter criterion with NO status word and NO person name → use that filter's individual tool (not combinedSearch).
• A single filter criterion TOGETHER WITH an open/closed/sub-out status (e.g. "Open WCAB cases", "closed cases in venue 5") → call combinedSearch with that filter + status (the single filter tools cannot filter status).
• If combinedSearch reports multiple staff matches, relay the question — ask which person.

Do NOT answer general knowledge questions about the world, technology trends, or anything outside AeliusCase.

${dateContextSection}${resolvedDateSection}

LAST SEARCH IN THIS SESSION: ${lastSearchContext}
CURRENT ENFORCED FILTER (server-side): ${enforcedLabel} (searchType=${enforcedSearchType})

━━━ HOW TO BUILD SEARCH QUERIES ━━━
Always look at the conversation history AND the LAST SEARCH context above to build
the most specific searchText possible. Stack filters progressively:

  Step 1 — User asks for open cases
           → searchType=2, searchText="" (all open)

  Step 2 — User says "show Maria's cases"
           → searchType=2 (still open, carried forward), searchText="Maria"

  Step 3 — User says "cases in 2024"
           → searchType=2 (still open), searchText="Maria 2024"

  Step 4 — User says "now show closed" / "filter only open" / "sub-out cases"
           → ONLY the searchType changes. searchText="Maria 2024" carries forward unchanged.
           → This is a STATUS-ONLY filter. Do NOT clear or change searchText.

  Step 5 — User says "based on above cases only send me RP0036 cases"
    (or: "from the above", "from those results", "from what you showed", "filter from these",
         "within those", "of those cases", "narrow down to", "from those")
           → ALWAYS additive. APPEND new keyword to existing searchText.
           → searchType=2 (unchanged), searchText="Maria RP0036"
           → NEVER reset to just "RP0036" alone when a back-reference phrase is used.

  Step 6 — User says "send me RP0036 cases" (NO back-reference phrase)
           → TOPIC REPLACEMENT. Use only the new keyword.
           → searchType=2 (still open, carried forward), searchText="RP0036"
           → Do NOT combine or append "Maria" — "send me X cases" is a fresh request for X.

Rules for searchText:
- When the user ONLY changes the status filter (open/closed/sub-out/all),
  keep the EXACT same searchText from the last search — do not add or remove anything.
- ADDITIVE TRIGGER PHRASES — if the user message contains any of these, ALWAYS append
  the new keyword to the existing searchText, NEVER replace it:
  "based on above", "from the above", "from those results", "from what you showed",
  "filter from", "from those cases", "narrow down", "within those", "of those", "from above".
- Topic replacement — when the user provides a new standalone name/number/keyword WITHOUT
  any additive trigger phrase (e.g. "send me RP0036 cases", "find John Smith", "search AE0099"),
  use ONLY the new keyword as searchText. Do NOT carry forward the previous searchText.
- For date hints: append the year or month as a keyword (e.g. "Maria 2024", "RP2292 Jan").
- NEVER include status words ("open", "closed", "sub-out") in searchText — status is in searchType.
- Keep searchText SHORT — name, case number, or keyword only.

searchType values:
- 1 = All Cases  2 = Open only  3 = Closed only  4 = Sub-Out only (status "Sub-d Out" — NOT "Sub-d In")${bareNameDirective}${solYearDirective}`,
    messages: modelMessages,
    stopWhen: stepCountIs(5),
    tools: selectedTools.tools,
    activeTools: selectedTools.activeTools,
    // A concrete filter intent fired (forced-combined or merely offered) —
    // gpt-4o-mini sometimes narrates ("I'll search for...") instead of calling
    // the tool, so require a call on the first step only (forcing every step
    // would block the model from ever replying with the final summary text
    // after the tool result comes back). When combinedSearch was specifically
    // FORCED, require that exact tool; otherwise require any of the offered
    // tools (lets the model still choose between the single-filter tool and
    // combinedSearch, e.g. when it detects a person's name).
    ...(selectedTools.forcedCombined
      ? { prepareStep: ({ stepNumber }: { stepNumber: number }) =>
          stepNumber === 0 ? { toolChoice: { type: 'tool' as const, toolName: 'combinedSearch' } } : {} }
      : selectedTools.requireTool
      ? { prepareStep: ({ stepNumber }: { stepNumber: number }) =>
          stepNumber === 0 ? { toolChoice: 'required' as const } : {} }
      : {}),
  });
  } catch (err) {
    console.error('[/api/chat] streamText threw:', err);
    return Response.json({ error: 'Chat failed', detail: String(err) }, { status: 500 });
  }

  return result.toUIMessageStreamResponse();
}
