import { describe, it, expect } from 'vitest';
import type { ToolEntry } from '@/lib/tools/registry';
import { classifyIntents } from '@/lib/tools/intentRouter';
import { detectDomains, selectToolsForDomains } from '@/lib/domains';

// Includes getCaseFullDetail alongside the Cases tools — unlike
// routing-parity.test.ts's stub (which deliberately omits it so that test stays
// a pure parity check against the pre-Phase-2 behaviour).
const TOOL_NAMES = [
  'searchCases', 'getCaseParties', 'getByStatusId', 'getByVenueId', 'getByBodyPartIds',
  'getByCaseDate', 'getByCaseTypeId', 'getByStaff', 'combinedSearch', 'getCaseFullDetail',
  'getCaseTasks', 'getCaseEvents', 'getCaseDocuments', 'getCaseNotes', 'getCaseActivities',
  'getCaseAccounting',
];
function stubRegistry(): Map<string, ToolEntry> {
  return new Map(
    TOOL_NAMES.map((n) => [n, { definition: { name: n } as unknown as ToolEntry['definition'], intentTags: [] }]),
  );
}

function route(q: string) {
  const domains = detectDomains(q);
  const sel = selectToolsForDomains(domains, {
    message: q,
    registry: stubRegistry(),
    intents: classifyIntents(q),
    selectorOpts: {},
  });
  return { domains, sel };
}

describe('Phase 2 — caseDetail domain routing', () => {
  const onTopic = [
    'what is the venue on case RP003583',
    'what body parts are injured on RP003583',
    "what's the SOL on case RP2134",
    'when was the date of injury on RP003583',
    "what's the ADJ number for case RP2134",
    'show me everything on case RP003668',
    'give me the full detail for the Elgin Perdomo vs Allied Universal case',
    'demographics for case RP003583',
    // Added 2026-07-19 after a QA pass against the PM acceptance-criteria examples
    // (defendant + JetFile submission had no trigger word in any domain).
    'who is the defendant on the Luqman vs Medcube case',
    'who is the defendant on case RP003668',
    'when was case RP003668 submitted to JetFile',
    'what is the JetFile submission date for case RP003583',
    // Added 2026-07-19 (QA round 2): indirect SOL/expiry phrasing.
    'has case RP2134 expired yet',
    'is case RP003583 about to expire',
    // Added 2026-07-19 (QA round 3): attorney/paralegal/coordinator lookup by
    // case NAME — getCaseParties (Phase 1) has no caseName parameter and
    // cannot resolve these; getCaseFullDetail can.
    'who is the attorney for Elgin Perdomo vs Allied Universal',
    'who is the attorney on case RP2476',
    "what's the coordinator for the Smith vs Wallmart case",
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseFullDetail`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
      expect(sel.activeTools).toContain('getCaseFullDetail');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // A staff-role word with NO case reference at all must NOT pull in
    // getCaseFullDetail (added 2026-07-19 alongside the attorney/paralegal/
    // coordinator trigger words above — confirms no over-broadening).
    'cases handled by attorney Raj Patel',
    'which cases does paralegal Maria handle',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseFullDetail`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseFullDetail');
    });
  }

  it('falls back to Cases when nothing matches (never returns zero domains)', () => {
    const { domains } = route('hi there');
    expect(domains.length).toBeGreaterThan(0);
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('can be active alongside Cases when wording overlaps (e.g. "venue")', () => {
    // "venue" is in both casesDomain's and caseDetailDomain's match regex —
    // both are legitimately active; getCaseFullDetail is exposed alongside
    // whatever Cases tool the intent router picks.
    const { domains } = route('what is the venue on case RP003583');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
  });

  // Regression test for the confirmed collision found live 2026-07-19 (see
  // lib/domains/activities.ts doc comment) — "demographics" is a trigger word
  // for BOTH this domain and activitiesDomain now, so both fire together.
  it('also fires alongside activitiesDomain for "demographics sent" phrasing (was: caseDetail only)', () => {
    const { domains } = route('when was the demographics sent on case RP003668');
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(domains.some((d) => d.key === 'activities')).toBe(true);
  });
});

describe('Phase 2 — tasks domain routing', () => {
  const onTopic = [
    'what tasks are due on RP003583',
    'any overdue tasks on case RP003583',
    'show me the to-dos for case RP2134',
    'todo list for case RP003583',
    'what tasks are assigned on case RP003583',
    'task list for the Elgin Perdomo vs Allied Universal case',
    "what's due on case RP2134",
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseTasks`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'tasks')).toBe(true);
      expect(sel.activeTools).toContain('getCaseTasks');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // "due"/"overdue" without any case-reference — must NOT fire (would be a
    // false positive against a list-style question, no domain exists yet for
    // this kind of bare phrasing and none should be guessed at).
    'cases with SOL due in 2027',
    'which cases are overdue for renewal',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseTasks`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseTasks');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('can be active alongside caseDetail when a question spans both (venue + tasks on one case)', () => {
    const { domains, sel } = route('what tasks are due and what is the venue on case RP003583');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(sel.activeTools).toContain('getCaseTasks');
    expect(sel.activeTools).toContain('getCaseFullDetail');
  });
});

