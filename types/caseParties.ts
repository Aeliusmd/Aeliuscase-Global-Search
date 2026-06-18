export interface CasePartyDoc {
  id: number;
  origin: number;
  name: string;
  docTypeId: number;
  docCategoryId: number;
  docSubCategoryId: number | null;
  docTypeName: string;
  doiAndAdj: number | null;
  doiValue: string | null;
}

export interface CaseParty {
  id: number;
  caseId: number;
  partyTypeId: number;
  partyTypeName: string;
  company: string;
  phone: string;
  email: string;
  associatedCaseDocs: string;
  partyDocs: CasePartyDoc[];
}

export interface CasePartiesResult {
  caseRef: string;
  parties: CaseParty[];
  partyDocs: CasePartyDoc[];
}

export interface PartiesToolOutput {
  success: boolean;
  caseRef?: string;
  parties?: CaseParty[];
  partyDocs?: CasePartyDoc[];
  error?: string;
}
