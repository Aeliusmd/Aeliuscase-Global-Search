import type { CaseSearchItem } from './case';

export interface NewCaseDTO {
  id: number;
  caseNumber: string;
  fileNumber?: string;
  caseName?: string;
  caseTypeId?: number;
  caseType?: string;
  caseStatusId?: number;
  caseStatusDescription?: string;
  caseSubTypeId?: number;
  caseSubStatusId?: number;
  caseSubStatusId2?: number;
  venueId?: number;
  specialInstructions?: string;
  createdDateTime?: string;
  caseAttorneyName?: string;
  caseAttorneyNickName?: string;
  caseCoordinatorNickName?: string;
  displayNameForCaseSearch?: string;
  caseApplicant?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    dob?: string;
    phone?: string;
  } | null;
  caseEmployee?: { company?: string } | null;
  caseVenue?: { venueName?: string } | null;
  /** Per-injury claims, each with its own statute-of-limitations date. A case can
   *  have several (see lib/caseFilters.ts's SOL client-side re-filter). */
  injury?: { statuteLimitation?: string }[];
}

/**
 * The newer Case-filter endpoints (GetCaseListByCaseDate / CaseTypeId /
 * LastNameInitial / StaffId) wrap their result in `data.cases` with real
 * server-side pagination — unlike the older filters which return a flat array.
 */
export interface NestedCaseListData {
  cases?: NewCaseDTO[];
  totalRecords?: number;
  totalPages?: number;
  hasMorePages?: boolean;
  page?: number;
  pageSize?: number;
}

/** One row returned by POST /api/Staff/Search (returned directly, not the Case envelope). */
export interface StaffItem {
  id: number;
  name: string;
  nickname?: string;
  jobRole?: string;
  status?: string;
}

export interface FilterToolOutput {
  success: boolean;
  filterType: string;
  filterLabel: string;
  filterValue: string;
  cases: CaseSearchItem[];
  totalRecords: number;
  totalPages: number;
  hasMorePages: boolean;
  page: number;
  error?: string;
}
