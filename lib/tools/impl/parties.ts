import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { PartiesToolOutput } from '@/types/caseParties';
import { fetchCaseParties } from '@/lib/caseParties';

export interface PartiesDeps {
  apiBaseUrl: string;
  jwtToken: string;
}

export function makeGetCasePartiesTool(deps: PartiesDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch all parties and their documents for a specific AeliusCase case. Call this when the user asks about parties, contacts, or documents for a specific case number, case name, or case ID. ' +
      'The result includes both `parties` (every raw row) and `partyGroups` (rows collapsed by partyType, with a count and up to 5 unique names). ' +
      'When listing "the parties" generally, use partyGroups and show each type as "TypeName (N)" — e.g. "Applicant Attorney (12)" — rather than listing all N rows individually; some real cases have a dozen+ near-duplicate rows of one type. ' +
      'Still answer a specific-field question (e.g. "who is the insurance carrier") by name, from whichever party row actually has that type. ' +
      'If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(
      z
        .object({
          caseNumber: z.string().optional().describe('Case number string, e.g. "RP00001". Prefer this over caseId/caseName.'),
          caseId: z.number().int().optional().describe('Numeric case ID. Use only when caseNumber is not known.'),
          caseName: z.string().optional().describe('Dashboard-style case name, e.g. "Elgin Perdomo vs Allied Universal". Use this when the case is referenced by name rather than number — do NOT put a case name into caseNumber. May match more than one case.'),
        })
        .refine((d) => d.caseNumber !== undefined || d.caseId !== undefined || d.caseName !== undefined, {
          message: 'Provide caseNumber, caseId, or caseName.',
        }),
    ),
    execute: async (input): Promise<PartiesToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      return fetchCaseParties({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
    },
  });
}
