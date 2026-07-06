import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { FilterToolOutput } from '@/types/caseFilters';
import {
  fetchByStatusId,
  fetchBySubTypeId,
  fetchBySubStatusId,
  fetchBySubStatusId2,
  fetchByVenueId,
  fetchBySpecialInstruction,
  fetchBySolDate,
  fetchByCaseDate,
  fetchByCaseTypeId,
  fetchByLastNameInitial,
  fetchByBodyPartIds,
} from '@/lib/caseFilters';
import { BODY_PART_IDS_TEXT } from '@/lib/bodyParts';

import type { DateRange } from '@/lib/dateRange';

export interface FilterDeps {
  apiBaseUrl: string;
  jwtToken: string;
  /** Server-computed date range from the user's words — overrides model dates. */
  resolvedDateRange?: DateRange | null;
}

export function makeGetByStatusIdTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases matching a specific case status ID. Call when user says "status id N" or "caseStatusId N".',
    inputSchema: zodSchema(z.object({
      caseStatusId: z.number().int().describe('The numeric case status ID to filter by.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { caseStatusId, page } = input as { caseStatusId: number; page: number };
      return fetchByStatusId({ ...deps, caseStatusId, page });
    },
  });
}

export function makeGetBySubTypeIdTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases matching a specific case sub-type ID. Call when user says "sub-type id N" or "caseSubTypeId N".',
    inputSchema: zodSchema(z.object({
      caseSubTypeId: z.number().int().describe('The numeric case sub-type ID to filter by.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { caseSubTypeId, page } = input as { caseSubTypeId: number; page: number };
      return fetchBySubTypeId({ ...deps, caseSubTypeId, page });
    },
  });
}

export function makeGetBySubStatusIdTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases matching a specific case sub-status ID. Call when user says "sub-status id N" or "caseSubStatusId N".',
    inputSchema: zodSchema(z.object({
      caseSubStatusId: z.number().int().describe('The numeric case sub-status ID to filter by.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { caseSubStatusId, page } = input as { caseSubStatusId: number; page: number };
      return fetchBySubStatusId({ ...deps, caseSubStatusId, page });
    },
  });
}

export function makeGetBySubStatusId2Tool(deps: FilterDeps) {
  return tool({
    description: 'Get cases matching a specific case sub-status 2 ID. Call when user says "sub-status2 id N" or "caseSubStatusId2 N".',
    inputSchema: zodSchema(z.object({
      caseSubStatusId2: z.number().int().describe('The numeric case sub-status 2 ID to filter by.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { caseSubStatusId2, page } = input as { caseSubStatusId2: number; page: number };
      return fetchBySubStatusId2({ ...deps, caseSubStatusId2, page });
    },
  });
}

export function makeGetByVenueIdTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases for a specific venue ID. Call when user says "venue id N" or "venue N".',
    inputSchema: zodSchema(z.object({
      venueId: z.number().int().describe('The numeric venue ID to filter by.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { venueId, page } = input as { venueId: number; page: number };
      return fetchByVenueId({ ...deps, venueId, page });
    },
  });
}

export function makeGetBySpecialInstructionTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases with matching special instructions. Call when user says "rush cases", "on hold", "special instruction [keyword]".',
    inputSchema: zodSchema(z.object({
      specialInstructions: z.string().describe('The keyword to search in special instructions field (e.g. "rush", "on hold").'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { specialInstructions, page } = input as { specialInstructions: string; page: number };
      return fetchBySpecialInstruction({ ...deps, specialInstructions, page });
    },
  });
}

export function makeGetBySolDateTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases whose SOL (Statute of Limitations) date falls within a range. Call when user mentions "SOL", "statute of limitations", or an SOL date range. At least one of solFromDate or solToDate must be provided.',
    inputSchema: zodSchema(
      z.object({
        solFromDate: z.string().optional().describe('Start date ISO 8601 format (e.g. "2024-01-01"). Optional if solToDate is provided.'),
        solToDate:   z.string().optional().describe('End date ISO 8601 format (e.g. "2024-12-31"). Optional if solFromDate is provided.'),
        page: z.number().int().min(1).default(1),
      }),
    ),
    execute: async (input): Promise<FilterToolOutput> => {
      const { solFromDate, solToDate, page } = input as { solFromDate?: string; solToDate?: string; page: number };
      // A server-resolved SOL range (e.g. "expiring next year") overrides model dates.
      const resolved = deps.resolvedDateRange?.kind === 'sol' ? deps.resolvedDateRange : null;
      const from = resolved?.from ?? solFromDate;
      const to = resolved?.to ?? solToDate;
      if (!from && !to) {
        return { success: false, filterType: 'solDate', filterLabel: 'SOL Date', filterValue: '',
          cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1,
          error: 'Please provide at least one date (solFromDate or solToDate).' };
      }
      return fetchBySolDate({ ...deps, solFromDate: from, solToDate: to, page });
    },
  });
}

