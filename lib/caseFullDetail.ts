import * as http from 'node:http';
import * as https from 'node:https';
import type {
  CaseAccountingSummary,
  CaseActivitySummary,
  CaseChequeRequestSummary,
  CaseDocumentSummary,
  CaseEventSummary,
  CaseFullDetailCandidate,
  CaseFullDetailData,
  CaseFullDetailToolOutput,
  CaseInjurySummary,
  CaseNoteSummary,
  CasePaymentSummary,
  CasePersonSummary,
  CaseSettlementFeeSummary,
  CaseTaskSummary,
} from '@/types/caseFullDetail';

/**
 * GET /api/Case/GetCaseFullDetail requires the case identifier as a JSON BODY
 * on a GET request — verified live 2026-07-19 (query-string params, as the
 * backend's own doc showed, return 400 "Provide one of caseId, caseNumber or
 * caseName"). Node's spec-compliant fetch() throws "Request with GET/HEAD
 * method cannot have body" for this, so this one call uses http(s).request
 * directly instead of fetch.
 */
function httpGetWithJsonBody(
  url: string,
  headers: Record<string, string>,
  bodyObj: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(bodyObj);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
          } catch {
            reject(new Error(`Non-JSON response (status ${res.statusCode})`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Cache — module-scoped, short TTL, size-capped. Keyed per (jwt, identifier)
// since case detail is per-case (unlike caseStatus.ts's one global reference
// table). Avoids re-fetching the ~1MB response on every follow-up question
// about the same case within a short window. ──
interface CacheEntry { data: CaseFullDetailData; fetchedAt: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX_SIZE = 20;

function cacheKey(jwtToken: string, identifier: string): string {
  return `${jwtToken}:${identifier}`;
}

function cacheGet(key: string): CaseFullDetailData | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: CaseFullDetailData): void {
  if (cache.size >= CACHE_MAX_SIZE && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { data, fetchedAt: Date.now() });
}

// ── Defensive field extraction — the raw response's shape has been observed to
// DIFFER between cases (verified live 2026-07-17/19: caseType as object vs
// string, venue as joined caseVenue.description vs raw venueId, attorney via
// caseAttorneyName vs attorneyResponsibleId-only, injury body parts under
// bodyParts vs caseInjuryBodyPartsList). Every getter below tries every known
// variant and falls back to null rather than throwing or silently misreading. ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'unassigned') return null;
  return trimmed;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Same as str(), but also rejects the "0001-01-01..." sentinel placeholder
 *  date observed live on note rows (e.g. `doi`) — the backend's convention for
 *  "no date set", distinct from a real year-1 date. */
function validDate(v: unknown): string | null {
  const s = str(v);
  return s && s.startsWith('0001-01-01') ? null : s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rejects non-email-shaped values — guards against the "Mandarin Chinese" data
 *  bug found live 2026-07-17, where a language preference leaked into an email field. */
function email(v: unknown): string | null {
  const s = str(v);
  return s && EMAIL_RE.test(s) ? s : null;
}

function person(name: unknown, nickName?: unknown, emailVal?: unknown, phoneVal?: unknown): CasePersonSummary | null {
  const n = str(name);
  if (!n) return null;
  return { name: n, nickName: str(nickName), email: email(emailVal), phone: str(phoneVal) };
}

function mapCaseType(c: Raw): string | null {
  return typeof c?.caseType === 'string' ? str(c.caseType) : str(c?.caseType?.description);
}

function mapCaseStatus(c: Raw): string | null {
  return (
    str(c?.caseStatusDescription) ??
    str(c?.caseStatus?.caseStatusDescription) ??
    (typeof c?.caseStatus === 'string' ? str(c.caseStatus) : null)
  );
}

function mapVenue(c: Raw): string | null {
  return str(c?.caseVenue?.description) ?? (num(c?.venueId) !== null ? `Venue ${c.venueId}` : null);
}

function mapApplicant(caseObj: Raw, topLevel: Raw): CaseFullDetailData['applicant'] {
  const a = caseObj?.caseApplicant ?? topLevel?.applicant?.[0] ?? null;
  if (!a) return null;
  const fullName = str(a.fullName) ?? (str(a.firstName) || str(a.lastName)
    ? [str(a.firstName), str(a.lastName)].filter(Boolean).join(' ')
    : null);
  return { fullName, dob: str(a.dob), phone: str(a.phone), email: email(a.email) };
}

function mapEmployer(caseObj: Raw, topLevel: Raw): CaseFullDetailData['employer'] {
  const e = caseObj?.caseEmployee ?? topLevel?.employee?.[0] ?? null;
  if (!e) return null;
  return { company: str(e.company), address: str(e.address), phone: str(e.phone), email: email(e.email) };
}

/**
 * The `parties` array (insurance carrier, defendant, venue-as-party, …) has been
 * observed in different places live: as `case.parties` — a direct sibling of
 * `case.injury`/`case.bodyParts`, verified 2026-07-19 against RP003583 via a
 * direct Node inspection of the parsed response (a prior guess based on raw-text
 * bracket-counting alone was wrong) — and as a sibling of "case" at the top
 * level in other samples. Check every known location.
 */
function getPartiesArray(caseObj: Raw, topLevel: Raw): Raw[] {
  if (Array.isArray(caseObj?.parties)) return caseObj.parties;
  if (Array.isArray(topLevel?.parties)) return topLevel.parties;
  const injuries: Raw[] = caseObj?.injury ?? topLevel?.injury ?? [];
  for (const inj of injuries) {
    if (Array.isArray(inj?.parties)) return inj.parties;
  }
  return [];
}

function mapDefendant(caseObj: Raw, topLevel: Raw): CaseFullDetailData['defendant'] {
  const d = caseObj?.caseDefendent ??
    getPartiesArray(caseObj, topLevel).find((p: Raw) => /defendant/i.test(p?.partyTypeName ?? p?.partyType ?? '')) ??
    null;
  if (!d) return null;
  return {
    name: str(d.name) ?? str(d.company) ?? str(d.partyName),
    address: str(d.address),
    phone: str(d.phone) ?? str(d.comPhone),
    email: email(d.email),
  };
}

function mapInsuranceCarrier(caseObj: Raw, topLevel: Raw): CaseFullDetailData['insuranceCarrier'] {
  const p = getPartiesArray(caseObj, topLevel).find((x: Raw) => /insurance/i.test(x?.partyTypeName ?? x?.partyType ?? ''));
  if (!p) return null;
  return {
    company: str(p.company) ?? str(p.partyName),
    phone: str(p.comPhone) ?? str(p.phone),
    fax: str(p.fax),
    email: email(p.email),
  };
}

function mapInjuries(caseObj: Raw, topLevel: Raw): CaseInjurySummary[] {
  const injuries: Raw[] = caseObj?.injury ?? topLevel?.injury ?? [];
  const out: CaseInjurySummary[] = [];
  for (const inj of injuries) {
    const parts: Raw[] = inj?.bodyParts ?? inj?.caseInjuryBodyPartsList ?? [];
    const doi = str(inj?.doiStart);
    const solDate = str(inj?.statuteLimitation);
    const adjNumber = str(inj?.injuryAdjNo);
    if (parts.length === 0) {
      out.push({ bodyPartId: null, bodyPart: null, description: str(inj?.injuryExplain), doi, solDate, adjNumber });
      continue;
    }
    for (const part of parts) {
      out.push({
        bodyPartId: num(part?.bodyPartsId),
        bodyPart: str(part?.bodyPartValue),
        description: str(inj?.injuryExplain),
        doi,
        solDate,
        adjNumber,
      });
    }
  }
  return out;
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Strips HTML tags AND decodes common entities — found live 2026-07-19 on
 *  RP003668's notes: tag-stripping alone left literal "&nbsp;" in the output
 *  text shown to the model/user. */
function stripHtml(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const noTags = s.replace(/<[^>]*>/g, '');
  const decoded = noTags.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENTITIES[m]);
  const stripped = decoded.trim();
  return stripped === '' ? null : stripped;
}

/** Tasks live at the top level, sibling of "case" (data.tasks) — confirmed live
 *  2026-07-19, unlike injury/parties which live inside "case". Soft-deleted rows
 *  (isDeleted: true) are filtered out; assignedTo is deduped by id (the raw
 *  array has been observed to list the same person twice). */
function mapTasks(topLevel: Raw): CaseTaskSummary[] {
  const tasks: Raw[] = topLevel?.tasks ?? [];
  const out: CaseTaskSummary[] = [];
  for (const t of tasks) {
    if (t?.isDeleted === true) continue;
    const seen = new Set<number>();
    const assignedTo: string[] = [];
    for (const a of t?.assignedTo ?? []) {
      const name = str(a?.name);
      const id = num(a?.id);
      if (!name) continue;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      assignedTo.push(name);
    }
    out.push({
      id: num(t?.id),
      title: str(t?.title),
      description: stripHtml(t?.description),
      category: str(t?.category),
      assignedTo,
      dueDate: str(t?.dueDate),
      status: str(t?.status),
      priority: str(t?.priority),
      createdDate: str(t?.createdDate),
    });
  }
  return out;
}

/** Combines separate date+time fields into one "when" string when the source
 *  splits them, or uses a single combined field directly when it doesn't —
 *  handles both shapes since this hasn't been live-verified against populated
 *  data (see CaseEventSummary doc comment). */
function deriveWhen(e: Raw): string | null {
  const when = str(e?.when) ?? str(e?.date);
  const time = str(e?.time);
  if (when && time && !when.includes(time)) return `${when} ${time}`;
  return when;
}

/** Live-verified 2026-07-19 against 5 real cases with real events (RP2021,
 *  RP2010, RP2017, RP2029, RP2119) — the real field names are `title` (not
 *  `subject`) and `date` (not `when`), matching the Section 2 task schema's
 *  pattern of being richer than the backend's own doc sample. `notes` carries
 *  HTML (e.g. "<p>Kase Intake by ...</p>"), same as task descriptions.
 *  `location` is often an empty string, correctly normalized to null. Events
 *  live at the top level, sibling of "case" (data.events), same as tasks. */
function mapEvents(topLevel: Raw): CaseEventSummary[] {
  const events: Raw[] = topLevel?.events ?? [];
  const out: CaseEventSummary[] = [];
  for (const e of events) {
    if (e?.isDeleted === true) continue;
    out.push({
      id: num(e?.id),
      title: str(e?.title) ?? str(e?.subject),
      type: str(e?.type),
      when: deriveWhen(e),
      location: str(e?.location) ?? str(e?.address),
      status: str(e?.status),
      notes: stripHtml(e?.notes),
    });
  }
  return out;
}

/** Live-verified 2026-07-19 against RP2021 (199 real documents). `uploadedBy`
 *  is a plain string in the real response, not the {id,name} object the
 *  original PM-request doc asked for — both are still checked defensively.
 *  Documents live at the top level, sibling of "case" (data.documents). */
function mapDocuments(topLevel: Raw): CaseDocumentSummary[] {
  const documents: Raw[] = topLevel?.documents ?? [];
  const out: CaseDocumentSummary[] = [];
  for (const d of documents) {
    if (d?.isDeleted === true) continue;
    out.push({
      id: num(d?.id),
      name: str(d?.name) ?? str(d?.fileName),
      category: str(d?.category),
      uploadedBy: typeof d?.uploadedBy === 'string' ? str(d.uploadedBy) : str(d?.uploadedBy?.name),
      uploadedDate: str(d?.uploadedDate) ?? str(d?.uploadDate),
      fileUrl: str(d?.fileUrl) ?? str(d?.fileLocation),
    });
  }
  return out;
}

/** Live-verified 2026-07-19 against RP003668 (42 real notes). Real category
 *  comes from `caseNoteCategory` (the flat `category` field is null on real
 *  rows) — resolves the original request doc's open question about the notes
 *  category taxonomy: it's a free-form string ("General" seen live), not a
 *  fixed enum. `createdBy` is a {id,name,nickName} object. `noteDate` is
 *  preferred over `createdDate` (both were identical on every real row seen,
 *  but noteDate is the more semantically correct one). Notes live at the top
 *  level, sibling of "case" (data.notes). */
function mapNotes(topLevel: Raw): CaseNoteSummary[] {
  const notes: Raw[] = topLevel?.notes ?? [];
  const out: CaseNoteSummary[] = [];
  for (const n of notes) {
    if (n?.isDeleted === true) continue;
    out.push({
      id: num(n?.id),
      subject: str(n?.subject),
      text: stripHtml(n?.text),
      category: str(n?.caseNoteCategory) ?? str(n?.category) ?? str(n?.noteType),
      createdBy: str(n?.createdBy?.name) ?? (typeof n?.createdBy === 'string' ? str(n.createdBy) : null),
      createdDate: validDate(n?.noteDate) ?? validDate(n?.createdDate),
    });
  }
  return out;
}

/** Derives which related record (note/task/event) this activity is linked to,
 *  from whichever of caseNoteId/caseTaskId/caseEventId is non-null on the raw
 *  row — the raw response never sets more than one at a time. */
function deriveRelatedEntity(a: Raw): CaseActivitySummary['relatedEntity'] {
  const noteId = num(a?.caseNoteId);
  if (noteId !== null) return { type: 'note', id: noteId };
  const taskId = num(a?.caseTaskId);
  if (taskId !== null) return { type: 'task', id: taskId };
  const eventId = num(a?.caseEventId);
  if (eventId !== null) return { type: 'event', id: eventId };
  return null;
}

/** Live-verified 2026-07-19 against RP003668 (128 real activities). Real
 *  "type" is `activityTag` (e.g. "NOTE_CREATED"). `performedBy` is a
 *  {id,name,nickName} object (id often null) with a redundant flat `createdBy`
 *  string fallback. `previewHtml` (full rendered content) is deliberately not
 *  mapped — see CaseActivitySummary doc comment. Activities live at the top
 *  level, sibling of "case" (data.activities), sorted most-recent-first in the
 *  raw response (not re-sorted here). */
function mapActivities(topLevel: Raw): CaseActivitySummary[] {
  const activities: Raw[] = topLevel?.activities ?? [];
  const out: CaseActivitySummary[] = [];
  for (const a of activities) {
    if (a?.isDeleted === true) continue;
    out.push({
      id: num(a?.id),
      description: str(a?.description),
      type: str(a?.activityTag) ?? str(a?.type),
      performedBy: str(a?.performedBy?.name) ?? str(a?.createdBy),
      timestamp: str(a?.timestamp) ?? str(a?.createdDateTime),
      relatedEntity: deriveRelatedEntity(a),
    });
  }
  return out;
}

function mapChequeRequest(r: Raw): CaseChequeRequestSummary {
  return {
    id: num(r?.id),
    amount: num(r?.amount),
    description: str(r?.description) ?? str(r?.purpose),
    requestedDate: str(r?.requestedDate) ?? str(r?.date),
    status: str(r?.status),
  };
}

function mapPayment(r: Raw): CasePaymentSummary {
  return {
    id: num(r?.id),
    amount: num(r?.amount),
    date: str(r?.transactionDate) ?? str(r?.date),
    method: str(r?.method),
  };
}

function mapSettlementFee(r: Raw): CaseSettlementFeeSummary {
  return {
    id: num(r?.id),
    invoice: str(r?.invoice),
    amount: num(r?.amount),
    remainingBalance: num(r?.remainingBalance),
  };
}

/** NOT live-verified against populated data — see CaseAccountingSummary doc
 *  comment (91 real cases checked live 2026-07-19 all had empty accounting).
 *  The top-level 4-array shape itself IS confirmed live; field names WITHIN
 *  each row are defensive-best-effort from the backend's own doc sample.
 *  Accounting lives at the top level, sibling of "case" (data.accounting), as
 *  a single object (not an array). */
function mapAccounting(topLevel: Raw): CaseAccountingSummary {
  const acc: Raw = topLevel?.accounting ?? {};
  return {
    chequeRequests: (acc?.chequeRequests ?? []).map(mapChequeRequest),
    payments: (acc?.payments ?? []).map(mapPayment),
    clientCostsPaid: (acc?.clientCostsPaid ?? []).map(mapPayment),
    settlementFees: (acc?.settlementFees ?? []).map(mapSettlementFee),
  };
}

export function mapCaseFullDetail(topLevel: Raw): CaseFullDetailData {
  const c: Raw = topLevel?.case ?? {};
  return {
    caseNumber: str(c.caseNumber),
    fileNumber: str(c.fileNumber),
    caseName: str(c.caseName) ?? str(c.displayNameForCaseSearch),
    caseType: mapCaseType(c),
    caseStatus: mapCaseStatus(c),
    caseDate: str(c.caseDate),
    venue: mapVenue(c),
    adjNumber: str(c.adjNumber),
    jetFileId: num(c.jetFileId),

    attorney: person(c.caseAttorneyName, c.caseAttorneyNikeName),
    supervisorAttorney: person(c.caseSupervisorAttorneyName, c.caseSupervisorAttorneyNikeName),
    coordinator: person(c.caseCoordinatorName, c.caseCoordinatorNikeName),
    paralegal: person(c.caseParaLegalName, c.caseParaLegalNikeName),

    applicant: mapApplicant(c, topLevel),
    employer: mapEmployer(c, topLevel),
    insuranceCarrier: mapInsuranceCarrier(c, topLevel),
    defendant: mapDefendant(c, topLevel),

    injuries: mapInjuries(c, topLevel),

    tasks: mapTasks(topLevel),
    events: mapEvents(topLevel),
    documents: mapDocuments(topLevel),
    notes: mapNotes(topLevel),
    activities: mapActivities(topLevel),
    accounting: mapAccounting(topLevel),
  };
}

function mapCandidate(c: Raw): CaseFullDetailCandidate {
  return {
    id: num(c?.id),
    caseNumber: str(c?.caseNumber),
    caseName: str(c?.caseName),
    caseType: typeof c?.caseType === 'string' ? str(c.caseType) : str(c?.caseType?.description),
    caseStatus: typeof c?.caseStatus === 'string' ? str(c.caseStatus) : str(c?.caseStatus?.caseStatusDescription),
  };
}

export interface FetchCaseFullDetailOpts {
  apiBaseUrl: string;
  jwtToken: string;
  caseNumber?: string;
  caseId?: number;
  caseName?: string;
}

export async function fetchCaseFullDetail(opts: FetchCaseFullDetailOpts): Promise<CaseFullDetailToolOutput> {
  const { apiBaseUrl, jwtToken, caseNumber, caseId, caseName } = opts;
  if (caseNumber === undefined && caseId === undefined && caseName === undefined) {
    return { success: false, error: 'Provide caseNumber, caseId, or caseName.' };
  }

  const identifier = caseNumber ?? caseName ?? `case-${caseId}`;
  const key = cacheKey(jwtToken, identifier);
  const cached = cacheGet(key);
  if (cached) return { success: true, data: cached };

  // The model frequently supplies a GUESSED caseId alongside a correct
  // caseNumber (e.g. caseId: 2021 parsed from "RP2021", which is not the
  // real internal ID) — live-verified 2026-07-19 that the backend requires
  // every supplied identifier to resolve to the SAME case, so a wrong
  // guessed caseId turns an otherwise-correct caseNumber lookup into a 404
  // ("No case matched the supplied caseId/caseNumber/caseName"). caseNumber
  // and caseName are already unambiguous on their own, so caseId is only
  // ever sent when it's the sole identifier provided.
  const resolvedCaseId = caseNumber === undefined && caseName === undefined ? caseId : undefined;

  try {
    const { status, json } = await httpGetWithJsonBody(
      `${apiBaseUrl}/api/Case/GetCaseFullDetail`,
      { Authorization: `Bearer ${jwtToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      { caseNumber, caseId: resolvedCaseId, caseName },
    );

    if (status < 200 || status >= 300) {
      return { success: false, error: `API error ${status}` };
    }

    const body = json as Raw;
    if (body?.succeeded === false) {
      return { success: false, error: body?.message ?? `API error ${status}` };
    }

    const inner = body?.data;
    if (inner?.isAmbiguous) {
      return { success: false, ambiguous: true, candidates: (inner.candidates ?? []).map(mapCandidate) };
    }
    if (!inner?.data) {
      return { success: false, error: `Case "${identifier}" not found.` };
    }

    const mapped = mapCaseFullDetail(inner.data);
    cacheSet(key, mapped);
    return { success: true, data: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return { success: false, error: message };
  }
}
