/**
 * Slim, mapped shape for GET /api/Case/GetCaseFullDetail — NOT the raw upstream
 * DTO. Verified live against UAT 2026-07-17/19 (cases RP2011, RP003583): the raw
 * response is schema-INCONSISTENT case-to-case (e.g. caseType is sometimes
 * `{id,description}`, sometimes a flat string; venue is sometimes a joined
 * `caseVenue.description`, sometimes only a raw venueId; adjNumber can be the
 * literal string "Unassigned"; applicant email was once found corrupted with a
 * language value instead of an address). lib/caseFullDetail.ts's mapper is
 * responsible for normalizing all of that into this shape — every field here is
 * already validated/normalized, so downstream code (tools, prompt) never has to
 * defensively re-check the raw upstream fields.
 */

export interface CasePersonSummary {
  name: string | null;
  nickName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CaseInjurySummary {
  bodyPartId: number | null;
  bodyPart: string | null;
  description: string | null;
  doi: string | null;
  solDate: string | null;
  adjNumber: string | null;
}

/**
 * Verified live 2026-07-19 against RP003583 (3 real tasks, since cleared/changed
 * on the shared UAT server — the raw shape was captured before that happened).
 * Raw fields NOT carried into this slim shape: newCaseId (internal FK, not
 * needed once we already have caseNumber), doi (present on the raw task row but
 * its meaning here is unclear/likely copied from the case — not surfaced to
 * avoid confusing it with case-level DOI), workflow/trigger bookkeeping fields
 * (isFromEvent, isFromWorkFlow, taskDeuDate*, triggeredWorkFlowTaskId, …),
 * documentCount/isDocumentUploaded, updatedDateTime, isDeleted (used to FILTER
 * the array, not exposed per-row).
 */
export interface CaseTaskSummary {
  id: number | null;
  title: string | null;
  /** HTML-stripped — the raw field is an HTML fragment, e.g. "<p>...</p>". */
  description: string | null;
  category: string | null;
  /** Deduped by id — the raw assignedTo[] has been observed to contain the
   *  same person twice. */
  assignedTo: string[];
  dueDate: string | null;
  status: string | null;
  priority: string | null;
  createdDate: string | null;
}

/**
 * Live-verified 2026-07-19 against 5 real populated cases (RP2021, RP2010,
 * RP2017, RP2029, RP2119 — found via a broader GetCaseListCombined sweep after
 * the first 7 cases checked all happened to have zero events). Real field
 * names are `title`/`date` — richer than the backend's own doc sample
 * (`docs/phase 02 endpoints.pdf`: id, subject, when, address), matching the
 * same pattern seen in Section 2's task schema. `notes` carries HTML,
 * stripped by the mapper same as task descriptions.
 */
export interface CaseEventSummary {
  id: number | null;
  title: string | null;
  type: string | null;
  /** Combined date+time when the source gives one field, or "date time" when
   *  it gives them separately — whatever the raw shape provides. */
  when: string | null;
  location: string | null;
  status: string | null;
  notes: string | null;
}

/**
 * Live-verified 2026-07-19 against RP2021 (199 real documents, real file URLs
 * under uatapi.aeliuscase.com/.../CaseDocFiles/...). `uploadedBy` is a PLAIN
 * STRING in the real response ("Maryanne Olivas"), not the `{id,name}` object
 * the original PM-request doc asked for — the mapper still checks both shapes
 * defensively, but the string form is the confirmed real one. `category` was
 * null on every real document seen; the field is kept in case some documents
 * do carry one.
 */
export interface CaseDocumentSummary {
  id: number | null;
  name: string | null;
  category: string | null;
  uploadedBy: string | null;
  uploadedDate: string | null;
  fileUrl: string | null;
}

/**
 * Live-verified 2026-07-19 against RP003668 (42 real notes). Real category
 * comes from `caseNoteCategory` (e.g. "General") — the flat `category` field
 * seen on the raw row is null; this answers the open question from the
 * original request doc about the notes category taxonomy. `text` carries
 * rich HTML (styled spans, links, lists) — stripped by the mapper. `doi` and
 * some other raw date fields use the sentinel placeholder `"0001-01-01..."`
 * for "no date", normalized to null same as `caseNumber`'s `"Unassigned"`.
 */
export interface CaseNoteSummary {
  id: number | null;
  subject: string | null;
  /** HTML-stripped. */
  text: string | null;
  category: string | null;
  createdBy: string | null;
  createdDate: string | null;
}

export interface CaseActivityRelatedEntity {
  type: 'note' | 'task' | 'event';
  id: number;
}

/**
 * Live-verified 2026-07-19 against RP003668 (128 real activities). The real
 * "type" field is `activityTag` (e.g. "NOTE_CREATED") — matches the spirit of
 * the original request doc's type enum (LetterCreated/DocumentUploaded/…) but
 * with different literal values. `relatedEntity` is derived from whichever of
 * `caseNoteId`/`caseTaskId`/`caseEventId` is non-null on the raw row. The raw
 * `previewHtml` field (full rendered note/email content, can be long and PII-
 * heavy) is deliberately NOT surfaced here — `description` already gives a
 * concise one-line summary ("General Note Note was inserted by Sachin Giri"),
 * consistent with the "slim projection, not the raw payload" design.
 */
export interface CaseActivitySummary {
  id: number | null;
  description: string | null;
  type: string | null;
  performedBy: string | null;
  timestamp: string | null;
  relatedEntity: CaseActivityRelatedEntity | null;
}

export interface CaseChequeRequestSummary {
  id: number | null;
  amount: number | null;
  description: string | null;
  requestedDate: string | null;
  status: string | null;
}

export interface CasePaymentSummary {
  id: number | null;
  amount: number | null;
  date: string | null;
  method: string | null;
}

export interface CaseSettlementFeeSummary {
  id: number | null;
  invoice: string | null;
  amount: number | null;
  remainingBalance: number | null;
}

/**
 * NOT live-verified against populated data — 91 real cases checked live
 * 2026-07-19 all had EMPTY accounting (`chequeRequests`, `payments`,
 * `clientCostsPaid`, `settlementFees` all `[]`), unlike every other section
 * where real data was eventually found. The top-level shape itself (these 4
 * arrays under `accounting`) IS confirmed live; the fields WITHIN each array
 * item are defensive-best-effort from the backend's own doc sample only.
 * `clientCostsPaid` reuses the payment shape (no example item was ever shown
 * for it, even in the doc sample). Financial data — the backend's own doc
 * flagged this as sensitive and must be permission-scoped SERVER-SIDE (already
 * covered by the same Bearer JWT auth every endpoint requires); no additional
 * client-side filtering is added here since the chatbot has no separate
 * notion of the caller's role.
 */
export interface CaseAccountingSummary {
  chequeRequests: CaseChequeRequestSummary[];
  payments: CasePaymentSummary[];
  clientCostsPaid: CasePaymentSummary[];
  settlementFees: CaseSettlementFeeSummary[];
}

export interface CaseFullDetailData {
  caseNumber: string | null;
  fileNumber: string | null;
  caseName: string | null;
  caseType: string | null;
  caseStatus: string | null;
  caseDate: string | null;
  venue: string | null;
  adjNumber: string | null;
  jetFileId: number | null;

