import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { PartiesToolOutput } from '@/types/caseParties';
import { fetchCaseParties } from '@/lib/caseParties';

export interface PartiesDeps {
  apiBaseUrl: string;
  jwtToken: string;
  /**
   * Set true only by the chat route's forced single-field path (a question
   * like "who is the insurance carrier for AE00224", not a general "list the
   * parties" request) — see PartiesToolOutput.narrow's doc comment. Decided
   * server-side from the user's own words, not left to the model, since a
   * forced single-tool call has no room for the model to signal it itself.
   */
  narrowField?: boolean;
}

export function makeGetCasePartiesTool(deps: PartiesDeps) {
  const { apiBaseUrl, jwtToken, narrowField = false } = deps;
  return tool({
    description:
      'Fetch all parties and their documents for a specific AeliusCase case. Call this when the user asks about parties, contacts, or documents for a specific case number, case name, or case ID. ' +
      'The result includes both `parties` (every raw row) and `partyGroups` (rows collapsed by partyType, with a count and up to 5 unique names). ' +
      'When listing "the parties" generally, use partyGroups and show each type as "TypeName (N)" — e.g. "Applicant Attorney (12)" — rather than listing all N rows individually; some real cases have a dozen+ near-duplicate rows of one type. ' +
      'Still answer a specific-field question (e.g. "who is the insurance carrier") by name, from whichever party row actually has that type. ' +
      'If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.' +
      (narrowField
        ? ' This call is answering ONE specific field the user asked for — reply with ONLY that fact in a single short sentence. No numbered list, no restating unrelated party types, no closing filler line ("let me know if you need anything else").'
        : '') +
      ' Set answerScope to "single_fact" for a single-detail question like "who is the insurance carrier" or "what is the venue" — answer with ONLY that fact in one short sentence: no list, no restating unrelated party types, no closing filler line. Set answerScope to "full_list" for a general/overview request like "who are the parties" or "show me the contacts" — give the fuller partyGroups-based answer as usual.',
    inputSchema: zodSchema(
      z
        .object({
          caseNumber: z.string().optional().describe('Case number string, e.g. "RP00001". Prefer this over caseId/caseName.'),
          caseId: z.number().int().optional().describe('Numeric case ID. Use only when caseNumber is not known.'),
          caseName: z.string().optional().describe('Dashboard-style case name, e.g. "Elgin Perdomo vs Allied Universal". Use this when the case is referenced by name rather than number — do NOT put a case name into caseNumber. May match more than one case.'),
          answerScope: z.enum(['single_fact', 'full_list']).optional().describe(
            'Whether the user asked about ONE specific detail ("single_fact") or wants a general/overview answer ("full_list") — see the tool description for how each is handled.',
          ),
        })
        .refine((d) => d.caseNumber !== undefined || d.caseId !== undefined || d.caseName !== undefined, {
          message: 'Provide caseNumber, caseId, or caseName.',
        }),
    ),
    execute: async (input): Promise<PartiesToolOutput> => {
      const { caseNumber, caseId, caseName, answerScope } = input as {
        caseNumber?: string; caseId?: number; caseName?: string; answerScope?: 'single_fact' | 'full_list';
      };
      const result = await fetchCaseParties({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      const narrow = narrowField || answerScope === 'single_fact';
      return narrow ? { ...result, narrow: true } : result;
    },
  });
}
