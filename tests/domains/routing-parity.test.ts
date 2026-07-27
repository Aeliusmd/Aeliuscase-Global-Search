import { describe, it, expect } from 'vitest';
import { classifyIntents } from '@/lib/tools/intentRouter';
import { selectToolsForIntents } from '@/lib/tools/selector';
import type { ToolEntry } from '@/lib/tools/registry';
import { detectDomains, selectToolsForDomains } from '@/lib/domains';

// Stub registry — routing only reads tool NAMES + flags, never executes a tool,
// so we avoid dragging in the real registry's network/impl chain and keep this a
// pure unit test of the intent→domain→tool selection logic.
const TOOL_NAMES = [
  'searchCases', 'getCaseParties', 'getByStatusId', 'getBySubTypeId', 'getBySubStatusId',
  'getBySubStatusId2', 'getByVenueId', 'getBySpecialInstruction', 'getBySolDate',
  'getByBodyPartIds', 'getByCaseDate', 'getByCaseTypeId', 'getByLastNameInitial',
  'getByStaff', 'combinedSearch',
];
function stubRegistry(): Map<string, ToolEntry> {
  return new Map(
    TOOL_NAMES.map((n) => [n, { definition: { name: n } as unknown as ToolEntry['definition'], intentTags: [] }]),
  );
}

/**
 * Phase-A ("wrap") verification — acting as a client + QA.
 *
 * The contract of the domain-routing refactor is that behaviour is byte-for-byte
 * identical: the Cases domain is the fallback, so every message still resolves to
 * exactly the tools the old `selectToolsForIntents` path chose. These tests feed
 * 70+ varied natural-language questions through BOTH paths and assert:
 *   1. PARITY   — new domain path === old path (same tools, same flags).
 *   2. FALLBACK — detectDomains never returns empty (always includes Cases).
 *   3. SPOT QA  — a curated subset lands on the tools a client would expect.
 */

// Deterministic opts derived from the text — fed IDENTICALLY to both paths, so
// parity holds regardless of the heuristic; it only needs to be consistent.
function deriveOpts(q: string) {
  return {
    explicitStatus: /\b(open|closed|sub[-\s]?out)\b/i.test(q),
    hasPerson: /\b(attorney|paralegal|coordinator|handled\s+by|assigned\s+to|staff|secretary)\b/i.test(q),
    hasResolvedDate: false,
  };
}

interface Q {
  q: string;
  cat: string;
  mustInclude?: string[];
  mustExclude?: string[];
  expectForced?: boolean;
  exactTools?: string[];
}