  attorney: CasePersonSummary | null;
  supervisorAttorney: CasePersonSummary | null;
  coordinator: CasePersonSummary | null;
  paralegal: CasePersonSummary | null;

  applicant: {
    fullName: string | null;
    dob: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  employer: {
    company: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  insuranceCarrier: {
    company: string | null;
    phone: string | null;
    fax: string | null;
    email: string | null;
  } | null;

  defendant: {
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  injuries: CaseInjurySummary[];

  tasks: CaseTaskSummary[];
  events: CaseEventSummary[];
  documents: CaseDocumentSummary[];
  notes: CaseNoteSummary[];
  activities: CaseActivitySummary[];
  accounting: CaseAccountingSummary;
}

export interface CaseFullDetailCandidate {
  id: number | null;
  caseNumber: string | null;
  caseName: string | null;
  caseType: string | null;
  caseStatus: string | null;
}

export interface CaseFullDetailToolOutput {
  success: boolean;
  /** true when a caseName search matched more than one case — data is absent, use candidates. */
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  data?: CaseFullDetailData;
  error?: string;
}

/** getCaseTasks tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseTasksToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  tasks?: CaseTaskSummary[];
  error?: string;
}

/** getCaseEvents tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseEventsToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  events?: CaseEventSummary[];
  error?: string;
}

/** getCaseDocuments tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseDocumentsToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  documents?: CaseDocumentSummary[];
  error?: string;
}

/** getCaseNotes tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseNotesToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  notes?: CaseNoteSummary[];
  error?: string;
}

/** getCaseActivities tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseActivitiesToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  activities?: CaseActivitySummary[];
  error?: string;
}

/** getCaseAccounting tool output — a thin slice of CaseFullDetailData, not the whole thing. */
export interface CaseAccountingToolOutput {
  success: boolean;
  ambiguous?: boolean;
  candidates?: CaseFullDetailCandidate[];
  caseNumber?: string | null;
  caseName?: string | null;
  accounting?: CaseAccountingSummary;
  error?: string;
}
