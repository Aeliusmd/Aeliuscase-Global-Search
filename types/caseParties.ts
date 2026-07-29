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

/**
 * Live UAT data quality issue (2026-07-29, case AE-00224) — this case's real
 * party list has 10+ separate rows all typed "Applicant Attorney" (test/junk
 * partyName values like "fdsfs"), which is genuine upstream data, not a
 * mapping bug — but listing all 10+ rows one-by-one in a chat reply is
 * unreadable. partyGroups collapses same-partyType rows into one summary
 * (count + a capped list of unique names) so the model can answer
 * "Applicant Attorney (12 entries)" instead of 12 near-duplicate lines.
 */
export interface CasePartyGroup {
  partyType: string;
  count: number;
  /** Unique, non-empty partyName values for this type, capped at 5. */
  names: string[];
  /** True when more unique names exist beyond the 5 shown in `names`. */
  truncated: boolean;
}

/**
 * A caseName search can match more than one case (unlike caseNumber, which is
 * unique) — mirrors CaseFullDetailCandidate's shape (types/caseFullDetail.ts)
 * so the model handles both tools' ambiguous results the same way.
 */
export interface CasePartyCandidate {
  id: number | null;
  caseNumber: string | null;
  caseName: string | null;
  caseType: string | null;
  caseStatus: string | null;
}

export interface CasePartiesResult {
  caseRef: string;
  parties: CaseParty[];
  partyDocs: CasePartyDoc[];
  partyGroups: CasePartyGroup[];
}

export interface PartiesToolOutput {
  success: boolean;
  /** true when a caseName search matched more than one case — data is absent, use candidates. */
  ambiguous?: boolean;
  candidates?: CasePartyCandidate[];
  caseRef?: string;
  parties?: CaseParty[];
  partyDocs?: CasePartyDoc[];
  partyGroups?: CasePartyGroup[];
  error?: string;
}
