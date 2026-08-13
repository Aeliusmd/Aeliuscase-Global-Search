import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { CaseAccountingToolOutput, CaseActivitiesToolOutput, CaseDocumentsToolOutput, CaseEventsToolOutput, CaseFullDetailToolOutput, CaseNotesToolOutput, CaseSectionTotals, CaseTasksToolOutput } from '@/types/caseFullDetail';
import { fetchCaseFullDetail } from '@/lib/caseFullDetail';

/**
 * Max rows of any one section handed to the model. The FULL count always
 * travels alongside as a separate number, so an answer that only needs the
 * total ("how many tasks?") stays exact while the prompt stays small.
 *
 * Live regression fixed 2026-08-13: once the backend fixed its partial-payload
 * bug (docs/Request_GetCaseFullDetail_PartialPayload.html) case AE-00224
 * started returning every section populated at once — 230 tasks, 187 events,
 * 82 documents, 38 notes and 1156 activities. Measured against the real mapped
 * output that is ~431,000 characters (~108,000 tokens) from getCaseFullDetail
 * ALONE, and "show me everything on case AE00224" hard-failed with
 * AI_APICallError: "maximum context length is 128000 tokens, however your
 * messages resulted in 141472 tokens" — which the UI shows as a completely
 * blank reply. Activities were ~76,000 of those tokens by themselves.
 *
 * trimToolOutputs() in app/api/chat/route.ts already zeroes these arrays, but
 * only for HISTORICAL messages; the current turn's own tool result is what
 * overflowed here, so the cap has to happen at the source.
 *
 * 25 is well above what any answer actually itemizes (the system prompt asks
 * for a one-line-per-section summary on comprehensive requests) and brings the
 * same case to roughly 8,000 tokens.
 */
export const SECTION_SAMPLE_CAP = 25;

function cap<T>(rows: T[] | undefined): T[] {
  return (rows ?? []).slice(0, SECTION_SAMPLE_CAP);
}

export interface CaseDetailDeps {
  apiBaseUrl: string;
  jwtToken: string;
  /** Forwarded to fetchCaseFullDetail so getCaseDocuments' document links can
   *  be built through app/api/documents/download (see lib/caseFullDetail.ts's
   *  buildDownloadUrl doc comment). Unused by the other 6 tools' output, but
   *  threaded through all of them for one consistent deps shape. */
  appOrigin?: string;
  /** Current user question. Used only to narrow large document/activity
   * sections before SECTION_SAMPLE_CAP is applied, so a requested row cannot
   * disappear merely because it is older than the first 25 records. */
  queryText?: string;
}

function relevantDocuments<T extends { name?: string | null; category?: string | null }>(
  rows: T[] | undefined,
  queryText: string | undefined,
): T[] {
  const all = rows ?? [];
  if (!/\bsettlement(?:-related)?\b/i.test(queryText ?? '')) return all;
  return all.filter((row) => /settlement/i.test(`${row.name ?? ''} ${row.category ?? ''}`));
}

function relevantActivities<T extends { description?: string | null; type?: string | null }>(
  rows: T[] | undefined,
  queryText: string | undefined,
): T[] {
  const all = rows ?? [];
  const query = queryText ?? '';

  if (/\bdemographics?\b/i.test(query) && /\bmatrix\b/i.test(query)) {
    return all.filter((row) =>
      /demographic/i.test(row.description ?? '') && /matrix/i.test(row.description ?? ''));
  }

  if (/\blegal\s+form\b/i.test(query) && /\bgenerat(?:e|ed|or|ing)\b/i.test(query)) {
    return all.filter((row) =>
      row.type === 'COMPLETED_FORMS' || /gen(?:e|a)rated\s+by/i.test(row.description ?? ''));
  }

  return all;
}

/**
 * Live UX bug (2026-07-29): "who is the applicant on above case?" got the
 * same long, padded answer as a general "show me the parties" question —
 * the server-side regex that had been driving short-vs-long answers for
 * getCaseParties (explicitCasePartyFieldRef/anaphoricPartyFieldQuestion in
 * app/api/chat/route.ts) only recognizes an enumerated anaphor list
 * ("that/this/the/same case"), so "above case" fell through to normal
 * routing and got the old, full-length treatment. Hand-adding every possible
 * anaphor word is the same whack-a-mole problem already moved away from once
 * this session (the always-run LLM domain classifier change).
 *
 * answerScope instead asks the MODEL to classify the question itself, from
 * the actual text, on every call to every Phase-2 single-case tool — no
 * regex list to keep extending. Each tool's execute() copies the choice
 * straight into a `narrow` field on the output; getCaseParties additionally
 * OR-combines it with its own deterministic regex-based signal as a
 * belt-and-suspenders safety net for the specific phrasings that already
 * had one (see lib/tools/impl/parties.ts).
 */
function answerScopeGuidance(singleFactExample: string, fullListExample: string): string {
  return ' Set answerScope to "single_fact" for a single-detail question like '
    + `${singleFactExample} — answer with ONLY that fact in one short sentence: no list, no restating `
    + 'unrelated data, no closing filler line ("let me know if you need anything else"). Set answerScope '
    + `to "full_list" for a general/overview request like ${fullListExample} — give the fuller structured answer as usual.`;
}

const answerScopeField = z.enum(['single_fact', 'full_list']).optional().describe(
  'Whether the user asked about ONE specific detail ("single_fact") or wants a general/overview answer ("full_list") — see the tool description for how each is handled.',
);