export function makeGetByBodyPartIdsTool(deps: FilterDeps) {
  return tool({
    description: `Get cases linked to specific injured body parts by numeric ID. Known IDs: ${BODY_PART_IDS_TEXT}. Call when user mentions a body part name or ID.`,
    inputSchema: zodSchema(z.object({
      bodyPartIds: z.array(z.number().int()).min(1).describe('List of numeric body part IDs (e.g. [100, 110]).'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { bodyPartIds, page } = input as { bodyPartIds: number[]; page: number };
      return fetchByBodyPartIds({ ...deps, bodyPartIds, page });
    },
  });
}

export function makeGetByCaseDateTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases by their case (open) date range. Call when the user mentions cases "opened in", "from [date] to [date]", "created in", or a year/month range NOT related to SOL. At least one of fromDate or toDate is required.',
    inputSchema: zodSchema(z.object({
      fromDate: z.string().optional().describe('Start date ISO 8601 (e.g. "2024-01-01"). Optional if toDate given.'),
      toDate:   z.string().optional().describe('End date ISO 8601 (e.g. "2024-12-31"). Optional if fromDate given.'),
      subOutFilter: z.string().optional().describe('"include" (default), "exclude", or "only" — for sub-out cases.'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { fromDate, toDate, subOutFilter, page } = input as {
        fromDate?: string; toDate?: string; subOutFilter?: string; page: number;
      };
      // Only a CASE-date resolved range overrides here; an SOL range must not be
      // mistaken for a case-open date.
      const resolved = deps.resolvedDateRange && deps.resolvedDateRange.kind !== 'sol'
        ? deps.resolvedDateRange : null;
      const from = resolved?.from ?? fromDate;
      const to = resolved?.to ?? toDate;
      if (!from && !to) {
        return { success: false, filterType: 'caseDate', filterLabel: 'Case Date', filterValue: '',
          cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1,
          error: 'Please provide at least one date (from or to).' };
      }
      return fetchByCaseDate({ ...deps, fromDate: from, toDate: to, subOutFilter, page });
    },
  });
}

export function makeGetByCaseTypeIdTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases by their MAIN case type ID (not sub-type). Known type IDs: 1=WCAB, 2=DUI, 3=Personal Injury, 4=WCAB Defense, 5=Class Action, 6=Civil, 7=Employment, 8=Immigration, 9=Social Security. Map the user\'s type name to the ID. Call when user mentions a case type like "Personal Injury cases" or "type id N".',
    inputSchema: zodSchema(z.object({
      caseTypeId: z.number().int().describe('The numeric main case type ID.'),
      subOutFilter: z.string().optional().describe('"include" (default), "exclude", or "only".'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { caseTypeId, subOutFilter, page } = input as { caseTypeId: number; subOutFilter?: string; page: number };
      return fetchByCaseTypeId({ ...deps, caseTypeId, subOutFilter, page });
    },
  });
}

export function makeGetByLastNameInitialTool(deps: FilterDeps) {
  return tool({
    description: 'Get cases where the applicant/claimant last name starts with a given letter (A–Z). Call when user says "last name starts with M", "last name initial D", etc.',
    inputSchema: zodSchema(z.object({
      lastNameInitial: z.string().min(1).max(1).describe('A single letter A–Z.'),
      subOutFilter: z.string().optional().describe('"include" (default), "exclude", or "only".'),
      page: z.number().int().min(1).default(1),
    })),
    execute: async (input): Promise<FilterToolOutput> => {
      const { lastNameInitial, subOutFilter, page } = input as { lastNameInitial: string; subOutFilter?: string; page: number };
      return fetchByLastNameInitial({ ...deps, lastNameInitial, subOutFilter, page });
    },
  });
}
