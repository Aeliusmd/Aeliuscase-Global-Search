// openai(modelId) defaults to OpenAI's stateful Responses API
// (/v1/responses) in @ai-sdk/openai v3 — live-reproduced 2026-07-27
// (AI_APICallError, 4x in one test window): "Item with id 'msg_...' not
// found", a stale Responses-API item/conversation reference. openai.chat(...)
// forces the plain, stateless Chat Completions API (/v1/chat/completions)
// instead, which this app's usage (no cross-request conversation state on
// OpenAI's side — history is managed entirely by us) doesn't need.
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, generateText, stepCountIs, streamText } from 'ai';
import type { UIMessage } from 'ai';
import OpenAI from 'openai';
import { classifyIntents, type IntentKey } from '@/lib/tools/intentRouter';
import { buildToolRegistry } from '@/lib/tools/registry';
import { makeGetCasePartiesTool } from '@/lib/tools/impl/parties';
import { resolveDomains, selectToolsForDomains, type DomainModule } from '@/lib/domains';
import { SECTION_SAMPLE_CAP } from '@/lib/tools/impl/caseDetail';
import { formatTodayContext, parseDateRange } from '@/lib/dateRange';
import { BODY_PART_IDS_TEXT } from '@/lib/bodyParts';
import { resolveCaseVenueId } from '@/lib/caseParties';
import { resolveRoleSlot, type RoleSlotResolution } from '@/lib/roleSlots';
import { isVerificationFollowUp, lastPhase2ToolContext } from '@/lib/phase2FollowUp';
import { getRequestAuth } from '@/lib/auth/request';
import { collectCaseNumbers, recordAudit } from '@/lib/audit';
import {
  additiveCaseKeyword,
  defaultCaseSearchText,
  isImplicitSearchRefinement,
  isMixedCaseSearchAndPartyRequest,
  whoIsOnCaseRef,
} from '@/lib/searchContext';

// 300s = the maximum a Vercel Function may run on a Pro-plan project (standard
// Vercel Functions, no Fluid Compute). Was 30s — live-reproduced 2026-07-27
// (case RP003668: 231KB raw response, 18 injuries, 34 documents, 128
// activities) truncating a comprehensive "show me everything" reply mid-
// sentence because the backend fetch + gpt-4o-mini's generation didn't finish
// inside the old 30s ceiling.
export const maxDuration = 300;

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
  output?: { searchType?: number; searchText?: string; totalRecords?: number; filterValue?: string };
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
  filter_status_label: ['caseStatusLabel'],
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

/**
 * Parse a single-filter tool's scalar `filterValue` (see lib/caseFilters.ts) back
 * into the CombinedFilters field(s) it represents, so a follow-up can carry that
 * filter forward. `status` (caseStatusId) is intentionally omitted — status has
 * its own carry-forward path (enforcedSearchType).
 */
const FILTER_VALUE_PARSERS: Record<string, (v: string) => Record<string, unknown>> = {
  venueId: (v) => ({ venueId: Number(v) }),
  caseTypeId: (v) => ({ caseTypeId: Number(v) }),
  caseSubTypeId: (v) => ({ caseSubTypeId: Number(v) }),
  caseSubStatusId: (v) => ({ caseSubStatusId: Number(v) }),
  caseSubStatusId2: (v) => ({ caseSubStatusId2: Number(v) }),
  specialInstructions: (v) => ({ specialInstructions: v }),
  lastNameInitial: (v) => ({ lastNameInitial: v }),
  bodyPartIds: (v) => ({ bodyPartIds: v.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) }),
  solDate: (v) => { const [f, t] = v.split('~'); return { ...(f ? { solFromDate: f } : {}), ...(t ? { solToDate: t } : {}) }; },
  caseDate: (v) => { const [f, t] = v.split('~'); return { ...(f ? { caseFromDate: f } : {}), ...(t ? { caseToDate: t } : {}) }; },
};

/** Anaphoric / additive wording that marks a message as REFINING the prior search. */
function isRefinement(text: string): boolean {
  return /\b(they|those|these|them|all\s+of\s+them|the\s+ones|of\s+the(?:se|m)\b|from\s+(?:the\s+)?above|from\s+those|from\s+these|which\s+of|narrow(?:\s+down)?|within\s+(?:those|these)|only\s+the|just\s+the|refine|filter\s+(?:these|those|them|down|from)|instead|also\s+(?:in|with|by)|and\s+(?:in|with)\s)/i.test(text);
}

/**
 * LLM fallback for isRefinement(). The regex above is a fast, free, zero-latency
 * first check that catches the common/explicit anaphoric phrasings — but it's a
 * hand-maintained word list, so novel phrasing (e.g. "are they all open cases?"
 * before "they" was added) silently falls through, leaving the model to guess an
 * answer from stale/trimmed context instead of re-querying (this exact bug was
 * reported and fixed once already — this is the general-case fix).
 *
 * This only answers "is this message a follow-up on the PREVIOUS search", nothing
 * more — the actual tool-call decision stays fully deterministic server-side
 * (`refining` still just forces combinedSearch). So this can't reintroduce the
 * original hallucination failure mode (the model autonomously deciding whether to
 * call a tool) — it only feeds the same deterministic gate the regex already does.
 * Only invoked when there IS a prior filter to refine (see call site), so a fresh
 * first message never pays this cost.
 */
async function isRefinementLLM(message: string, priorLabel: string): Promise<boolean> {
  try {
    const { text } = await generateText({
      model: openai.chat('gpt-4o-mini'), // explicit Chat Completions API — see doc comment at top import for why
      system: `You classify ONE chat message sent to a legal case-search assistant.
The user's PREVIOUS search was filtered by: ${priorLabel}.
Does the NEW message below build on / narrow down / ask a question about THOSE SAME results (a follow-up) — or does it start a brand-new, unrelated search?
Reply with EXACTLY one word: FOLLOWUP or NEW. No punctuation, no explanation.`,
      prompt: message,
      maxOutputTokens: 16, // OpenAI's minimum for this API path — verified live, 5 throws a 400
      temperature: 0,
    });
    return /FOLLOWUP/i.test(text);
  } catch (err) {
    console.error('[/api/chat] isRefinementLLM failed, defaulting to NEW:', err);
    return false;
  }
}

/** Human-readable list of carried filters for the prompt. */
function formatCarriedFilters(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([k, v]) => `  - ${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(v)}`)
    .join('\n');
}

/**
 * A single-case FIELD question ("what's the venue on that case", "who is the
 * attorney on it") that references the case ANAPHORICALLY, with no case number in
 * THIS message. Such a follow-up must go to getCaseParties for the case the user
 * was just viewing — not a filter tool (e.g. "venue" → getByVenueId(0)).
 *
 * "documents?" removed from the field list 2026-07-28 (live bug, case AE005):
 * this predates Phase 2's dedicated getCaseDocuments/documentsDomain (the
 * fuller case-level document list) — with it still here, ANY "documents"
 * question force-exposed ONLY getCaseParties (requireTool: true), which
 * returns just party-attached docs (often empty), so the model reported
 * "no documents" even when getCaseDocuments would have found real ones.
 */
/**
 * The party TYPES that genuinely exist as rows in the parties response
 * (GetAllPartiesWithDocsbyCaseId), so getCaseParties can actually answer a
 * question about them — single source of truth for the three regexes below.
 *
 * Live bug fixed 2026-08-12 (case AE-00224, 37 party rows): `applicant`,
 * `attorney` and `coordinator` used to be in this list, which force-routed
 * those questions to getCaseParties EXCLUSIVELY (requireTool, see the
 * partiesFollowUpRef branch). But the parties response has NO "Applicant" row
 * and NO "Coordinator" row at all, and its "Attorney" row is a PARTY's
 * attorney, not the case's assigned attorney. With no correct row to read, the
 * model picked the nearest-looking one and answered confidently wrong:
 *
 *   "who is the applicant"   -> "Hiruni Kumari smokes"   (the "Plaintiff" row)
 *   "who is the attorney"    -> "CCCAplicant company"    (the "Applicant Attorney" row)
 *   "who is the coordinator" -> "Medcube USA"            (nearest company name)
 *
 * The correct values (Tharushi samindika Perera / Test Usetwo / Matrix Admin)
 * all come from getCaseFullDetail, which maps applicant, attorney,
 * supervisorAttorney, coordinator and paralegal explicitly (see
 * lib/caseFullDetail.ts's mapCaseFullDetail). Dropping those three words here
 * lets caseDetailDomain take exclusive control of them instead — casesDomain
 * already defers to it (see selectToolsForDomains). `defendant`, `venue`,
 * `insurance carrier` and `employer` stay: those DO exist as real party rows
 * and were verified to answer correctly.
 */
const PARTY_ANSWERABLE_FIELDS =
  String.raw`parties|part(?:y|ies)|contacts?|venue|insurance\s+carrier|carrier|defendant|employer|adjuster`;

/**
 * A question asking for a CONTACT DETAIL (email / address / phone / fax) about
 * a party, rather than asking WHO that party is.
 *
 * Live bug fixed 2026-08-12 — two of the Phase-02 user story's own §1 examples
 * ("What is the insurance carrier's email address...", "What is the employer's
 * address?"). getCaseParties is force-routed for `carrier`/`employer`, but the
 * upstream parties response carries ONLY partyType, partyName and docs — no
 * contact fields at all (verified live: every row on case 224 has exactly
 * those three keys). So it could never answer, and replied "the email address
 * is not provided" / restated the company NAME as if it were an address.
 *
 * getCaseFullDetail does map these (see types/caseFullDetail.ts —
 * employer.address, insuranceCarrier.email, defendant.address, applicant
 * phone/email), so a contact-detail question skips the parties force-route and
 * lets caseDetailDomain take it. A plain "who is the insurance carrier"
 * question has no contact word, so it still goes to getCaseParties exactly as
 * before.
 */
const CONTACT_DETAIL_RE =
  /\b(?:e-?mail|address|phone|telephone|mobile|fax|contact\s+(?:details?|info(?:rmation)?|number)|zip|postal\s+code)\b/i;

function anaphoricPartyFieldQuestion(text: string): boolean {
  const field = new RegExp(String.raw`\b(?:${PARTY_ANSWERABLE_FIELDS})\b`, 'i');
  const anaphor = /\b(?:that|this|the|same)\s+(?:case|one|matter|file)\b|\bon\s+it\b|\bfor\s+it\b/i;
  const hasCaseNumber = /\b[A-Za-z]{1,3}\d{3,}\b/;
  return field.test(text) && anaphor.test(text) && !hasCaseNumber.test(text);
}