describe('Phase 2 — events domain routing', () => {
  const onTopic = [
    "when's the next hearing on case RP003583",
    'any events scheduled for RP2134',
    'what hearings does case RP003583 have',
    'calendar entries for the Elgin Perdomo vs Allied Universal case',
    'most recent event on case RP003583',
    'is there a status conference on case RP2134',
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseEvents`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'events')).toBe(true);
      expect(sel.activeTools).toContain('getCaseEvents');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // "hearing"/"event" without any case-reference — must NOT fire.
    'how many hearings happened last month across all cases',
    'which cases have upcoming events',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseEvents`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseEvents');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('does not false-positive on tasks-only wording', () => {
    const { domains } = route('what tasks are due on case RP003583');
    expect(domains.some((d) => d.key === 'events')).toBe(false);
  });

  it('can be active alongside tasks and caseDetail when a question spans all three', () => {
    const { domains, sel } = route('what tasks, hearings, and venue does case RP003583 have');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(domains.some((d) => d.key === 'events')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(sel.activeTools).toEqual(expect.arrayContaining(['getCaseTasks', 'getCaseEvents', 'getCaseFullDetail']));
  });
});

describe('Phase 2 — documents domain routing', () => {
  const onTopic = [
    'has the medical records document been uploaded on case RP003583',
    'show documents for case RP00001',
    'what files are on case RP2134',
    'list the uploaded files on the Elgin Perdomo vs Allied Universal case',
    'who uploaded the settlement agreement on RP003583',
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseDocuments`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'documents')).toBe(true);
      expect(sel.activeTools).toContain('getCaseDocuments');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // "document"/"file" without any case-reference — must NOT fire.
    'which cases have missing documents',
    'how many files were uploaded last month',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseDocuments`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseDocuments');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('is active ALONGSIDE Cases for "documents for case X" (existing getCaseParties wording overlaps)', () => {
    // casesDomain already routes "documents for case RP00001"-style wording to
    // getCaseParties (party-attached docs); documentsDomain is additive, not a
    // replacement — both tools are legitimately offered so the model can pick
    // the right one per the system prompt's guidance.
    const { domains, sel } = route('documents for case RP00001');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(domains.some((d) => d.key === 'documents')).toBe(true);
    expect(sel.activeTools).toContain('getCaseDocuments');
  });

  it('does not false-positive on tasks/events-only wording', () => {
    const { domains } = route('what tasks and hearings does case RP003583 have');
    expect(domains.some((d) => d.key === 'documents')).toBe(false);
  });
});

describe('Phase 2 — notes domain routing', () => {
  const onTopic = [
    'give me all settlement notes on case RP003583',
    'what notes mention Matrix on RP2134',
    'show the notes for the Elgin Perdomo vs Allied Universal case',
    'any note about the adjuster on case RP003668',
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseNotes`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'notes')).toBe(true);
      expect(sel.activeTools).toContain('getCaseNotes');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // "note"/"notes" without any case-reference — must NOT fire.
    'please note that I need open cases only',
    'which cases have notes about settlement',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseNotes`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseNotes');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('does not false-positive on tasks/events/documents-only wording', () => {
    const { domains } = route('what tasks, hearings, and documents does case RP003583 have');
    expect(domains.some((d) => d.key === 'notes')).toBe(false);
  });

  it('can be active alongside caseDetail when a question spans both (notes + venue on one case)', () => {
    const { domains, sel } = route('what notes and venue does case RP003583 have');
    expect(domains.some((d) => d.key === 'notes')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(sel.activeTools).toEqual(expect.arrayContaining(['getCaseNotes', 'getCaseFullDetail']));
  });
});

describe('Phase 2 — activities domain routing', () => {
  const onTopic = [
    'show me the 5 most recent activities on case RP003583',
    'what is the activity history for RP2134',
    'audit log for the Elgin Perdomo vs Allied Universal case',
    'show the demographics-sent activity on case RP003668',
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseActivities`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'activities')).toBe(true);
      expect(sel.activeTools).toContain('getCaseActivities');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // "activity"/"history" without any case-reference — must NOT fire.
    'which cases have had recent activity',
    'sort cases by history of status changes',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseActivities`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseActivities');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('does not false-positive on tasks/events/documents/notes-only wording', () => {
    const { domains } = route('what tasks, hearings, documents, and notes does case RP003583 have');
    expect(domains.some((d) => d.key === 'activities')).toBe(false);
  });

  it('can be active alongside notes when a question spans both (activities + notes on one case)', () => {
    const { domains, sel } = route('show me the activities and notes on case RP003583');
    expect(domains.some((d) => d.key === 'activities')).toBe(true);
    expect(domains.some((d) => d.key === 'notes')).toBe(true);
    expect(sel.activeTools).toEqual(expect.arrayContaining(['getCaseActivities', 'getCaseNotes']));
  });
});