const caseRefSchema = z
  .object({
    caseNumber: z.string().optional().describe('Case number string, e.g. "RP003583". Prefer this over caseId/caseName.'),
    caseId: z.number().int().optional().describe('Numeric case ID. Use only when caseNumber is not known.'),
    caseName: z.string().optional().describe('Dashboard-style case name, e.g. "Elgin Perdomo vs Allied Universal". May match more than one case.'),
    answerScope: answerScopeField,
  })
  .refine((d) => d.caseNumber !== undefined || d.caseId !== undefined || d.caseName !== undefined, {
    message: 'Provide caseNumber, caseId, or caseName.',
  });

type CaseRefInput = { caseNumber?: string; caseId?: number; caseName?: string; answerScope?: 'single_fact' | 'full_list' };

export function makeGetCaseFullDetailTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin } = deps;
  return tool({
    description:
      'Fetch full detail for ONE specific AeliusCase case — venue, injury/body parts, statute of limitations (SOL), date of injury (DOI), ADJ number, applicant/employer/insurance-carrier demographics, and case-level staff names. Call this for a single case identified by case number, case ID, or case name. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"what is the venue on RP2010"', '"show me everything on case RP2010"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseFullDetailToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      const narrow = answerScope === 'single_fact';
      if (!result.success || !result.data) return { ...result, narrow };

      // Cap every section, but keep the real totals — see SECTION_SAMPLE_CAP.
      const d = result.data;
      const sectionTotals: CaseSectionTotals = {
        tasks: d.tasks?.length ?? 0,
        events: d.events?.length ?? 0,
        documents: d.documents?.length ?? 0,
        notes: d.notes?.length ?? 0,
        activities: d.activities?.length ?? 0,
      };
      return {
        ...result,
        narrow,
        sectionTotals,
        data: {
          ...d,
          tasks: cap(d.tasks),
          events: cap(d.events),
          documents: cap(d.documents),
          notes: cap(d.notes),
          activities: cap(d.activities),
        },
      };
    },
  });
}

export function makeGetCaseTasksTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin } = deps;
  return tool({
    description:
      'Fetch the tasks/to-dos for ONE specific AeliusCase case — title, description, category, assigned staff, due date, status, priority. Call this for questions about what tasks are due, overdue, or assigned on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"who is assigned to the settlement task"', '"what are the tasks on this case"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseTasksToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        tasks: cap(result.data?.tasks),
        tasksTotal: result.data?.tasks?.length ?? 0,
        narrow,
      };
    },
  });
}

export function makeGetCaseEventsTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin } = deps;
  return tool({
    description:
      'Fetch the calendar events/hearings for ONE specific AeliusCase case — title, type, date/time, location, status, notes. Call this for questions about upcoming or past hearings/events on a specific case (e.g. "when is the next hearing on RP003583"). If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"when is the next hearing"', '"what hearings are scheduled this month"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseEventsToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        events: cap(result.data?.events),
        eventsTotal: result.data?.events?.length ?? 0,
        narrow,
      };
    },
  });
}

export function makeGetCaseDocumentsTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin, queryText } = deps;
  return tool({
    description:
      'Fetch the uploaded documents for ONE specific AeliusCase case — name, category, uploader, upload date, file link. Call this for questions about whether a document has been uploaded, who uploaded it, or to list documents on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"who uploaded the settlement document"', '"show me all documents on this case"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseDocumentsToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      const documents = relevantDocuments(result.data?.documents, queryText);
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        documents: cap(documents),
        documentsTotal: documents.length,
        narrow,
      };
    },
  });
}

export function makeGetCaseNotesTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin } = deps;
  return tool({
    description:
      'Fetch the notes for ONE specific AeliusCase case — subject, text, category, author, date. Call this for questions like "give me all settlement notes" or "what notes mention Matrix" on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"who created the settlement note"', '"give me all settlement notes"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseNotesToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        notes: cap(result.data?.notes),
        notesTotal: result.data?.notes?.length ?? 0,
        narrow,
      };
    },
  });
}

export function makeGetCaseActivitiesTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin, queryText } = deps;
  return tool({
    description:
      'Fetch the activity/audit history for ONE specific AeliusCase case — description, type, who performed it, timestamp, and the related note/task/event. Call this for questions like "5 most recent activities" or "when was X sent" on a specific case. Sorted most-recent-first. For "who generated the last legal form", use the newest COMPLETED_FORMS/generated-by activity; do not confuse a nearby document "stacked by" activity with the person who generated the form. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"when was the last activity performed"', '"what are the 5 most recent activities"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseActivitiesToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      const activities = relevantActivities(result.data?.activities, queryText);
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        activities: cap(activities),
        activitiesTotal: activities.length,
        narrow,
      };
    },
  });
}

export function makeGetCaseAccountingTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken, appOrigin } = deps;
  return tool({
    description:
      'Fetch the financial summary for ONE specific AeliusCase case — cheque requests, payments, client costs paid, settlement fees. Call this for questions like "what cheque requests exist" or "what is the current balance" on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.'
      + answerScopeGuidance('"what is the current balance"', '"what are the settlement fees"'),
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseAccountingToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as CaseRefInput;
      const narrow = answerScope === 'single_fact';
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, narrow, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        accounting: result.data?.accounting,
        narrow,
      };
    },
  });
}
