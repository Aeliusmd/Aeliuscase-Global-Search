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
      'Fetch all parties and their documents for a specific AeliusCase case. Call this when the user asks about parties, contacts, or documents for a specific case number or case ID. ' +
      'The result includes both `parties` (every raw row) and `partyGroups` (rows collapsed by partyType, with a count and up to 5 unique names). ' +
      'When listing "the parties" generally, use partyGroups and show each type as "TypeName (N)" — e.g. "Applicant Attorney (12)" — rather than listing all N rows individually; some real cases have a dozen+ near-duplicate rows of one type. ' +
      'Still answer a specific-field question (e.g. "who is the insurance carrier") by name, from whichever party row actually has that type.',
    inputSchema: zodSchema(
      z
        .object({
          caseNumber: z.string().optional().describe('Case number string, e.g. "RP00001". Prefer this over caseId.'),
          caseId: z.number().int().optional().describe('Numeric case ID. Use only when caseNumber is not known.'),
        })
        .refine((d) => d.caseNumber !== undefined || d.caseId !== undefined, {
          message: 'Provide caseNumber or caseId.',
        }),
    ),
    execute: async (input): Promise<PartiesToolOutput> => {
      const { caseNumber, caseId } = input as { caseNumber?: string; caseId?: number };
      return fetchCaseParties({ apiBaseUrl, jwtToken, caseNumber, caseId });
    },
  });
}