const QUESTIONS: Q[] = [
  // ── Greetings ─────────────────────────────────────────────
  { q: 'hi there', cat: 'greeting' },
  { q: 'good morning', cat: 'greeting' },
  { q: 'hello, how are you?', cat: 'greeting' },
  // ── Off-topic ─────────────────────────────────────────────
  { q: "what's the weather today", cat: 'offtopic' },
  { q: 'who won the cricket match', cat: 'offtopic' },
  { q: 'tell me a joke', cat: 'offtopic' },
  // ── Feature / guide questions ─────────────────────────────
  { q: 'what is AeliusCase', cat: 'feature' },
  { q: 'how do I create a new case', cat: 'feature' },
  { q: 'what does the sub-out status mean', cat: 'feature' },
  // ── Plain case search ─────────────────────────────────────
  { q: 'find cases for Maria', cat: 'search', mustInclude: ['searchCases'] },
  { q: 'show me all cases', cat: 'search', mustInclude: ['searchCases'] },
  { q: 'look up case RP003613', cat: 'search', mustInclude: ['searchCases'] },
  { q: 'search AE0099', cat: 'search', mustInclude: ['searchCases'] },
  { q: 'pull up cases for client Martinez', cat: 'search', mustInclude: ['searchCases'] },
  // ── Status ────────────────────────────────────────────────
  { q: 'status id 5', cat: 'status', mustInclude: ['getByStatusId', 'combinedSearch'], expectForced: false },
  { q: 'caseStatusId 2 cases', cat: 'status', mustInclude: ['getByStatusId'] },
  { q: 'show me open cases', cat: 'status' },
  { q: 'closed cases please', cat: 'status' },
  // ── Venue ─────────────────────────────────────────────────
  { q: 'venue id 3', cat: 'venue', mustInclude: ['getByVenueId', 'combinedSearch'], expectForced: false },
  { q: 'cases in venue 5', cat: 'venue', mustInclude: ['getByVenueId'] },
  { q: 'venue 12 cases', cat: 'venue', mustInclude: ['getByVenueId'] },
  // ── Body parts ────────────────────────────────────────────
  { q: 'head injury cases', cat: 'bodypart', mustInclude: ['getByBodyPartIds', 'combinedSearch'], expectForced: false },
  { q: 'cases with a knee injury', cat: 'bodypart', mustInclude: ['getByBodyPartIds'] },
  { q: 'body part id 5', cat: 'bodypart', mustInclude: ['getByBodyPartIds'] },
  { q: 'show me back injuries', cat: 'bodypart', mustInclude: ['getByBodyPartIds'] },
  { q: 'workers with shoulder injuries', cat: 'bodypart', mustInclude: ['getByBodyPartIds'] },
  { q: 'body parts 1,2,3', cat: 'bodypart', mustInclude: ['getByBodyPartIds'] },
  // ── SOL / expiry ──────────────────────────────────────────
  { q: 'cases with SOL in 2027', cat: 'sol', mustInclude: ['getBySolDate'] },
  { q: 'statute of limitations expiring cases', cat: 'sol', mustInclude: ['getBySolDate'] },
  { q: 'which cases expire next year', cat: 'sol' },
  { q: 'SOL from 2027-01-01 to 2027-12-31', cat: 'sol', mustInclude: ['getBySolDate'] },
  // ── Case date ─────────────────────────────────────────────
  { q: 'cases opened in 2024', cat: 'casedate', mustInclude: ['getByCaseDate'] },
  { q: 'cases created between Jan and March', cat: 'casedate' },
  { q: 'cases filed last month', cat: 'casedate' },
  { q: 'show me cases from 2023', cat: 'casedate' },
  { q: 'cases opened in the last 3 months', cat: 'casedate' },
  // ── Case type ─────────────────────────────────────────────
  { q: 'personal injury cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  { q: 'WCAB cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  { q: 'workers comp cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  { q: 'show me PI cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  { q: 'immigration cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  { q: 'type id 7 cases', cat: 'casetype', mustInclude: ['getByCaseTypeId'] },
  // ── Sub-type / sub-status ─────────────────────────────────
  // "sub-type id 4" also matches filter_case_type ("type id" substring) and
  // "sub-status id" also matches filter_status ("status id" substring), so these
  // are 2-filter → force-combined (combinedSearch carries the exact sub-*Id).
  { q: 'sub-type id 4', cat: 'subtype', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'caseSubTypeId 17 cases', cat: 'subtype', mustInclude: ['getBySubTypeId'] },
  { q: 'sub-status id 3', cat: 'substatus', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'sub-status 2 id 9', cat: 'substatus2', mustInclude: ['combinedSearch'], expectForced: true },
  // ── Special instruction ───────────────────────────────────
  { q: 'rush cases', cat: 'special', mustInclude: ['getBySpecialInstruction'] },
  { q: 'cases on hold', cat: 'special', mustInclude: ['getBySpecialInstruction'] },
  { q: 'special instruction urgent', cat: 'special', mustInclude: ['getBySpecialInstruction'] },
  // ── Last name ─────────────────────────────────────────────
  { q: 'last name starts with D', cat: 'lastname', mustInclude: ['getByLastNameInitial'] },
  { q: 'last name initial M', cat: 'lastname', mustInclude: ['getByLastNameInitial'] },
  // ── Staff / role ──────────────────────────────────────────
  // A staff filter + a person signal (hasPerson) force-combines: combinedSearch
  // resolves the name → staffId and applies the role slot. getByStaff (the single
  // tool) is intentionally dropped in that case.
  { q: 'cases handled by Raj', cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  { q: "Raj's cases as paralegal", cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'cases assigned to attorney Rita', cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'who is the coordinator handling these', cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'cases where Raj is the supervisor attorney', cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'legal secretary Dolores cases', cat: 'staff', mustInclude: ['combinedSearch'], expectForced: true },
  // ── Parties / single-case field ───────────────────────────
  { q: 'show me the parties for RP2476', cat: 'parties', mustInclude: ['getCaseParties'] },
  { q: 'who are the parties on case 12345', cat: 'parties', mustInclude: ['getCaseParties'] },
  { q: 'list contacts for RP00056', cat: 'parties', mustInclude: ['getCaseParties'] },
  { q: 'documents for case RP00001', cat: 'parties', mustInclude: ['getCaseParties'] },
  { q: 'who is the insurance carrier for RP2476', cat: 'parties', mustInclude: ['getCaseParties'] },
  { q: 'what is the venue on RP00001', cat: 'parties', mustInclude: ['getCaseParties'] },
  // ── Multi-filter combined ─────────────────────────────────
  { q: 'Open WCAB cases in venue 5 for attorney Raj', cat: 'combined', mustInclude: ['combinedSearch'], mustExclude: ['getByVenueId', 'getByCaseTypeId', 'searchCases'], expectForced: true },
  { q: 'personal injury cases opened in 2024 with last name D', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'closed cases in venue 3 with a head injury', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'open cases in venue 5 with a knee injury for paralegal Rita', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'WCAB cases with SOL in 2027 in venue 2', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'rush personal injury cases in venue 5', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'sub-type 4 cases in venue 3', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  { q: 'open immigration cases', cat: 'combined', mustInclude: ['combinedSearch'], expectForced: true },
  // ── Misc / edge ───────────────────────────────────────────
  { q: 'from those results show only the open ones', cat: 'misc' },
  { q: 'now show closed', cat: 'misc' },
  { q: 'send me RP0036 cases', cat: 'misc', mustInclude: ['searchCases'] },
  { q: 'give me everything for employer Acme Corp', cat: 'misc', mustInclude: ['searchCases'] },
];

describe('domain routing — Phase A wrap parity (client + QA, 70+ questions)', () => {
  it(`covers at least 70 varied questions`, () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(70);
  });

  for (const item of QUESTIONS) {
    it(`[${item.cat}] "${item.q}"`, () => {
      const intents = classifyIntents(item.q);
      const opts = deriveOpts(item.q);

      // OLD path
      const oldSel = selectToolsForIntents(intents, stubRegistry(), opts);

      // NEW domain path
      const domains = detectDomains(item.q);
      const newSel = selectToolsForDomains(domains, {
        message: item.q,
        registry: stubRegistry(),
        intents,
        selectorOpts: opts,
      });

      // 1. PARITY — identical tool set + flags.
      expect(new Set(newSel.activeTools)).toEqual(new Set(oldSel.activeTools));
      expect(newSel.forcedCombined).toBe(oldSel.forcedCombined);
      expect(newSel.requireTool).toBe(oldSel.requireTool);

      // 2. FALLBACK — a domain is always chosen and Cases is present.
      expect(domains.length).toBeGreaterThan(0);
      expect(domains.some((d) => d.key === 'cases')).toBe(true);

      // 3. SPOT QA — curated expectations.
      if (item.mustInclude) {
        for (const t of item.mustInclude) expect(newSel.activeTools).toContain(t);
      }
      if (item.mustExclude) {
        for (const t of item.mustExclude) expect(newSel.activeTools).not.toContain(t);
      }
      if (item.expectForced !== undefined) {
        expect(newSel.forcedCombined).toBe(item.expectForced);
      }
      if (item.exactTools) {
        expect(new Set(newSel.activeTools)).toEqual(new Set(item.exactTools));
      }
    });
  }
});
