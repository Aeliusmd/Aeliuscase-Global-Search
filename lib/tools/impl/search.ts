import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { SearchToolOutput } from '@/types/case';
import { searchCasesPaginated } from '@/lib/caseSearch';

export interface SearchDeps {
  apiBaseUrl: string;
  jwtToken: string;
  enforcedSearchType: number;
  enforcedLabel: string;
}

export function makeSearchCasesTool(deps: SearchDeps) {
  const { apiBaseUrl, jwtToken, enforcedSearchType, enforcedLabel } = deps;
  return tool({
    description:
      'Search for legal cases in the Aeliuscase system. Call this for any find/show/look-up/list cases request.',
    inputSchema: zodSchema(
      z.object({
        searchText: z.string().describe(
          'Accumulated search term combining prior keyword + new refinement. No status words.',
        ),
        searchType: z
          .number().int().min(1).max(4)
          .default(enforcedSearchType)
          .describe(`Status filter — server enforces ${enforcedSearchType} (${enforcedLabel}). Only change if the user explicitly switches status.`),
        page: z.number().int().min(1).default(1).describe('Page number (starts at 1)'),
      }),
    ),
    execute: async (input): Promise<SearchToolOutput> => {
      const { searchText, page } = input as { searchText: string; searchType: number; page: number };
      const searchType = enforcedSearchType;
      try {
        const result = await searchCasesPaginated({ apiBaseUrl, jwtToken, searchText, searchType, page: page || 1 });
        if (!result.success) {
          return { success: false, error: result.error ?? 'Search failed', cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, searchText, searchType };
        }
        return { success: true, cases: result.cases, totalRecords: result.totalRecords, totalPages: result.totalPages, hasMorePages: result.hasMorePages, page: result.page, searchText, searchType };
      } catch {
        return { success: false, error: 'Could not connect to case database.', cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, searchText, searchType };
      }
    },
  });
}
