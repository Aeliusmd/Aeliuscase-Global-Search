export enum MainSearchType {
  AllCases = 1,
  OpenCases = 2,
  ClosedCases = 3,
  SubOutCases = 4,
}

export interface CaseApplicant {
  firstName: string;
  lastName: string;
  fullName: string;
  dob?: string;
  phone?: string;
}

export interface CaseSearchItem {
  id: number;
  caseNumber: string;
  fileNumber: string;
  caseName: string;
  caseTypeId: number;
  caseType: string;
  caseStatusDescription: string;
  caseAttorneyNickName: string;
  caseCoordinatorNickName: string;
  createdDateTime: string;
  caseApplicant: CaseApplicant | null;
  caseEmployee: { company: string } | null;
}

export interface PagedApiResponse<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  hasMorePages: boolean;
  status: number;
  succeeded: boolean;
  message: string | null;
  errors: string | null;
  data: T[];
}

export interface CaseSearchParams {
  searchText: string;
  searchType?: MainSearchType;
  page?: number;
  pageSize?: number;
}
