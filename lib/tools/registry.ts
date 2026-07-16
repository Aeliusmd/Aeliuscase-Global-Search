import type { IntentKey } from './intentRouter';
import { makeSearchCasesTool } from './impl/search';
import { makeGetCasePartiesTool } from './impl/parties';
import {
  makeGetByStatusIdTool,
  makeGetBySubTypeIdTool,
  makeGetBySubStatusIdTool,
  makeGetBySubStatusId2Tool,
  makeGetByVenueIdTool,
  makeGetBySpecialInstructionTool,
  makeGetBySolDateTool,
  makeGetByBodyPartIdsTool,
  makeGetByCaseDateTool,
  makeGetByCaseTypeIdTool,
  makeGetByLastNameInitialTool,
} from './impl/filters';
import { makeGetByStaffTool } from './impl/staff';
import { makeCombinedSearchTool } from './impl/combined';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AiTool = ReturnType<typeof makeSearchCasesTool> | ReturnType<typeof makeGetCasePartiesTool> | ReturnType<typeof makeGetByStatusIdTool> | any;

export interface ToolEntry {
  definition: AiTool;
  intentTags: IntentKey[];
}

import type { DateRange } from '@/lib/dateRange';
import type { RoleSlotResolution } from '@/lib/roleSlots';

export interface RegistryDeps {
  apiBaseUrl: string;
  jwtToken: string;
  enforcedSearchType: number;
  enforcedLabel: string;
  /** Staff/applicant/none signal from the user's words — governs combinedSearch name routing. */
  personSignal?: 'staff' | 'applicant' | 'none';
  /** Person name extracted from the user's words — routed deterministically by combinedSearch. */
  personName?: string | null;
  /** CombinedFilters keys the user's words license — blocks model-invented filters. */
  allowedFilterKeys?: Set<string>;
  /** Server-computed case date range from the user's message. */
  resolvedDateRange?: DateRange | null;
  /**
   * Case-role slot (Attorney/Paralegal/…) resolved deterministically from the
   * user's own words — passed to combinedSearch/getByStaff INSTEAD OF the
   * model's own jobRole tool argument, which the model can invent (e.g. "Other
   * Attorney" the user never said), silently zeroing out the result.
   */
  resolvedRoleSlot?: RoleSlotResolution;
}

export function buildToolRegistry(deps: RegistryDeps): Map<string, ToolEntry> {
  const {
    apiBaseUrl, jwtToken, enforcedSearchType, enforcedLabel,
    personSignal = 'none', personName = null, allowedFilterKeys, resolvedDateRange = null,
    resolvedRoleSlot = null,
  } = deps;
  const fd = { apiBaseUrl, jwtToken, resolvedDateRange };

  return new Map<string, ToolEntry>([
    ['searchCases', {
      definition: makeSearchCasesTool({ apiBaseUrl, jwtToken, enforcedSearchType, enforcedLabel }),
      intentTags: ['case_search'],
    }],
    ['getCaseParties', {
      definition: makeGetCasePartiesTool(fd),
      intentTags: ['case_parties'],
    }],
    ['getByStatusId', {
      definition: makeGetByStatusIdTool(fd),
      intentTags: ['filter_status'],
    }],
    ['getBySubTypeId', {
      definition: makeGetBySubTypeIdTool(fd),
      intentTags: ['filter_sub_type'],
    }],
    ['getBySubStatusId', {
      definition: makeGetBySubStatusIdTool(fd),
      intentTags: ['filter_sub_status'],
    }],
    ['getBySubStatusId2', {
      definition: makeGetBySubStatusId2Tool(fd),
      intentTags: ['filter_sub_status2'],
    }],
    ['getByVenueId', {
      definition: makeGetByVenueIdTool(fd),
      intentTags: ['filter_venue'],
    }],
    ['getBySpecialInstruction', {
      definition: makeGetBySpecialInstructionTool(fd),
      intentTags: ['filter_special'],
    }],
    ['getBySolDate', {
      definition: makeGetBySolDateTool(fd),
      intentTags: ['filter_sol'],
    }],
    ['getByBodyPartIds', {
      definition: makeGetByBodyPartIdsTool(fd),
      intentTags: ['filter_body_part'],
    }],
    ['getByCaseDate', {
      definition: makeGetByCaseDateTool(fd),
      intentTags: ['filter_case_date'],
    }],
    ['getByCaseTypeId', {
      definition: makeGetByCaseTypeIdTool(fd),
      intentTags: ['filter_case_type'],
    }],
    ['getByLastNameInitial', {
      definition: makeGetByLastNameInitialTool(fd),
      intentTags: ['filter_last_name'],
    }],
    ['getByStaff', {
      definition: makeGetByStaffTool({ ...fd, resolvedRoleSlot }),
      intentTags: ['filter_staff'],
    }],
    ['combinedSearch', {
      definition: makeCombinedSearchTool({
        ...fd, personSignal, personName, allowedFilterKeys, resolvedDateRange, enforcedSearchType, resolvedRoleSlot,
      }),
      intentTags: [],   // selected specially when 2+ filter intents are present
    }],
  ]);
}
