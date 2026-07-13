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

/**
 * Verified 2026-07-13 against the live GetAllPartiesWithDocsbyCaseId response —
 * these 3 fields are ALL that endpoint actually returns per party (no id,
 * caseId, phone, or email). Do not add fields back without re-verifying against
 * a real response; the previous CaseParty shape was never checked and silently
 * mismatched, which is why the Parties card rendered every field blank.
 */
export interface CaseParty {
  partyType: string;
  partyName: string;
  /** Every case sampled this session returned an empty array — the shape of a
   *  populated entry is unverified, so CasePartyDoc's field names below are a
   *  best-effort guess, not confirmed against real data. */
  docs: CasePartyDoc[];
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