/**
 * "How many cases are in THAT venue?" — an anaphoric reference to the VENUE of the
 * case the user was just viewing (not a field of the case itself). We resolve that
 * case's venueId and search it, instead of asking which venue.
 */
function anaphoricVenueOfCaseQuestion(text: string): boolean {
  return /\b(?:that|this|the|same)\s+venue\b/i.test(text)
    && /\bcases?\b|\bhow\s+many\b/i.test(text)
    && !/\bvenue\s*(?:id\s*)?\d/i.test(text);   // "venue 5" gives a concrete id — not anaphoric
}

/**
 * A single-case FIELD question that NAMES the case ("who is the attorney on
 * RP2134", "venue for case RP2010"). Returns the case number. Must go to
 * getCaseParties — a role word like "attorney" otherwise pulls it to a staff /
 * combined search. Distinct from the anaphoric form (no number) above.
 *
 * "documents?" removed from the field list 2026-07-28 (live bug reproduced
 * both directly and locally, case AE005): "Show me the documents on case
 * AE005" matched this pattern (documents ... on ... AE005) and force-exposed
 * ONLY getCaseParties — the model then answered from its (often-empty)
 * party-attached partyDocs array and said "no documents on file" even though
 * getCaseDocuments (Phase 2's dedicated case-level document list) had real
 * ones. This check runs BEFORE domain-based tool selection in the route, so
 * it fully excluded getCaseDocuments rather than merely offering both.
 */
function explicitCasePartyFieldRef(text: string): string | null {
  const generalPartyRef = whoIsOnCaseRef(text);
  if (generalPartyRef) return generalPartyRef;
  const m = text.match(
    new RegExp(
      String.raw`\b(?:${PARTY_ANSWERABLE_FIELDS})\b.{0,40}?\b(?:on|for)\b\s+(?:case\s+)?([A-Za-z]{1,3}\d{2,})\b`,
      'i',
    ),
  );
  return m ? m[1] : null;
}

/** Any field word explicitCasePartyFieldRef/anaphoricPartyFieldQuestion match — shared so
 *  isNarrowPartyFieldQuestion classifies the SAME word set those two already trigger on. */
const PARTY_FIELD_WORD_RE = new RegExp(String.raw`\b(${PARTY_ANSWERABLE_FIELDS})\b`, 'i');
/** "parties"/"party"/"contact(s)" mean "list everything" — every other field word
 *  (venue, insurance carrier, applicant, defendant, attorney, coordinator, employer,
 *  adjuster) names exactly ONE fact. */
const GENERAL_PARTY_WORD_RE = /^(?:part(?:y|ies)|contacts?)$/i;

/**
 * Live UX issue (2026-07-29): "who is the insurance carrier for AE00224" forced
 * getCaseParties (via explicitCasePartyFieldRef/anaphoricPartyFieldQuestion
 * above) same as a general "show me the parties for AE00224" — both share one
 * field-word regex that doesn't distinguish "give me everything" from "give me
 * ONE fact". The result: a 39-row parties table rendered, and the model's text
 * padded a one-line fact out into a numbered list plus a closing filler
 * sentence. This classifies which kind of question it was so the forced-tool
 * branch below can mark the call `narrow` — the client hides the big table and
 * the model is told to answer in one sentence (see PartiesToolOutput.narrow).
 * Returns false (not narrow) when no field word matches at all — callers only
 * use this after already confirming a field word triggered a party lookup.
 */
function isNarrowPartyFieldQuestion(text: string): boolean {
  const m = text.match(PARTY_FIELD_WORD_RE);
  return m ? !GENERAL_PARTY_WORD_RE.test(m[1]) : false;
}

/**
 * "Show me everything on case X" / "full detail for X" — a comprehensive
 * single-case request that must go to getCaseFullDetail ONLY. Live bug
 * (2026-07-27, case RP003668): this phrasing also matches casesDomain's
 * broad Phase-1 wording ("show", "case"), so the model was ALSO offered
 * getCaseParties — a much sparser tool, and (before a separate fix) one that
 * leaked raw PII (SSN, DOB, occupation) straight through. gpt-4o-mini
 * non-deterministically picked either tool for the identical question across
 * repeated tests. Forcing getCaseFullDetail exclusively for this phrasing
 * removes the ambiguity outright, the same way partiesFollowUpRef/
 * venueOfCaseId below force a single tool for their own specific phrasing.
 */