describe('Phase 2 — accounting domain routing', () => {
  const onTopic = [
    'what cheque requests exist on case RP003583',
    'show the accounting summary for RP2134',
    'what invoices are outstanding on the Elgin Perdomo vs Allied Universal case',
    'what settlement fees are on case RP003668',
    'what is the current balance on case RP003583',
    'any client costs paid on case RP2134',
  ];

  for (const q of onTopic) {
    it(`routes "${q}" to getCaseAccounting`, () => {
      const { domains, sel } = route(q);
      expect(domains.some((d) => d.key === 'accounting')).toBe(true);
      expect(sel.activeTools).toContain('getCaseAccounting');
      expect(sel.requireTool).toBe(true);
    });
  }

  const offTopic = [
    'find cases for Maria',
    'search AE0099',
    'status id 5',
    'cases handled by Raj',
    'show me open cases',
    'personal injury cases opened in 2024',
    // Generic financial-adjacent words WITHOUT the specific accounting
    // vocabulary or a case-reference — must NOT fire. Deliberately conservative
    // given financial data sensitivity.
    'what is the balance of cases open this month',
    'which cases have outstanding payments',
    'how much does this cost',
  ];

  for (const q of offTopic) {
    it(`does NOT route "${q}" to getCaseAccounting`, () => {
      const { sel } = route(q);
      expect(sel.activeTools).not.toContain('getCaseAccounting');
    });
  }

  it('falls back to Cases when nothing matches', () => {
    const { domains } = route('hi there');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });

  it('does not false-positive on tasks/events/documents/notes/activities-only wording', () => {
    const { domains } = route('what tasks, hearings, documents, notes, and activities does case RP003583 have');
    expect(domains.some((d) => d.key === 'accounting')).toBe(false);
  });

  it('can be active alongside caseDetail when a question spans both (accounting + venue on one case)', () => {
    const { domains, sel } = route('what cheque requests and venue does case RP003583 have');
    expect(domains.some((d) => d.key === 'accounting')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(sel.activeTools).toEqual(expect.arrayContaining(['getCaseAccounting', 'getCaseFullDetail']));
  });

  // Regression tests for the two confirmed collisions found live 2026-07-19
  // (see lib/domains/accounting.ts and lib/domains/activities.ts doc comments).
  it('also fires alongside tasksDomain for "amount due" financial phrasing (was: tasksDomain only)', () => {
    const { domains, sel } = route('what amount is due on case RP003583');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(domains.some((d) => d.key === 'accounting')).toBe(true);
    expect(sel.activeTools).toEqual(expect.arrayContaining(['getCaseTasks', 'getCaseAccounting']));
  });

  it('also fires for "balance due" and "payment due" phrasing', () => {
    expect(route('what is the balance due on case RP003583').domains.some((d) => d.key === 'accounting')).toBe(true);
    expect(route('is there a payment due on case RP2134').domains.some((d) => d.key === 'accounting')).toBe(true);
  });

  it('does NOT fire for plain task-due phrasing with no financial word (avoids over-broadening)', () => {
    const { domains } = route('what tasks are due on case RP003583');
    expect(domains.some((d) => d.key === 'accounting')).toBe(false);
  });
});

// Live bugs fixed 2026-07-29 (selectToolsForDomains, lib/domains/index.ts):
// casesDomain's own bare-word regex (case/attorney/paralegal/coordinator/...)
// ALSO matches whenever a more specific domain's own topic word appears
// alongside the literal word "case", merging combinedSearch/searchCases/
// getByStaff in alongside a domain that explicitly wants EXCLUSIVE control
// (requireTool) of its own single tool — gpt-4o-mini then non-deterministically
// picked the wrong one in two separate live tests.
describe('casesDomain defers when another domain requires exclusive tool control', () => {
  it('does not merge in Cases-domain tools for "tasks due next week for case AE00224" (was: combinedSearch)', () => {
    const { domains, sel } = route('what are the tasks due next week for case AE00224');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(sel.activeTools).toEqual(['getCaseTasks']);
    expect(sel.activeTools).not.toContain('combinedSearch');
    expect(sel.activeTools).not.toContain('searchCases');
  });

  it('does not merge in Cases-domain staff-search tools for "who is the paralegal on case X" (was: combinedSearch/getByStaff)', () => {
    const { domains, sel } = route('who is the paralegal on case AE00224');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(domains.some((d) => d.key === 'caseDetail')).toBe(true);
    expect(sel.activeTools).toEqual(['getCaseFullDetail']);
    expect(sel.activeTools).not.toContain('combinedSearch');
    expect(sel.activeTools).not.toContain('getByStaff');
  });

  it('still merges Cases-domain tools in when NO active domain requires exclusivity', () => {
    // casesDomain's own selectTools (selectToolsForIntents) does not itself set
    // requireTool for a plain search — confirms the merge path is otherwise unchanged.
    const { sel } = route('show me open cases');
    expect(sel.activeTools.length).toBeGreaterThan(0);
  });
});
