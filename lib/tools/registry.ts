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
import { makeGetCaseFullDetailTool, makeGetCaseTasksTool, makeGetCaseEventsTool, makeGetCaseDocumentsTool, makeGetCaseNotesTool, makeGetCaseActivitiesTool, makeGetCaseAccountingTool } from './impl/caseDetail';

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
  /** The current chat session's opaque id — forwarded to the Phase-2 tools so
   *  getCaseDocuments' document links can be built through the authenticated
   *  download proxy (see lib/caseFullDetail.ts's buildDownloadUrl). */
  sessionId?: string;
  /** This app's own origin — see FetchCaseFullDetailOpts.appOrigin's doc comment. */
  appOrigin?: string;
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
    apiBaseUrl, jwtToken, sessionId, appOrigin, enforcedSearchType, enforcedLabel,
    personSignal = 'none', personName = null, allowedFilterKeys, resolvedDateRange = null,
    resolvedRoleSlot = null,
  } = deps;
  const fd = { apiBaseUrl, jwtToken, resolvedDateRange };
  const caseDetailDeps = { apiBaseUrl, jwtToken, sessionId, appOrigin };

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
    ['getCaseFullDetail', {
      definition: makeGetCaseFullDetailTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/caseDetail.ts, not intentRouter
    }],
    ['getCaseTasks', {
      definition: makeGetCaseTasksTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/tasks.ts, not intentRouter
    }],
    ['getCaseEvents', {
      definition: makeGetCaseEventsTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/events.ts, not intentRouter
    }],
    ['getCaseDocuments', {
      definition: makeGetCaseDocumentsTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/documents.ts, not intentRouter
    }],
    ['getCaseNotes', {
      definition: makeGetCaseNotesTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/notes.ts, not intentRouter
    }],
    ['getCaseActivities', {
      definition: makeGetCaseActivitiesTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/activities.ts, not intentRouter
    }],
    ['getCaseAccounting', {
      definition: makeGetCaseAccountingTool(caseDetailDeps),
      intentTags: [],   // selected via lib/domains/accounting.ts, not intentRouter
    }],
  ]);
}