function comprehensiveCaseDetailQuestion(text: string): boolean {
  const comprehensive = /\b(everything|full\s*detail|full\s*case\s*(?:card|detail)|comprehensive)\b/i;
  const caseRef = /\bcase\b|\b[A-Za-z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s/i;
  return comprehensive.test(text) && caseRef.test(text);
}

/**
 * Phase-2 domain follow-ups with NO case reference of their own ("send me
 * the Filed Application document", "what's overdue") — anaphoric to whichever
 * case a PRIOR getCaseFullDetail/getCaseTasks/getCaseEvents/getCaseDocuments/
 * getCaseNotes/getCaseActivities/getCaseAccounting call was about. Live bug
 * (2026-07-27, case RP003668): a document-name follow-up with no case
 * reference at all matched NO domain (every Phase-2 domain's own regex
 * requires a case reference alongside its topic word — see e.g.
 * lib/domains/documents.ts), fell through to casesDomain's default case-
 * SEARCH tools, and searched for "Filed application for adjudication
 * document" as if it were a case name — 0 results, "no cases found". Mirrors
 * the existing partiesFollowUpRef/venueOfCaseId anaphoric patterns above,
 * just for the 6 newer Phase-2 tools instead of getCaseParties/combinedSearch.
 */
const PHASE2_ANAPHORIC_TOPICS: Array<{ re: RegExp; tool: string }> = [
  { re: /\b(task|tasks|to-?dos?|due|overdue)\b/i, tool: 'getCaseTasks' },
  { re: /\b(event|events|hearing|hearings|conference|calendar)\b/i, tool: 'getCaseEvents' },
  { re: /\b(document|documents|upload(?:ed|s)?|files?)\b/i, tool: 'getCaseDocuments' },
  { re: /\bnotes?\b/i, tool: 'getCaseNotes' },
  { re: /\b(activit(?:y|ies)|audit|history)\b/i, tool: 'getCaseActivities' },
  { re: /\b(accounting|cheques?|invoices?|settlement\s*fees?|client\s*costs?|current\s*balance)\b/i, tool: 'getCaseAccounting' },
];

function anaphoricPhase2Tool(text: string): string | null {
  const hasOwnCaseRef = /\bcase\b|\b[A-Za-z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s/i.test(text);
  if (hasOwnCaseRef) return null; // has its own reference — normal domain routing already handles this
  for (const { re, tool } of PHASE2_ANAPHORIC_TOPICS) {
    if (re.test(text)) return tool;
  }
  return null;
}

/** Single-case DETAIL fields (the ones getCaseFullDetail maps) — the caseDetail
 *  counterpart to PHASE2_ANAPHORIC_TOPICS above. Deliberately excludes the
 *  general "parties"/"contacts" words: those mean "list everything" and belong
 *  to getCaseParties, which anaphoricPartyFieldQuestion already routes. */
const CASE_DETAIL_FIELD_RE = new RegExp(
  String.raw`\b(?:applicant|defendant|attorney|paralegal|coordinator|insurance\s+carrier|carrier` +
    String.raw`|employer|adjuster|venue|injur\w*|body\s*parts?|sol|statute\s+of\s+lim\w*` +
    String.raw`|doi|date\s+of\s+injury|adj\s*(?:number|#|no)?|demographics?|jet\s*file)\b`,
  'i',
);

/**
 * A single-case FIELD question with NO case reference of its own AND no
 * anaphor word either — "Who is the paralegal?" asked straight after a
 * question about a specific case.
 *
 * Live bug fixed 2026-08-12 — this is verbatim an acceptance criterion in
 * docs/qa/phase02-user-story-test-queries.md §1 ("ask right after any of the
 * above, with no case number: Who is the paralegal?"). anaphoricPartyFieldQuestion
 * only fires when an explicit anaphor ("that/this/the/same case", "on it") is
 * present, so a bare field question matched nothing at all, fell through to
 * casesDomain, and the chatbot asked "Which case would you like to see the
 * paralegal for?" — re-asking for a case number the user had given one turn
 * earlier. Mirrors anaphoricPhase2Tool exactly, just for getCaseFullDetail's
 * own field set.
 */
function anaphoricCaseDetailQuestion(text: string): boolean {
  // Has its own case reference — normal domain routing handles it.
  if (/\bcase\b|\b[A-Za-z]{1,4}\d{3,}\b|\bvs\.?\b|\bv\.\s/i.test(text)) return false;
  // Plural "cases" means a LIST search ("Raj's cases as attorney"), not a
  // single-case field lookup — don't hijack it into a one-case detail call.
  if (/\bcases\b/i.test(text)) return false;
  // "How many cases are in that venue?" is a list search scoped to the prior
  // case's venue — venueOfCaseId owns that path, so leave it alone.
  if (anaphoricVenueOfCaseQuestion(text)) return false;
  return CASE_DETAIL_FIELD_RE.test(text);
}

/** The most recent case referenced by any Phase-2 tool call (getCaseFullDetail
 *  nests it under output.data; the other 6 return it at the top level). */
function lastPhase2CaseRef(messages: UIMessage[]): string | null {
  return lastPhase2ToolContext(messages)?.caseRef ?? null;
}

/** The most recent case number referenced — a prior getCaseParties lookup, or one the user typed. */
function lastCaseRefFromHistory(messages: UIMessage[]): string | null {
  const CN = /\b([A-Za-z]{1,3}\d{3,})\b/;
  for (const msg of [...messages].reverse()) {
    if (msg.role === 'assistant') {
      for (const part of (msg.parts ?? []) as { type: string; input?: { caseNumber?: string }; output?: { caseRef?: string } }[]) {
        if (part.type !== 'tool-getCaseParties') continue;
        const ref = part.output?.caseRef ?? part.input?.caseNumber;
        const m = ref ? String(ref).match(CN) : null;
        if (m) return m[1];
      }
    } else if (msg.role === 'user') {
      const m = textOf(msg).match(CN);
      if (m) return m[1];
    }
  }
  return null;
}

/** Pull the plain text out of a UIMessage (first text part). */
function textOf(msg: UIMessage | undefined): string {
  if (!msg) return '';
  return (
    (msg.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)?.text ?? ''
  );
}

/** Map an explicit status keyword in a message to a searchType (0 = none found). */
/**
 * Deterministically detects an explicit COUNT question ("how many...", "how much...",
 * "what's the total number of...", "count of..."). Used to safely re-enable a spoken
 * number in the model's reply: rather than trusting the model to read totalRecords out
 * of the tool-result JSON (proven unreliable — it has both hallucinated a wrong number
 * and silently omitted it for the exact same query), `prepareStep` below injects the
 * REAL totalRecords value into the prompt only for this narrow, explicitly-detected
 * case, so the model only ever has to copy a number we hand it, never compute one.
 */
function isCountQuestion(text: string): boolean {
  return /\bhow\s+many\b|\bhow\s+much\b|\b(?:count|number|total)\s+of\b|\btotal\s+number\b|\bcount\b.*\bcases?\b/i.test(text);
}

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
    // Common prepositions — live-reproduced bug (2026-07-21): "cases for the
    // MONTH OF July" captures "the month of" (capped at 3 words before hitting
    // "July"), "the" gets peeled by LEAD, leaving "month of". "month" alone was
    // already a stop word, but the all-words-are-stopwords bailout still let it
    // through because "of" wasn't — the model then asked "Is month of a staff
    // member...?". No real person's name is composed only of prepositions, so
    // these are safe to add without risking a false negative on an actual name.
    'of', 'in', 'on', 'at', 'to', 'by', 'from', 'with',
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
  // Action verbs that commonly sit BETWEEN a name and "as ROLE" in question forms
  // ("Is X handling these cases as attorney") — they are not part of a name.
  const VERB = String.raw`handl(?:e|es|ing)|manag(?:e|es|ing)|supervis(?:e|es|ing)|work(?:s|ing)?|doing|assigned|responsible|ha(?:ve|s)`;
  const patterns = [
    new RegExp(String.raw`\b(?:client|applicant|claimant|injured\s+worker)\s+${NAME}`, 'i'),
    new RegExp(String.raw`\b(?:handled\s+by|assigned\s+to|supervised\s+by)\s+${NAME}`, 'i'),
    // Interrogative / verb form: "Is/Does/Are NAME handling/managing/… as ROLE" —
    // the name follows the question verb and precedes the action verb. Placed BEFORE
    // the greedy "NAME as ROLE" pattern (which would otherwise grab "handling these
    // cases" as the "name"). e.g. "Is raj patel handling these cases as attorney".
    new RegExp(String.raw`\b(?:is|does|are|did|was|were|do|will|has|have)\s+${NAME}\s+(?:${VERB}|the)\b`, 'i'),
    // "ROLE NAME" — role word precedes the name (e.g. "coordinator Aditi Mandal").
    new RegExp(String.raw`\b(?:${ROLES})\s+${NAME}`, 'i'),
    // "NAME as [the] ROLE" / "NAME work(s)/working as ROLE" — name precedes the
    // role (e.g. "cases with Aditi Mandal as coordinator", "Raj works as paralegal").
    new RegExp(String.raw`\b${NAME}\s+(?:works?\s+|working\s+)?as\s+(?:the\s+|a\s+)?(?:${ROLES})\b`, 'i'),
    new RegExp(String.raw`\b${NAME}'s\s+(?:open\s+|closed\s+|active\s+|sub[\s-]?out\s+|all\s+)?cases\b`, 'i'),
  ];
  const STOPCUT = new Set(['in', 'with', 'on', 'at', 'for', 'and', 'venue', 'open', 'closed', 'active', 'pending', 'sub', 'cases', 'case', 'that', 'who', 'the', 'a', 'an', 'last', 'name', 'starts', 'type', 'as', 'is', 'of', 'from', 'to', 'wcab', 'dui', 'civil', 'employment', 'immigration', 'injury', 'personal',
    // verbs / pronouns a greedy pattern can wrongly pull into a name
    'handle', 'handles', 'handling', 'handled', 'manage', 'manages', 'managing', 'work', 'works', 'working', 'doing', 'does', 'do', 'assigned', 'responsible', 'these', 'those', 'them', 'this', 'by']);
  const LEAD = new Set([
    'show', 'me', 'send', 'give', 'find', 'get', 'list', 'pull', 'please', 'can', 'you', 'the', 'my', 'a', 'an', 'i', 'want', 'need', 'for', 'with', 'cases', 'case', 'where', 'whose', 'who', 'that',
    // A role word can leak into the front of the capture via the interrogative
    // pattern above ("does ATTORNEY Raj Patel have" — NAME's greedy word class
    // doesn't know "attorney" is a role, not part of the name). Peel it off here
    // token-by-token, same as any other filler.
    'attorney', 'paralegal', 'coordinator', 'supervisor', 'supervising', 'other', 'staff',
    'legal', 'secretary', 'assistant', 'senior', 'associate', 'hearing', 'rep', 'representative', 'sup',
  ]);
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const words = m[1].trim().split(/\s+/);
    while (words.length && LEAD.has(words[0].toLowerCase())) words.shift();
    const out: string[] = [];
    for (const w of words) { if (/\d/.test(w) || STOPCUT.has(w.toLowerCase())) break; out.push(w); }
    // Strip a trailing possessive ('s) that the NAME char class can absorb
    // ("Raj Patel's" → "Raj Patel").
    if (out.length) return out.slice(0, 3).join(' ').replace(/'s$/i, '');
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
      if (part.type === 'tool-combinedSearch' && part.output?.filterValue) {
        try {
          const status = Number((JSON.parse(part.output.filterValue) as { status?: unknown }).status);
          if (status >= 1 && status <= 4) return status;
        } catch {
          // Ignore malformed historical tool output and continue scanning.
        }
      }
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
function carryForwardFilterContext(messages: UIMessage[]): { values: Record<string, unknown>; keys: Set<string> } {
  const empty = { values: {} as Record<string, unknown>, keys: new Set<string>() };
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as { type: string; output?: { filterType?: string; filterValue?: string; searchText?: string } }[]) {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-') || !part.output) continue;
      const out = part.output;

      // combinedSearch — filterValue is the JSON of the CombinedFilters used.
      if (part.type === 'tool-combinedSearch' && out.filterValue) {
        try {
          const prior = JSON.parse(out.filterValue) as Record<string, unknown>;
          const values: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(prior)) {
            if (k === 'status' || k === 'subOutFilter') continue; // status carried via enforcedSearchType
            values[k] = v;
          }
          return { values, keys: new Set(Object.keys(values)) };
        } catch {
          return empty;
        }
      }

      // Single-filter tool — reconstruct its CombinedFilters field from filterType.
      if (out.filterType && out.filterValue !== undefined && FILTER_VALUE_PARSERS[out.filterType]) {
        const values = FILTER_VALUE_PARSERS[out.filterType](String(out.filterValue));
        return { values, keys: new Set(Object.keys(values)) };
      }

      // Free-text search / parties — no structured filter to carry. Stop at the
      // most recent search so we don't resurrect a filter from further back.
      if (part.type === 'tool-searchCases') {
        const searchText = out.searchText?.trim();
        return searchText
          ? { values: { applicantName: searchText }, keys: new Set(['applicantName']) }
          : empty;
      }
      if (part.type === 'tool-getCaseParties') return empty;
    }
  }
  return empty;
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
 * Live bug fixed 2026-07-29 (AI_APICallError, confirmed via Vercel runtime
 * logs): a long-running conversation thread on a large, data-heavy case
 * (AE-00224: 68 documents, 989 activities, 39 parties, 16 injuries) sent
 * 186,843 tokens to gpt-4o-mini — over its 128K limit — and the request
 * hard-failed with a 400, which the chatbot UI shows as a stuck/empty
 * response with no error text. This trimmer only ever zeroed `cases` (the
 * search/filter tools' array), so every Phase-2 tool's own bulky arrays
 * (getCaseParties' parties/partyDocs, getCaseFullDetail's nested
 * documents/tasks/events/notes/activities) passed through completely
 * untouched — CONTEXT_WINDOW=4 messages was never actually a token-size
 * bound, just a message-COUNT one, and a case this size blew straight
 * through it within that window.
 *
 * Trims those same fields, plus the same set nested one level under `data`
 * (getCaseFullDetail's shape: `{success, data: {tasks, events, ...}}`). The
 * model already answered from this data on the turn it was fetched — a
 * follow-up question re-triggers a fresh tool call (see
 * partiesFollowUpDirective/phase2FollowUpDirective) rather than relying on
 * stale history, so dropping the bulk here doesn't lose anything the model
 * still needs. Keeps summary fields (totalRecords, caseNumber, etc.) so the
 * model still knows what was found.
 */
const TRIMMABLE_ARRAY_KEYS = ['cases', 'parties', 'partyDocs', 'candidates', 'documents', 'tasks', 'events', 'notes', 'activities'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimArrayFields(obj: Record<string, any>): { value: Record<string, any>; changed: boolean } {
  let changed = false;
  const value = { ...obj };
  for (const key of TRIMMABLE_ARRAY_KEYS) {
    if (Array.isArray(value[key]) && value[key].length > 0) {
      value[key] = [];
      changed = true;
    }
  }
  return { value, changed };
}

function trimToolOutputs(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = (msg.parts ?? []).map((part: any) => {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return part;
      if (!part.output || typeof part.output !== 'object') return part;

      const top = trimArrayFields(part.output);
      let output = top.value;
      let changed = top.changed;

      if (output.data && typeof output.data === 'object' && !Array.isArray(output.data)) {
        const nested = trimArrayFields(output.data);
        if (nested.changed) {
          output = { ...output, data: nested.value };
          changed = true;
        }
      }

      return changed ? { ...part, output } : part;
    });
    return { ...msg, parts } as UIMessage;
  });
}

export async function POST(req: Request) {
  const auth = getRequestAuth(req);
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!auth) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const jwtToken = auth.token;
  // This app's own scheme+host, from the actual incoming request — used to
  // build an ABSOLUTE document download URL. A relative one let the model
  // invent a wrong fake host when writing the markdown link itself (live
  // bug, 2026-07-28) — an always-broken link.
  const appOrigin = new URL(req.url).origin;

  if (!apiBaseUrl) {
    console.error('[/api/chat] Missing API_BASE_URL');
    return Response.json(
      { error: 'Server configuration error: API_BASE_URL is not set.' },
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

  // Explicit "how many"/"how much"/"count of" question — see isCountQuestion for
  // why this unlocks a real, injected number instead of a model-guessed one.
  const countQuestion = isCountQuestion(classifyText);

  // Deterministic STAFF-vs-CLIENT signal from the user's own words (current turn
  // + any clarification answer). Governs combinedSearch name routing so a bare
  // name is never silently assumed to be staff — the tool asks instead.
  let personSignal: 'staff' | 'applicant' | 'none' =
    /\b(applicant|claimant|injured\s+worker|client)\b/i.test(classifyText) ? 'applicant'
      : /\b(attorney|paralegal|coordinator|legal\s+secretary|legal\s+assistant|senior\s+associate|hearing\s+rep(?:resentative)?|supervis(?:e|es|or|ed|ing)|staff(\s+member)?|handled\s+by|assigned\s+to|supervised\s+by)\b/i.test(classifyText) ? 'staff'
        : 'none';

  // The actual person name following that signal — passed to combinedSearch so the
  // name is routed deterministically (model tends to drop applicant names or turn
  // them into a last-name initial).
  let personName = personSignal !== 'none' ? extractPersonName(classifyText) : null;

  // Phase-1 contract: "cases for John Smith" is a normal case keyword search,
  // defaulting to applicant/client semantics. Explicit staff wording still wins.
  const defaultSearchText = personSignal === 'none' ? defaultCaseSearchText(lastUserText) : null;
  if (defaultSearchText) {
    personSignal = 'applicant';
    personName = defaultSearchText;
  }

  // Deterministic ROLE-SLOT detection, mirroring personName above: the model's
  // own `jobRole` tool argument was previously trusted unconditionally (in
  // combined.ts / staff.ts), which let it invent a role (e.g. "Other Attorney")
  // the user never named — silently zeroing out results. Resolve the slot from
  // the user's own words instead; the tools now use ONLY this, never the
  // model-supplied jobRole.
  let resolvedRoleSlot: RoleSlotResolution = personSignal === 'staff' ? resolveRoleSlot(classifyText) : null;

  // Carry the prior search's structured filters forward (from combinedSearch OR a
  // single-filter tool) so a refinement follow-up ("which of those are in venue
  // 13", "closed ones instead") builds on them instead of silently dropping them.
  // Computed here (rather than after) so its result can gate the LLM refinement
  // classifier below and run inside the SAME Promise.all — no added latency.
  const priorFilters = carryForwardFilterContext(messages);
  const regexRefining = priorFilters.keys.size > 0
    && (isRefinement(lastUserText) || isImplicitSearchRefinement(lastUserText));
  // Only ask the LLM when the fast regex didn't already decide AND there's a
  // prior filter worth refining — a fresh first message never pays this cost.
  const needsLLMRefinementCheck = priorFilters.keys.size > 0 && !regexRefining;

  let guideContext: string;
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  let llmRefining = false;
  let activeDomains: DomainModule[];
  try {
    [guideContext, modelMessages, llmRefining, activeDomains] = await Promise.all([
      fetchGuideContext(lastUserText),
      convertToModelMessages(trimToolOutputs(contextMessages)),
      needsLLMRefinementCheck
        ? isRefinementLLM(lastUserText, formatCarriedFilters(priorFilters.values))
        : Promise.resolve(false),
      // Stage-1 (regex) + Stage-1.5 (LLM fallback, only when regex is empty or
      // the message looksComplex()) domain routing — see lib/domains/index.ts's
      // resolveDomains() doc comment for the same safety invariant as
      // isRefinementLLM above: this only decides which tool MENU is exposed
      // this turn, never which tool gets called.
      resolveDomains(classifyText),
    ]);
  } catch (err) {
    console.error('[/api/chat] convertToModelMessages failed:', err);
    return Response.json({ error: 'Message preparation failed', detail: String(err) }, { status: 500 });
  }
  // Deterministic gate: regex (fast path) OR LLM classifier (fallback for
  // phrasing the regex doesn't recognize) — either one forces the same
  // server-side combinedSearch call. See isRefinementLLM's doc comment for why
  // this can't reintroduce the original hallucination failure mode.
  const refining = regexRefining || llmRefining;

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
  // otherwise wipe the result via intersection. (priorFilters/refining computed
  // earlier, alongside the guideContext/modelMessages fetch — see above.)
  const allowedFilterKeys = allowedCombinedKeys(intents);
  for (const k of priorFilters.keys) allowedFilterKeys.add(k);

  // On a refinement turn, carry the STAFF/APPLICANT signal forward too — a pure
  // anaphoric follow-up ("are they all open cases?") has no role word/"client" of
  // its own, but the prior combinedSearch already resolved one. Without this, the
  // carried staffName/applicantName (from priorFilters) gets re-sent with
  // personSignal='none', which makes combinedSearch ask the staff-or-applicant
  // question again even though it was already established last turn.
  if (refining && personSignal === 'none') {
    if (typeof priorFilters.values.staffName === 'string') {
      personSignal = 'staff';
      personName = priorFilters.values.staffName;
    } else if (typeof priorFilters.values.applicantName === 'string') {
      personSignal = 'applicant';
      personName = priorFilters.values.applicantName;
    }
  }
  const newCaseKeyword = refining ? additiveCaseKeyword(lastUserText) : null;
  if (newCaseKeyword && typeof priorFilters.values.applicantName === 'string') {
    personSignal = 'applicant';
    personName = `${priorFilters.values.applicantName} ${newCaseKeyword}`.trim();
  }
  // Carry the resolved ROLE SLOT forward too on a refinement turn (e.g. "Raj's
  // cases as paralegal" → "only the open ones" must stay scoped to paralegal,
  // not revert to all of Raj's cases) — the follow-up naturally doesn't repeat
  // the role word, so without this the slot would silently drop.
  if (refining && !resolvedRoleSlot && typeof priorFilters.values.staffJobRole === 'string') {
    resolvedRoleSlot = { kind: 'slot', jobRole: priorFilters.values.staffJobRole, label: priorFilters.values.staffJobRole };
  }

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
You MUST call combinedSearch with the exact caseFromDate/caseToDate above (plus any other filter/status/person also mentioned). Pass the exact ISO dates above. Note: "opened in [year]" / "created in [year]" refers to the case OPEN DATE only — do NOT add an open/closed status filter unless the user explicitly says "open", "closed", or "sub-out". Never answer date-filter questions from memory without calling a tool.`)
    : '';

  // When refining a prior search, tell the model exactly which filters to keep so
  // it re-sends their values (combinedSearch only honours a key that's also in
  // allowedFilterKeys, which we populated above from priorFilters).
  const carriedFiltersSection = refining
    ? `

‼️ THIS TURN — REFINEMENT OF THE PREVIOUS SEARCH: The user is narrowing the previous results, NOT starting over. Call combinedSearch and INCLUDE these prior filters together with the new criterion the user just gave:
${formatCarriedFilters(priorFilters.values)}
Re-send every prior filter above (with the same values) plus the new one. Only drop them if the user clearly begins a brand-new, unrelated search.`
    : '';

  // Single-case field question → getCaseParties. Either the case is NAMED in this
  // message ("who is the attorney on RP2134" — a role word would otherwise pull it
  // to a staff/combined search), or it's anaphoric ("what's the venue on THAT
  // case") and we take the case from the prior parties lookup.
  const partyFieldRef = (!bareName && !solNeedsYear)
    ? (explicitCasePartyFieldRef(lastUserText)
       ?? (anaphoricPartyFieldQuestion(lastUserText) ? lastCaseRefFromHistory(messages) : null))
    : null;

  // Same detector, two destinations: a party CONTACT DETAIL (email/address/
  // phone) has to come from getCaseFullDetail, because the parties response
  // carries no such fields — see CONTACT_DETAIL_RE. Everything else (a "who
  // is the X" name lookup) still goes to getCaseParties, unchanged.
  const contactDetailRef = (partyFieldRef && CONTACT_DETAIL_RE.test(lastUserText)) ? partyFieldRef : null;
  const mixedCaseAndPartyRequest = isMixedCaseSearchAndPartyRequest(lastUserText);
  const mixedCaseRef = mixedCaseAndPartyRequest
    ? lastUserText.match(/\b(?:case\s+)?([A-Za-z]{1,4}\d{2,})\b/i)?.[1] ?? null
    : null;
  const partiesFollowUpRef = (contactDetailRef || mixedCaseAndPartyRequest) ? null : partyFieldRef;

  const mixedRequestDirective = mixedCaseAndPartyRequest
    ? `

‼️ THIS TURN — MIXED REQUEST: Complete BOTH operations in order. First call combinedSearch for the open/closed case search using applicantName "${defaultSearchText ?? ''}" and the requested status. Then call getCaseParties with caseNumber "${mixedCaseRef ?? ''}". Do not substitute getCaseFullDetail and do not repeat either tool.`
    : '';

  // true for "who is the insurance carrier" (ONE fact), false for "show me the
  // parties"/"list contacts" (everything) — see isNarrowPartyFieldQuestion's doc comment.
  const partiesFollowUpNarrow = partiesFollowUpRef !== null && isNarrowPartyFieldQuestion(lastUserText);

  const partiesFollowUpDirective = partiesFollowUpRef
    ? `

‼️ THIS TURN — The user is asking about a field (venue/attorney/applicant/insurance carrier/parties/etc.) of ONE specific case: ${partiesFollowUpRef}. Call getCaseParties with caseNumber "${partiesFollowUpRef}".${
        partiesFollowUpNarrow
          ? ' Answer with ONLY that one fact, in a single short sentence — no numbered list, no restating other party types, no closing filler line ("let me know if you need anything else").'
          : ' Then answer the specific field they asked, read from the parties result.'
      } Do NOT call a filter or search tool.`
    : '';

  // Phase-2 domain follow-up (tasks/events/documents/notes/activities/
  // accounting) with no case reference of its own — see anaphoricPhase2Tool's
  // doc comment. Only considered when nothing above already claimed this turn.
  const verificationContext = isVerificationFollowUp(lastUserText)
    ? lastPhase2ToolContext(messages)
    : null;
  const phase2FollowUpTool = (!bareName && !solNeedsYear && !partiesFollowUpRef)
    ? (verificationContext?.toolName
       ?? anaphoricPhase2Tool(lastUserText)
       ?? (anaphoricCaseDetailQuestion(lastUserText) ? 'getCaseFullDetail' : null))
    : null;
  // lastPhase2CaseRef only scans Phase-2 tool calls; fall back to the parties/
  // user-message history too, since a bare field follow-up ("who is the
  // paralegal?") most often comes right after a getCaseParties lookup, which
  // that function doesn't see (live bug, 2026-08-12).
  const phase2FollowUpRef = phase2FollowUpTool
    ? (verificationContext?.caseRef ?? lastPhase2CaseRef(messages) ?? lastCaseRefFromHistory(messages))
    : null;

  const phase2FollowUpDirective = (phase2FollowUpTool && phase2FollowUpRef)
    ? `

‼️ THIS TURN — The user is asking about ${phase2FollowUpTool} for the case they were just viewing: ${phase2FollowUpRef}. Call ${phase2FollowUpTool} with that case identifier (caseNumber or caseName, whichever fits "${phase2FollowUpRef}"). Set its answerScope to "single_fact" if this is one specific detail (e.g. "who uploaded it"), or "full_list" if it's a general request (e.g. "what documents are there").${verificationContext ? ' This is a verification request: re-run the tool and re-state the newly verified result. Do not reinterpret a successful result as "case not found".' : ''} Do NOT search for a new case or call any other tool.`
    : '';

  // "How many cases are in THAT venue?" — resolve the prior case's venueId and
  // search it, so the user gets the real count instead of being asked which venue.
  const venueOfCaseRef = (!bareName && !solNeedsYear && !partiesFollowUpRef && anaphoricVenueOfCaseQuestion(lastUserText))
    ? lastCaseRefFromHistory(messages)
    : null;
  const venueOfCaseId = venueOfCaseRef
    ? await resolveCaseVenueId(apiBaseUrl, jwtToken, venueOfCaseRef)
    : null;
  if (venueOfCaseId) allowedFilterKeys.add('venueId');

  const contactDetailDirective = contactDetailRef
    ? `

‼️ THIS TURN — The user is asking for a CONTACT DETAIL (email / address / phone) of a party on case ${contactDetailRef}. Call getCaseFullDetail with that case identifier and read the answer from the matching object's own contact fields (employer.address, insuranceCarrier.email, defendant.address, applicant phone/email, etc.). If that field is null/empty, say plainly that it is not recorded on the case — do NOT substitute the party's NAME or company as if it were the address or email, and do NOT call getCaseParties (its rows carry no contact fields at all).`
    : '';

  const venueOfCaseDirective = venueOfCaseId
    ? `

‼️ THIS TURN — The user wants the cases in the SAME VENUE as the case they were viewing (${venueOfCaseRef}). That case's venue is venueId ${venueOfCaseId}. Call combinedSearch with venueId: ${venueOfCaseId} (plus any open/closed status they mention). Do NOT ask which venue — use ${venueOfCaseId}.`
    : '';

  /**
   * A plural, list-shaped case search sitting alongside a single-case request:
   * "Show me open cases AND the parties for case AE00224".
   *
   * Live gap fixed 2026-08-19. The forced single-case branches below REPLACE
   * the tool menu with one tool — which is exactly what they are for, since
   * that is what stops the model reaching for a filter tool when the user
   * asked about one case. But a compound request loses its other half: only
   * getCaseParties ran, and the "open cases" list was silently dropped. The
   * answer was correct, just incomplete, which is the harder kind to notice.
   *
   * isMixedCaseSearchAndPartyRequest (lib/searchContext.ts) already covers the
   * narrow "cases FOR <name> and parties for <case>" shape; this catches the
   * general one — any status/filter-qualified plural "cases" clause. Rather
   * than adding a branch per phrasing, the forced tool is kept and the list
   * tools are ADDED beside it, so the model can complete both halves.
   */
  const LIST_SEARCH_CLAUSE_RE =
    /\b(?:all|open|closed|active|pending|sub[\s-]?out|recent)\s+cases\b|\bcases\s+(?:for|of|in|with|handled\s+by|assigned\s+to)\b/i;
  const compoundListRequest = LIST_SEARCH_CLAUSE_RE.test(lastUserText);

  /** Keep a forced single-case tool, but expose the list-search tools too. */
  // apiBaseUrl is only narrowed to string by the early return above, and that
  // narrowing does not reach inside a closure — capture it once.
  const resolvedApiBaseUrl: string = apiBaseUrl;

  function withListSearchTools(
    sel: ReturnType<typeof selectToolsForDomains>,
  ): ReturnType<typeof selectToolsForDomains> {
    if (!compoundListRequest) return sel;
    const reg = buildToolRegistry({
      apiBaseUrl: resolvedApiBaseUrl, jwtToken, appOrigin, queryText: lastUserText,
      enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const tools = { ...sel.tools };
    for (const name of ['searchCases', 'combinedSearch']) {
      const def = reg.get(name)?.definition;
      if (def) tools[name] = def;
    }
    // forcedCombined stays false — combinedSearch is offered, never forced, so
    // the model still picks the right list tool for the search half.
    return { ...sel, tools, activeTools: Object.keys(tools) };
  }

  const compoundRequestDirective = compoundListRequest
    ? `

‼️ THIS TURN — TWO REQUESTS IN ONE MESSAGE: the user asked for a LIST of cases AND for something about one specific case. Complete BOTH: call the single-case tool for the named case, and call searchCases/combinedSearch for the list. Do not answer only one half.`
    : '';

  // activeDomains was resolved earlier (folded into the Promise.all above via resolveDomains()).
  let selectedTools: ReturnType<typeof selectToolsForDomains>;
  if (bareName || solNeedsYear) {
    selectedTools = { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
  } else if (mixedCaseAndPartyRequest) {
    const reg = buildToolRegistry({
      apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const combinedDef = reg.get('combinedSearch')?.definition;
    const partiesDef = reg.get('getCaseParties')?.definition;
    const tools = {
      ...(combinedDef ? { combinedSearch: combinedDef } : {}),
      ...(partiesDef ? { getCaseParties: partiesDef } : {}),
    };
    selectedTools = {
      tools,
      activeTools: Object.keys(tools),
      forcedCombined: Boolean(combinedDef),
      requireTool: true,
    };
  } else if (contactDetailRef) {
    // Party contact detail (email/address/phone) — getCaseFullDetail only, since
    // getCaseParties structurally cannot answer it (see CONTACT_DETAIL_RE).
    const reg = buildToolRegistry({
      apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const def = reg.get('getCaseFullDetail')?.definition;
    selectedTools = withListSearchTools(def
      ? { tools: { getCaseFullDetail: def }, activeTools: ['getCaseFullDetail'], forcedCombined: false, requireTool: true }
      : { tools: {}, activeTools: [], forcedCombined: false, requireTool: false });
  } else if (comprehensiveCaseDetailQuestion(lastUserText)) {
    // Expose ONLY getCaseFullDetail — see comprehensiveCaseDetailQuestion's doc
    // comment for why getCaseParties must not be offered as an alternative here.
    const reg = buildToolRegistry({
      apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const def = reg.get('getCaseFullDetail')?.definition;
    selectedTools = withListSearchTools(def
      ? { tools: { getCaseFullDetail: def }, activeTools: ['getCaseFullDetail'], forcedCombined: false, requireTool: true }
      : { tools: {}, activeTools: [], forcedCombined: false, requireTool: false });
  } else if (partiesFollowUpRef) {
    // Expose ONLY getCaseParties so the model can't fall back to a filter tool.
    // Built directly (not via buildToolRegistry) so narrowField can be set
    // per-call from partiesFollowUpNarrow — see PartiesDeps' doc comment.
    const def = makeGetCasePartiesTool({ apiBaseUrl, jwtToken, narrowField: partiesFollowUpNarrow });
    selectedTools = withListSearchTools({ tools: { getCaseParties: def }, activeTools: ['getCaseParties'], forcedCombined: false, requireTool: true });
  } else if (phase2FollowUpTool && phase2FollowUpRef) {
    // Expose ONLY the one Phase-2 tool the follow-up is about, with the case
    // it's anaphoric to — see anaphoricPhase2Tool's doc comment.
    const reg = buildToolRegistry({
      apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const def = reg.get(phase2FollowUpTool)?.definition;
    selectedTools = withListSearchTools(def
      ? { tools: { [phase2FollowUpTool]: def }, activeTools: [phase2FollowUpTool], forcedCombined: false, requireTool: true }
      : { tools: {}, activeTools: [], forcedCombined: false, requireTool: false });
  } else if (venueOfCaseId) {
    // "cases in that venue" — force combinedSearch with the resolved venueId.
    const reg = buildToolRegistry({
      apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
      personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
    });
    const def = reg.get('combinedSearch')?.definition;
    selectedTools = def
      ? { tools: { combinedSearch: def }, activeTools: ['combinedSearch'], forcedCombined: true, requireTool: true }
      : { tools: {}, activeTools: [], forcedCombined: false, requireTool: false };
  } else {
    // withListSearchTools applies here too: a Phase-2 domain can claim the turn
    // exclusively (selectToolsForDomains defers casesDomain to it), which drops
    // the list half of "closed cases AND how many documents on case X".
    selectedTools = withListSearchTools(selectToolsForDomains(activeDomains, {
      message: classifyText,
      registry: buildToolRegistry({
        apiBaseUrl, jwtToken, appOrigin, queryText: lastUserText, enforcedSearchType, enforcedLabel,
        personSignal, personName, allowedFilterKeys, resolvedDateRange, resolvedRoleSlot,
      }),
      intents,
      selectorOpts: { explicitStatus: enforcedSearchType !== 1, hasPerson: personSignal !== 'none', hasResolvedDate: !!resolvedDateRange, forceContinuation: refining },
    }));
  }

  let result;
  const auditedTools = new Set<string>();
  const auditedCaseNumbers = new Set<string>();
  try {
    const systemPrompt = `You are a smart assistant for Aeliuscase, a law firm case management platform.
You help with two things only:
  A) Searching cases in the database → use the searchCases tool.
  B) Answering questions about AeliusCase features and usage → use the User Guide excerpts below.

${guideSection}

━━━ HOW TO RESPOND ━━━
• Case search (find/show/look up cases — NOT when the user is asking about parties, contacts, or documents for a case) → call searchCases immediately. Never skip this.
• PHASE-1 NAME DEFAULT — wording like "find cases for John Smith", "open cases for Maria", or "closed cases for Smith" means the applicant/client search keyword is that name. Search immediately; do NOT ask whether the person is staff. Explicit staff wording still uses the staff tools.
• CLIENT / APPLICANT NAMED EXPLICITLY — if the user says the person is a "client", "applicant", "claimant", or "injured worker" (e.g. "cases for client Martinez", "a client named Martinez", "applicant Serrato") → that is NOT ambiguous. Call searchCases({ searchText: "[Name]" }) directly (or combinedSearch with applicantName if other filters are present). Do NOT ask the staff-or-client question.
• STAFF NAMED EXPLICITLY — if a role word (attorney/paralegal/coordinator/…) or "handled by"/"assigned to" is present → call getByStaff({ name: "[Name]", jobRole? }) directly (or combinedSearch with staffName). Do NOT ask.
  EXCEPTION — if the name in the message is part of a CASE name ("[Name] vs [Company]", "[Name] v. [Company]") rather than a bare staff name, that is NOT a staff search — the person named is the case's applicant, not a staff member. Call getCaseParties with that full string as caseName (NOT caseNumber — a case name is not a case number) for a general "who are the parties" question, or getCaseFullDetail with that caseName for a specific field (attorney/paralegal/coordinator/venue/insurance carrier/injury).
• AMBIGUOUS BARE NAME — ONLY when the user gives a person's name WITHOUT normal case-search wording such as "cases for [name]", with NO client/applicant/claimant word AND NO role word AND NO "handled by"/"assigned to"/"staff member", AND it's not already established:
  → Do NOT call any tool yet. Reply with exactly: "Is [Name] a staff member (e.g. attorney, paralegal) or an applicant/client? I'll search the right way once you let me know."
  → On the user's clarification, if the request was JUST the name (no other filters): staff/attorney/paralegal/coordinator/"handled by" → call getByStaff({ name: "[Name]" }); applicant/client/claimant → call searchCases({ searchText: "[Name]" }).
  → On the user's clarification, if the request ALSO had other filters (type/venue/status/date/body part/etc.): call combinedSearch with those filters PLUS staffName: "[Name]" (if staff) or applicantName: "[Name]" (if applicant/client). Do NOT use getByStaff/searchCases in that case.
  → This applies ONLY to a bare PERSON name. A case number (e.g. RP003613), a company/employer name, a status word (open/closed), or any other keyword → search normally with searchCases; do NOT ask.
• When the user asks for multiple things in one message (e.g. "show open cases for Maria AND parties for EL00503"), call EACH relevant tool in sequence — do not skip any. Handle them one by one within the same response.
• "What is AeliusCase", "how do I…", "what does X do", feature questions → answer from the User Guide excerpts above. Be helpful and specific. If the exact detail isn't in the excerpts, say you don't have that specific information from the guide.
• Greetings → reply warmly in 1-2 sentences.
• Questions completely unrelated to AeliusCase (world events, cooking, etc.) → reply: "I can only help with AeliusCase case searches and User Guide questions."
• After a tool result → ONE short sentence only, and NEVER state a specific case count number yourself (e.g. "Found 12 cases" or "there are 8 cases") — the result card above already shows the exact, reliable total, and you do not reliably know the true count from the tool output text. Say something generic instead, e.g. "Here are Maria's open cases." or "Here's what I found for Raj Patel."
  EXCEPTION — if a "━━━ EXACT COUNT ━━━" block appears further below, the user explicitly asked HOW MANY and that block hands you the real, verified number: state THAT EXACT number and nothing else. Never use any other number, even if the tool output text shows a different-looking one.
  NEVER list case numbers, names, employers, or any case details in text — the UI renders them automatically.
  Do NOT repeat or describe what is already shown in the result cards.
• If the user repeats a search (same or similar request), ALWAYS call the tool again — never say "I already showed that" or "you already asked that."
• Zero results → one sentence: suggest a broader or alternative search term.
• If the user asks about parties, contacts, or documents (e.g. "show me the parties", "who are the parties", "list parties", "show contacts") WITHOUT providing a case number (like RP00001), a case NAME ("X vs Y"), or a numeric case ID → do NOT call any tool. Reply with exactly: "Which case would you like to see parties for? Please provide a case number (e.g. RP00001), case name, or case ID."
• Party/contact/document requests WITH a specific case number, case name, or case ID present → call getCaseParties immediately, using whichever the user actually gave: caseNumber for a number like RP00001, caseName for a "X vs Y" name — NEVER put a case name string into the caseNumber field.
  Examples: "show parties for RP00001", "who is on case 12345", "get contacts for RP00056", "what are the parties in the Smith vs Acme case".
  The parties result also contains the case's VENUE, INSURANCE CARRIER, DEFENDANT and EMPLOYER — so "who is the insurance carrier for RP2476", "what's the venue on RP00001", "who is the defendant on [case]" all → call getCaseParties for that case, then read the answer from the parties list. These are NOT off-topic and are NOT a combinedSearch — never call combinedSearch for a single-case party question.
  ‼️ The parties result does NOT contain the case's APPLICANT, ATTORNEY, PARALEGAL or COORDINATOR. There is no "Applicant" or "Coordinator" row in it, and its "Attorney" row is a PARTY's own attorney, not the case's assigned attorney. For those four, call getCaseFullDetail instead — it maps them explicitly. NEVER answer "who is the applicant / attorney / paralegal / coordinator" from the parties list by picking the nearest-looking row (e.g. reading "Plaintiff" as the applicant, or "Applicant Attorney" as the case attorney) — that produces a confidently wrong name.
  ‼️ ATTORNEY ROLES ARE TWO DIFFERENT THINGS, and getCaseFullDetail carries both — read the RIGHT field:
   - A BARE "the attorney on case X" = the firm's own assigned attorney → the top-level attorney field.
   - A QUALIFIED role — "DEFENSE attorney", "APPLICANT attorney", "PRIOR attorney", "REFERRED OUT attorney", "UEF attorney" — is a PARTY on the case → find the entry in the contacts list whose partyType matches that exact role.
   Each contacts entry has partyType, company (the firm), contactName (the person at that firm), phone and email. Give BOTH when present: "the defense attorney is [contactName] at [company]". Never answer a qualified role from the top-level attorney field — that is the firm's own attorney, and naming it as the defense attorney is a confidently wrong answer. If no contacts entry matches the role asked about, say so plainly.
  If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean; do not guess.
  REQUIRED: a case number (e.g. RP00001), case name, or numeric case ID MUST appear in the user's message. If absent → ask first, never call the tool.

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
  1=WCAB (a.k.a. "Workers Comp" / "Workers Compensation"), 2=DUI, 3=Personal Injury (a.k.a. "PI"), 4=WCAB Defense, 5=Class Action, 6=Civil, 7=Employment, 8=Immigration, 9=Social Security.
  ‼️ A case-TYPE name is a FILTER, never free text. "personal injury cases", "WCAB cases", "DUI cases", "immigration cases", etc. → ALWAYS getByCaseTypeId with the mapped ID (or combinedSearch if combined with other filters). NEVER call searchCases with the type name as searchText (that text-searches applicant names and returns nothing).
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
  - A name in normal case-search wording ("cases for [name]") defaults to APPLICANT/CLIENT and is passed as applicantName. A truly bare name with no case-search wording remains ambiguous and follows the clarification rule above.
• A SINGLE filter criterion PLUS a person's name (e.g. "WCAB cases for John Smith", "venue 5 cases handled by Maria") IS a combined search → call combinedSearch with that filter + the name (routed per the rule above).
• A SINGLE filter criterion with NO status word and NO person name → use that filter's individual tool (not combinedSearch).
• A single filter criterion TOGETHER WITH an open/closed/sub-out status (e.g. "Open WCAB cases", "closed cases in venue 5") → call combinedSearch with that filter + status (the single filter tools cannot filter status).
• If combinedSearch reports multiple staff matches, relay the question — ask which person.

━━━ LINKING TO A CASE ━━━
• The ONLY valid link to a case is getCaseFullDetail's data.caseUrl. When the user asks for a link to the case, use exactly that value: [case number](caseUrl).
• If caseUrl is null/absent, say you don't have a link to the case — do NOT build one from a case number, and do NOT hand back a DOCUMENT DOWNLOAD url (…/api/documents/download?docId=…) as if it were the case link. A document link points at one file, not at the case.
• NEVER write a field NAME as the link target. "[AE-00224](caseUrl)" is a broken link — the target must be the real URL value from the tool result, starting with http. If you don't have that value, call getCaseFullDetail to get it, or say you have no link.
• Document links remain document links: use a document's own fileUrl when the user asked for that document, and label it with the DOCUMENT's name — [Verification form](fileUrl), never [AE-00224](fileUrl). Labelling a document link with the case number makes it look like it opens the case.

━━━ PHASE-2 SECTIONS — SEARCHING FOR ONE SPECIFIC RECORD ━━━
The tasks/events/documents/notes/activities arrays return only the NEWEST 25 rows by default, out of a section that can hold hundreds. A record older than that is simply absent from what you can see.
• Whenever the user names a specific record — "the Verification form", "the last letter", "notes about mediation", "the settlement document" — you MUST pass searchKeyword with that term. The tool then searches the ENTIRE section instead of the newest 25.
• If the result has searchMatched: false, the term matched NOTHING anywhere in that section. Say so plainly ("there is no document named 'X' on this case"). NEVER answer from a different row that merely looks similar, and never name a person/date from an unrelated record — that produces a confidently wrong answer about real case data.
• When searchedFor is present, <section>Total is the number of MATCHES, not the section size — sectionSize holds the real total. Say "1 of 90 documents matches" rather than reporting the match count as the section total.
• Do NOT set searchKeyword for "how many..." or "show me all..." questions — those need the whole section.

━━━ PHASE-2 SINGLE-CASE TOOLS — success:false MEANS THE CASE ITSELF WASN'T FOUND ━━━
getCaseFullDetail/getCaseTasks/getCaseEvents/getCaseDocuments/getCaseNotes/getCaseActivities/getCaseAccounting all share one failure shape: success: false with an error message (e.g. "Case \"RP003668\" not found") when the case number/ID/name didn't match ANY case. This is DIFFERENT from a successful call that simply found zero rows (e.g. documents: [] on a real case) — never blur the two together.
• success: false (and NOT ambiguous: true) → the CASE ITSELF was not found. Relay that plainly ("I couldn't find a case matching \"RP003668\" — please double-check the case number") using the error message. NEVER phrase this as "no documents/tasks/notes/etc. on file" — that wording implies the case exists and is simply empty, which is a different (and false) claim when the case wasn't found at all.
• success: true with an empty array (e.g. documents: []) → the case DOES exist and genuinely has none of that record type — say so plainly ("no documents on file for this case"), do not invent one.

━━━ CASE FULL DETAIL (venue, injury/body parts, SOL, DOI, ADJ#, demographics) ━━━
• If the user asks for venue, injury/body-part details, statute of limitations (SOL), date of injury (DOI), ADJ number, JetFile/EAMS submission ("when was case X submitted to JetFile"), the case's APPLICANT / ATTORNEY / PARALEGAL / COORDINATOR, or general demographics for ONE specific case (by case number, case ID, or case name) → call getCaseFullDetail.
  ‼️ "Submitted to JetFile" is NOT a document upload — do NOT call getCaseDocuments for it. getCaseFullDetail carries the JetFile/EAMS submission data.
• If the result has ambiguous: true, the case NAME matched more than one case — list the candidate case numbers/names from candidates and ask the user which one they mean. Do NOT guess or pick one yourself.
• Treat "not set" / null values in the result as genuinely missing information — say so plainly, do not invent a value.
• For JetFile/EAMS submission questions, use data.jetFileSubmissionDate. A null case-level jetFileId does NOT prove the case was never submitted when submission history has a successful date.
• For body-part ADJ questions, use requestedInjuryAdjNumbers when present. An empty array means that requested body part is not recorded in the returned injuries; say so instead of assigning another injury's ADJ.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.
• If the user asks for "everything" / "full detail" / "the full case card" (a comprehensive request, not a narrow single-field question) — the getCaseFullDetail result already carries tasks, events, documents, notes, activities, and accounting alongside the case/parties/injury fields. Your summary MUST touch every one of those sections, even if only with a one-line "no documents on file" / "34 documents on file" — never silently drop a section just because it wasn't the main focus of the question. Follow the CASE ACTIVITIES rule below for how to phrase activities vs. current-state without contradicting yourself.

━━━ CASE TASKS (due, overdue, assigned, category, status) ━━━
• If the user asks what tasks/to-dos are due, overdue, or assigned on ONE specific case → call getCaseTasks.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• An empty tasks list means the case genuinely has no open tasks — say so plainly, do not invent one.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.

━━━ CASE EVENTS (hearings, calendar) ━━━
• If the user asks about hearings, events, or calendar entries on ONE specific case (e.g. "when's the next hearing on RP003583") → call getCaseEvents.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• The result includes both past AND future events — pick the one relevant to "next"/"upcoming" (future) or "last"/"most recent" (past) by comparing to today's date.
• An empty events list means the case genuinely has no events on file — say so plainly, do not invent one.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.

━━━ CASE DOCUMENTS (uploaded files) ━━━
• If the user asks whether a document has been uploaded, who uploaded it, or wants to list documents on ONE specific case → call getCaseDocuments.
• If the request is instead about PARTY-level documents (documents attached to a specific party/contact) → prefer getCaseParties instead, which already returns party-linked documents.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• "Has X been uploaded?" / "show settlement-related documents" — match by keyword against name/category yourself; there is no server-side search param.
• An empty documents list means the case genuinely has no documents on file — say so plainly, do not invent one.
• When you name a SPECIFIC document the user asked for (not a broad list), format it as a clickable markdown link using its real fileUrl: [document name](fileUrl) — never just state the name as plain text when fileUrl is present, and never invent a URL.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.

━━━ CASE NOTES ━━━
• If the user asks for notes on ONE specific case (e.g. "give me all settlement notes on RP003583", "what notes mention Matrix") → call getCaseNotes.
• "Settlement notes" / "what notes mention X" — match by keyword against subject/text/category yourself; there is no server-side search param.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• An empty notes list means the case genuinely has no notes on file — say so plainly, do not invent one.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.

━━━ CASE ACTIVITIES (audit/history) ━━━
• If the user asks for the activity/audit history on ONE specific case (e.g. "5 most recent activities on RP003583", "when was the demographics sent on this case") → call getCaseActivities.
• The result is sorted most-recent-first — "5 most recent" is a client-side take of the first 5, no server-side param needed.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• An empty activities list means the case genuinely has no activity history on file — say so plainly, do not invent one.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.
• CRITICAL — activities are HISTORY, not CURRENT STATE: an entry like "Task X was created" or "Event Y was inserted" only means that action happened at some point in the past (the task/event may since have been deleted). NEVER use an activities entry to claim a task/event/document/note currently exists, and NEVER treat an empty tasks/events/documents/notes list as contradicting a historical activity entry — they answer different questions (what happened vs. what exists now). When both are shown together (e.g. "show me everything on this case"), report each separately using its own plain language ("history shows X was created on [date]" vs "there are currently no open tasks") and never state them as if one disproves the other.

━━━ CASE ACCOUNTING (financial — cheque requests, payments, settlement fees) ━━━
• If the user asks about cheque requests, payments, client costs, settlement fees, or balances on ONE specific case → call getCaseAccounting.
• If the result has ambiguous: true, list the candidates and ask the user which case they mean — same as getCaseFullDetail.
• All amounts returned are exactly as stored — never estimate, round, or invent a figure yourself.
• If currentBalanceAvailable is false, the backend did not provide a case-wide current balance. State that plainly. NEVER use one settlement fee row's remainingBalance as the case-wide balance.
• Empty accounting arrays mean the case genuinely has no financial records of that type on file — say so plainly, do not invent one.
• This is a single-case lookup, not a list search — never call combinedSearch or searchCases for these questions.

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
- 1 = All Cases  2 = Open only  3 = Closed only  4 = Sub-Out only (status "Sub-d Out" — NOT "Sub-d In")${bareNameDirective}${solYearDirective}${carriedFiltersSection}${mixedRequestDirective}${partiesFollowUpDirective}${contactDetailDirective}${phase2FollowUpDirective}${venueOfCaseDirective}${compoundRequestDirective}`;

    result = streamText({
    model: openai.chat('gpt-4o-mini'), // explicit Chat Completions API — see doc comment at top import for why
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(5),
    tools: selectedTools.tools,
    activeTools: selectedTools.activeTools,
    onStepFinish: ({ toolCalls, toolResults }) => {
      for (const call of toolCalls) auditedTools.add(call.toolName);
      for (const toolResult of toolResults) {
        for (const caseNumber of collectCaseNumbers(toolResult.output)) {
          auditedCaseNumbers.add(caseNumber);
        }
      }
    },
    onFinish: () => {
      if (auditedTools.size === 0) return;
      recordAudit({
        userId: auth.userId,
        query: lastUserText,
        accessedCaseNumbers: [...auditedCaseNumbers],
        toolCalled: [...auditedTools].join(','),
        ip: auth.ip,
      });
    },
    // A concrete filter intent fired (forced-combined or merely offered) —
    // gpt-4o-mini sometimes narrates ("I'll search for...") instead of calling
    // the tool, so require a call on the first step only (forcing every step
    // would block the model from ever replying with the final summary text
    // after the tool result comes back). When combinedSearch was specifically
    // FORCED, require that exact tool; otherwise require any of the offered
    // tools (lets the model still choose between the single-filter tool and
    // combinedSearch, e.g. when it detects a person's name).
    prepareStep: ({ stepNumber, steps }: {
      stepNumber: number;
      steps: Array<{
        toolCalls?: Array<{ toolName: string; input: unknown }>;
        toolResults?: Array<{ output?: unknown }>;
      }>;
    }) => {
      if (stepNumber === 0) {
        // Pinning step 0 to ONE tool is what stops the model wandering off to a
        // filter tool for a single-case question — but in a compound request it
        // also pins the whole turn to one half. Live 2026-08-19: "show me all
        // WCAB cases and what is the venue on case AE00224" answered the venue,
        // said "now let me show you all the WCAB cases", and never called the
        // search. Leave the choice open when both halves are present; the menu
        // and the compound directive already steer it.
        const forcedToolName = compoundListRequest
          ? null
          : partiesFollowUpRef
            ? 'getCaseParties'
            : selectedTools.forcedCombined ? 'combinedSearch' : null;
        if (forcedToolName) return { toolChoice: { type: 'tool' as const, toolName: forcedToolName } };
        if (selectedTools.requireTool) return { toolChoice: 'required' as const };
        return {};
      }

      // Stuck-loop guard: gpt-4o-mini can keep calling the SAME tool with
      // IDENTICAL input instead of ever answering — live-verified 2026-07-19
      // (QA round 3, real end-to-end testing) with a multi-part question that
      // offered several case-scoped Phase-2 tools at once (tasks + documents +
      // notes + caseDetail, all correctly exposed): the model fixated on
      // getCaseParties, called it repeatedly (15 times across steps/parallel
      // calls), and exhausted stopWhen: stepCountIs(5) with a completely BLANK
      // final reply (finishReason "tool-calls", never "stop") — the worst
      // possible outcome for the user. This is a generic step-loop safeguard
      // (not scoped to any one tool or domain): if the current step repeats a
      // toolName+input pair already seen (either duplicated within one step's
      // parallel calls, or identical to the immediately preceding step), force
      // toolChoice: 'none' so the model MUST answer in text using whatever
      // results it already has, instead of looping again.
      const callSignatures = (calls?: Array<{ toolName: string; input: unknown }>) =>
        (calls ?? []).map((tc) => `${tc.toolName}:${JSON.stringify(tc.input)}`);
      const currentCalls = callSignatures(steps[steps.length - 1]?.toolCalls);
      const priorCalls = steps.length >= 2 ? callSignatures(steps[steps.length - 2]?.toolCalls) : [];
      const isStuckLoop = currentCalls.length > 0 && (
        new Set(currentCalls).size < currentCalls.length
        || currentCalls.every((sig) => priorCalls.includes(sig))
      );
      if (isStuckLoop) {
        return {
          toolChoice: 'none' as const,
          system: `${systemPrompt}\n\n━━━ STOP — ANSWER NOW ━━━\nYou just called the same tool with the same input again instead of answering. Do NOT call any more tools. Using ONLY the results you already have from earlier tool calls in this turn, answer the user's question as completely as you can right now — if part of it is missing, say so instead of repeating a tool call.`,
        };
      }

      const lastStep = steps[steps.length - 1];
      const lastToolResult = lastStep?.toolResults?.[lastStep.toolResults.length - 1];
      const lastOutput = lastToolResult?.output as
        { success?: boolean; totalRecords?: number; filterLabel?: string; cases?: unknown[] } | undefined;

      // The 6 single-section Phase-2 tools (getCaseDocuments/Tasks/Events/
      // Notes/Activities/Accounting) return a FLAT array at the top level
      // ({success, caseNumber, caseName, documents: [...]}) — no totalRecords
      // and not the nested `data` shape either, so neither of the two
      // count-injection branches below used to cover them. Live-reproduced
      // 2026-07-28 on case AE-00224 (68 real documents, all 68 correctly
      // returned by the tool): gpt-4o-mini answered "50", "64", "65" across
      // runs of the same question — it eyeballs a long array instead of
      // counting it. Computed here, ABOVE the countQuestion branch, because
      // that branch returns early and would otherwise swallow this case.
      const sectionOutput = lastToolResult?.output as (
        Record<string, unknown> & { success?: boolean }
      ) | undefined;

      if (sectionOutput?.success && sectionOutput.currentBalanceAvailable === false) {
        return {
          system: `${systemPrompt}\n\n━━━ CURRENT BALANCE — UNAVAILABLE ━━━\nThe backend result does NOT contain a case-wide current balance. Do not calculate one and do not copy any individual settlement-fee remainingBalance. Reply plainly that the current case balance is not available from the returned accounting data.`,
        };
      }
      const SECTION_KEYS = ['documents', 'tasks', 'events', 'notes', 'activities'] as const;
      const sectionKey = sectionOutput?.success
        ? SECTION_KEYS.find((k) => Array.isArray(sectionOutput[k]))
        : undefined;
      // Prefer the tool's own `<section>Total` — the array itself is capped at
      // SECTION_SAMPLE_CAP rows (see lib/tools/impl/caseDetail.ts), so its
      // length is a sample size, not the real count.
      const sectionTotal = sectionKey ? sectionOutput![`${sectionKey}Total`] : undefined;
      const sectionCount = sectionKey
        ? (typeof sectionTotal === 'number' ? sectionTotal : (sectionOutput![sectionKey] as unknown[]).length)
        : null;
      // When the tool ran a keyword search, <section>Total counts MATCHES, not
      // the section — say so explicitly, otherwise the model reports "1
      // document on this case" for a case with 90 (see searchKeyword in
      // lib/tools/impl/caseDetail.ts).
      const searchedFor = sectionOutput?.searchedFor;
      const sectionSize = sectionOutput?.sectionSize;
      const sectionCountDirective = (sectionKey && sectionCount !== null)
        ? (typeof searchedFor === 'string'
          ? `${systemPrompt}\n\n━━━ ${sectionKey.toUpperCase()} SEARCH RESULT ━━━\nThis result is a SEARCH of the whole ${sectionKey} section for "${searchedFor}" — not the section itself. It matched EXACTLY ${sectionCount} row(s)${typeof sectionSize === 'number' ? ` out of ${sectionSize} ${sectionKey} on the case` : ''}.${sectionCount === 0 ? ` Nothing matched, so tell the user plainly that no ${sectionKey.replace(/s$/, '')} matching "${searchedFor}" exists on this case. Do NOT answer from a different row, and do NOT name a person or date taken from an unrelated record.` : ` Answer ONLY from these ${sectionCount} matching row(s).`} Never present ${sectionCount} as the total number of ${sectionKey} on the case.`
          : `${systemPrompt}\n\n━━━ EXACT ${sectionKey.toUpperCase()} COUNT ━━━\nThe tool result you JUST received contains EXACTLY ${sectionCount} ${sectionKey}. If the user asked how many, state ${sectionCount} and no other number. Never estimate, round, or re-count the list yourself — ${sectionCount} is the verified total, even if you only itemize some of them in your reply.`)
        : null;

      // After the tool ran: for an explicit "how many" question, hand the model
      // the REAL totalRecords so it states that exact number instead of guessing
      // — live-verified 2026-07-16 to otherwise hallucinate (617 → "8") or omit
      // it entirely for the identical query. The model never computes this
      // number itself; it only ever copies the one injected here.
      if (countQuestion) {
        if (lastOutput?.success && typeof lastOutput.totalRecords === 'number') {
          return {
            system: `${systemPrompt}\n\n━━━ EXACT COUNT ━━━\nThe user explicitly asked HOW MANY. The verified real total is exactly ${lastOutput.totalRecords}${lastOutput.filterLabel ? ` (${lastOutput.filterLabel})` : ''}. State this EXACT number in your one-sentence reply. Never use any other number, even if other text in the tool output suggests a different one.`,
          };
        }
        if (sectionCountDirective) return { system: sectionCountDirective };
        return {};
      }

      // For a LISTING result (searchCases/combinedSearch/getBy*/etc. — anything
      // that returned a `cases` array, i.e. NOT getCaseParties, which legitimately
      // needs to state specific facts about the one case it looked up) with at
      // least one row: the base instruction to keep the reply to one generic
      // sentence with no case details is stated once, far above this point in a
      // long system prompt — live-verified 2026-07-16 across ~100 queries to be
      // followed only ~75% of the time (attention dilution on a small model), the
      // model otherwise re-lists the case numbers/names/dates the UI card already
      // shows. Re-stating the exact rule right here, with a copy-paste template,
      // right before the step that needs it, is what actually made the analogous
      // count-question fix reliable — do the same thing here.
      if (lastOutput?.success && Array.isArray(lastOutput.cases) && lastOutput.cases.length > 0) {
        return {
          system: `${systemPrompt}\n\n━━━ FINAL REPLY — MANDATORY FORMAT ━━━\nYou just retrieved a LIST of ${lastOutput.totalRecords ?? 'multiple'} case(s)${lastOutput.filterLabel ? ` (${lastOutput.filterLabel})` : ''}. The result card shown above your reply ALREADY displays every case number, name, employer, date, and status — do not repeat ANY of that. Your entire reply must be exactly ONE short generic sentence and nothing else, e.g. "Here are the ${lastOutput.filterLabel ?? 'matching'} cases." No list, no bullets, no numbers, no case details of any kind.`,
        };
      }

      // For a getCaseFullDetail result (tasks/events/documents/notes/activities/
      // accounting nested together): gpt-4o-mini has been observed (live,
      // 2026-07-27, case RP003668 — 34 real documents, 128 real activities) to
      // hallucinate "no documents uploaded" and to silently drop the activities
      // section entirely from a "show me everything" summary, despite the real
      // counts being present in the tool output it already has. Same fix
      // pattern as EXACT COUNT / FINAL REPLY above: compute the real counts
      // server-side and hand them back as a verified fact the model must
      // match, instead of trusting it to tally a large nested object itself.
      const fullDetailOutput = lastToolResult?.output as {
        success?: boolean;
        requestedInjuryAdjNumbers?: Record<string, string[]>;
        sectionTotals?: { tasks?: number; events?: number; documents?: number; notes?: number; activities?: number };
        data?: {
          tasks?: unknown[]; events?: unknown[]; documents?: unknown[];
          notes?: unknown[]; activities?: unknown[];
          accounting?: { chequeRequests?: unknown[]; payments?: unknown[]; clientCostsPaid?: unknown[]; settlementFees?: unknown[] };
        };
      } | undefined;
      if (fullDetailOutput?.success && fullDetailOutput.requestedInjuryAdjNumbers) {
        const matches = Object.entries(fullDetailOutput.requestedInjuryAdjNumbers)
          .map(([part, adjs]) => `${part}=${adjs.length > 0 ? adjs.join(', ') : 'NOT RECORDED'}`)
          .join('; ');
        return {
          system: `${systemPrompt}\n\n━━━ REQUESTED BODY-PART ADJ MATCHES ━━━\nThe exact backend matches for the body parts the user named are: ${matches}. State only these mappings. If a part says NOT RECORDED, say no matching injury/body-part record was returned; never assign an ADJ from a different body part.`,
        };
      }
      if (fullDetailOutput?.success && fullDetailOutput.data
        && (Array.isArray(fullDetailOutput.data.tasks) || Array.isArray(fullDetailOutput.data.activities))) {
        const d = fullDetailOutput.data;
        const acc = d.accounting;
        const accountingCount = (acc?.chequeRequests?.length ?? 0) + (acc?.payments?.length ?? 0)
          + (acc?.clientCostsPaid?.length ?? 0) + (acc?.settlementFees?.length ?? 0);
        // sectionTotals carries the REAL counts; data's arrays are capped
        // samples (SECTION_SAMPLE_CAP), so never count them directly.
        const t = fullDetailOutput.sectionTotals;
        const n = (key: 'tasks' | 'events' | 'documents' | 'notes' | 'activities') =>
          t?.[key] ?? (d[key]?.length ?? 0);
        return {
          system: `${systemPrompt}\n\n━━━ CASE DETAIL — VERIFIED SECTION COUNTS ━━━\nThe real, verified counts from the tool result you JUST received, this turn, are: tasks=${n('tasks')}, events=${n('events')}, documents=${n('documents')}, notes=${n('notes')}, activities=${n('activities')}, accounting records=${accountingCount}. Note the arrays in the tool result are only the first ${SECTION_SAMPLE_CAP} rows of each section — these counts are the true totals, so never re-count the rows yourself. These numbers OVERRIDE anything you or an earlier reply said about this same case earlier in this conversation — a prior turn's answer may have been wrong or about stale data, so ignore it and use ONLY the numbers above. If the user asked for a comprehensive/"everything" summary, your reply MUST mention every one of these six sections and MUST match these exact counts — state "no X on file" ONLY when its count above is 0, and when a count above is greater than 0 you MUST explicitly say records exist and state that real number (e.g. "there are ${d.documents?.length ?? 0} documents on file"). Never say "no documents"/"no activities"/etc. for a section whose count above is non-zero, even if you cannot see every individual row, and even if you said otherwise a moment ago.`,
        };
      }

      // Same verified count for the non-"how many" phrasings too ("list the
      // documents on X"), so a partial itemization can't imply a wrong total.
      if (sectionCountDirective) return { system: sectionCountDirective };
      return {};
    },
  });
  } catch (err) {
    console.error('[/api/chat] streamText threw:', err);
    return Response.json({ error: 'Chat failed', detail: String(err) }, { status: 500 });
  }

  return result.toUIMessageStreamResponse();
}
