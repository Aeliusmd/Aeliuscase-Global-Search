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
  CaseContactSummary,
  CaseTaskSummary,
} from '@/types/caseFullDetail';
import { sanitizeUpstreamError } from '@/lib/caseSearch';

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

/**
 * A case can have a `caseNumber` and a `fileNumber` that differ ONLY by
 * formatting (e.g. "AE-00224" vs "AE00224") — live-verified 2026-07-29. The
 * dashboard's own case-list/search UI displays `fileNumber` in its "CASE #"
 * column, so a real client naturally types exactly what they see there — but
 * GetCaseFullDetail's `caseNumber` parameter only exact-matches the
 * `caseNumber` field, not `fileNumber`, so that same string 404s ("No case
 * matched...") even though the case genuinely exists. Confirmed live: GET
 * with caseNumber="AE-00224" (the real caseNumber) succeeds; caseNumber=
 * "AE00224" (the real fileNumber, same case) 404s at the backend itself.
 *
 * lib/caseParties.ts's resolveCaseId() already solves exactly this ambiguity
 * for the getCaseParties path (checks caseNumber OR fileNumber via a search);
 * this is the same fix, scoped to this module rather than sharing that
 * function, to keep the two call paths' error handling independent.
 */
async function resolveCaseNumber(
  apiBaseUrl: string,
  jwtToken: string,
  identifier: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/Case/GetCaseListCombined`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      // Wide enough that an exact match can't be pushed off the page by its
      // own sub-cases: case AE-00224 provably coexists with AE-00224-1
      // through AE-00224-5 in this dataset, all of which a prefix search can
      // return alongside it.
      body: JSON.stringify({ searchText: identifier.trim(), page: 1, pageSize: 25 }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { cases?: { caseNumber?: string; fileNumber?: string }[] } };
    const cases = json?.data?.cases ?? [];
    const want = identifier.trim().toLowerCase();
    const match = cases.find(
      (c) => c.caseNumber?.toLowerCase() === want || c.fileNumber?.toLowerCase() === want,
    );
    return match?.caseNumber ?? null;
  } catch {
    return null;
  }
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

/**
 * Live bug (2026-07-27, case RP003668) — falling straight to `Venue ${venueId}`
 * (e.g. "Venue 13") whenever `caseVenue` is absent, even though the real venue
 * name is available as a "Venue"-type party row in `parties` (e.g. "Riverside
 * district office") — the same place insuranceCarrier/defendant already look.
 * Checking the parties array first fixes this without touching the two
 * existing fallbacks (still used when no Venue party row exists).
 */
function mapVenue(caseObj: Raw, topLevel: Raw): string | null {
  const venueParty = findPopulatedParty(getPartiesArray(caseObj, topLevel), /venue/i);
  return (
    str(venueParty?.company) ??
    str(caseObj?.caseVenue?.description) ??
    (num(caseObj?.venueId) !== null ? `Venue ${caseObj.venueId}` : null)
  );
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

/**
 * Live bug (2026-07-27, case WC00549) — a case can have MORE THAN ONE party
 * row of the same partyType (e.g. two "Insurance Carrier" rows: one an empty
 * placeholder, one with the real company/phone). A plain .find() locks onto
 * whichever comes first in the array — here that was the empty one, silently
 * dropping the real "APPLIED RISK OMAHA" data. Preferring the first row that
 * actually carries a name/company fixes this while still falling back to the
 * first match (of any) when every row of that type is empty.
 */
function findPopulatedParty(parties: Raw[], typeRe: RegExp): Raw | undefined {
  const matches = parties.filter((p: Raw) => typeRe.test(p?.partyTypeName ?? p?.partyType ?? ''));
  const populated = matches.find((p: Raw) => str(p?.company) !== null || str(p?.name) !== null || str(p?.partyName) !== null);
  return populated ?? matches[0];
}

function joinName(first: unknown, last: unknown): string | null {
  const parts = [str(first), str(last)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * One slim row per party on the case — the ROLE, the firm, and the contact
 * PERSON at that firm.
 *
 * Live gap closed 2026-08-25. Asked "who is the defense attorney", the best we
 * could answer was the firm, "ASDFE", because the standalone parties endpoint
 * (/api/CaseParties/GetAllPartiesWithDocsbyCaseId) returns only partyType,
 * partyName and docs. The person the dashboard shows next to it — "heheh
 * fsdfsaf" — is in GetCaseFullDetail's own nested case.parties[] instead,
 * under defAttyFirstName/defAttyLastName. Same case, different endpoint.
 *
 * ‼️ Those nested rows carry 150+ raw fields including defendantSsn,
 * defendantDob, dlNumber, birthCity and genderId. This is therefore a STRICT
 * ALLOWLIST of five fields, never a spread — the same discipline (and the same
 * reason) as the party projection in lib/caseParties.ts, which exists because
 * a raw spread leaked SSN and DOB to the model in July.
 *
 * A "Defense Attorney" row keeps its person under the defAtty* prefix; every
 * other role uses the generic firstName/lastName, so both are read. Rows with
 * neither a person nor a firm are placeholders and are dropped.
 */
function mapContacts(parties: Raw[]): CaseContactSummary[] {
  const out: CaseContactSummary[] = [];
  for (const p of parties) {
    const partyType = str(p?.partyTypeName) ?? str(p?.partyType);
    if (!partyType) continue;

    const contactName = joinName(p?.defAttyFirstName, p?.defAttyLastName)
      ?? joinName(p?.firstName, p?.lastName);
    const company = str(p?.company) ?? str(p?.partyName);
    if (!contactName && !company) continue;

    out.push({
      partyType,
      company,
      contactName,
      phone: str(p?.defAttyPhone) ?? str(p?.phone) ?? str(p?.comPhone),
      email: email(p?.defAttyEmail) ?? email(p?.attyEmail) ?? email(p?.email),
    });
  }
  return out;
}

function mapDefendant(caseObj: Raw, topLevel: Raw): CaseFullDetailData['defendant'] {
  const d = caseObj?.caseDefendent ??
    findPopulatedParty(getPartiesArray(caseObj, topLevel), /defendant/i) ??
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
  const p = findPopulatedParty(getPartiesArray(caseObj, topLevel), /insurance/i);
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
  // Some activity descriptions carry an inline handler whose ARGUMENTS sit
  // outside the tag, e.g. `<a onclick=window.getAccessUrl(780,6)>Letter</a>`
  // renders (unhelpfully) as "(780,6)Letter" once the tags go, and the model
  // then emitted it as a markdown link target — "[here](780,6)", a dead link
  // (live 2026-08-19). Drop the orphaned call arguments with the tag.
  const noHandlers = s.replace(/<a\b[^>]*?\b(?:on\w+\s*=\s*)?[\w.]*\(\s*[\d\s,]*\)[^>]*>/gi, '<a>');
  const noTags = noHandlers.replace(/<[^>]*>/g, '');
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

/**
 * Neither the raw fileUrl (direct file-storage path) nor a bare
 * GetFilByPath/GetFirmDocFile backend URL can be used as a document's link:
 * - The raw path 404s straight from the browser — live-verified 2026-07-28.
 * - Every backend file endpoint requires a header-based Bearer JWT (confirmed
 *   via the backend's own Swagger spec: global `security` requirement, no
 *   per-endpoint override, no query-string API-key alternative) — a plain
 *   `<a href>` click can never attach that header, so ANY direct backend URL
 *   401s regardless of encoding. Reproduced live against both GetFilByPath
 *   and GetFirmDocFile.
 *
 * The fix is our OWN authenticated proxy (app/api/documents/download). The
 * URL built here carries ONLY docId/docCategory — no session identifier —
 * so it's stable forever once stored in a chat message. Auth happens at
 * CLICK TIME instead: MessageBubble.tsx intercepts a click on this link and
 * fetches it with the browser's CURRENT live X-Session-Id header (see
 * middleware.ts, now covering this route), the same pattern
 * CaseResultList.tsx already uses for pagination. Live bug fixed 2026-07-29
 * — the earlier design embedded the sessionId IN the URL, which is only
 * valid for that session's ~1h lifetime: a document link opened the next day
 * (a perfectly normal thing to do with chat history) 401'd even though the
 * user's CURRENT session was fine.
 *
 * GetFirmDocFile's `docCategory` is the raw row's `origin` field (NOT
 * `docCategoryId`, which is unrelated — it holds the same value across
 * documents that need different docCategory values).
 *
 * Its `docId` is the raw row's `id` field, NOT the row's own `docId` field.
 * These are equal on most rows (live: 66 of 68 on case 224 — every origin
 * 2/3/4 row), which is exactly what made this easy to get wrong: the
 * dashboard's `compositeKey` is "{docId}_{origin}", so `docId` looks right.
 * But on origin=1 (batch-scan/"BSCN") rows the two genuinely differ, and
 * only `id` works — live-verified both ways on case 224: docId 607/405 both
 * returned 500, while their `id` values 123/111 returned real PDFs (200).
 */
function buildDownloadUrl(
  id: number | null,
  origin: number | null,
  appOrigin: string | undefined,
): string | null {
  // A relative URL here ("/api/documents/download?...") renders fine in our
  // own custom markdown link parser, but the MODEL, when writing the
  // markdown `[label](url)` itself, was live-observed (2026-07-28) inventing
  // a fake "https://your-domain.com/..." host for it instead of leaving it
  // relative — an always-broken link. Building a full absolute URL
  // server-side (using the incoming request's own origin, so it's correct
  // in every environment) removes the model's opportunity to guess wrong.
  if (id === null || origin === null || !appOrigin) return null;
  return `${appOrigin}/api/documents/download?docId=${id}&docCategory=${origin}`;
}

/** Live-verified 2026-07-19 against RP2021 (199 real documents). `uploadedBy`
 *  is a plain string in the real response, not the {id,name} object the
 *  original PM-request doc asked for — both are still checked defensively.
 *  Documents live at the top level, sibling of "case" (data.documents).
 *  `appOrigin` is optional so existing direct-fixture tests (which assert
 *  the raw fileUrl unchanged when it's absent) keep working — only
 *  fetchCaseFullDetail's real call site passes it, to build the proxied
 *  download link (see buildDownloadUrl). Falls back to the raw fileUrl when
 *  appOrigin is absent OR the row is missing id/origin (defensive — should
 *  not happen for a real document, but never worse than the old raw-url
 *  behavior). */
function mapDocuments(topLevel: Raw, appOrigin?: string): CaseDocumentSummary[] {
  const documents: Raw[] = topLevel?.documents ?? [];
  const out: CaseDocumentSummary[] = [];
  for (const d of documents) {
    if (d?.isDeleted === true) continue;
    const rawFileUrl = str(d?.fileUrl) ?? str(d?.fileLocation);
    out.push({
      id: num(d?.id),
      name: str(d?.name) ?? str(d?.fileName),
      category: str(d?.category),
      uploadedBy: typeof d?.uploadedBy === 'string' ? str(d.uploadedBy) : str(d?.uploadedBy?.name),
      uploadedDate: str(d?.uploadedDate) ?? str(d?.uploadDate),
      fileUrl: buildDownloadUrl(num(d?.id), num(d?.origin), appOrigin) ?? rawFileUrl,
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
      // stripHtml, not str — activity descriptions carry real markup
      // (`<b>…</b>`, `<a onclick=…>`), which reached the model verbatim and
      // came back out as a dead markdown link (live 2026-08-19). Every other
      // rich-text field in this mapper is already stripped.
      description: stripHtml(a?.description),
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

/** The case-level jetFileId is not authoritative for submission history: live
 * AE-00224 has successful rows here while case.jetFileId is null. Use the
 * earliest successful submission timestamp, not a document upload date. */
function mapJetFileSubmissionDate(topLevel: Raw): string | null {
  const submissions: Raw[] = topLevel?.eamsSubmissions ?? [];
  const successfulDates = submissions
    .filter((row) => str(row?.jetfileId) !== null || num(row?.appStatus) === 3)
    .map((row) => str(row?.createdDateTime) ?? str(row?.appFilingDate))
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return successfulDates[0] ?? null;
}

/**
 * The dashboard URL for this case — the same link Phase-1's result cards
 * already build (see components/home/CaseCard.tsx). Phase-2 answers had no
 * case link of their own, so when a user asked for "a link to the case" the
 * model fabricated one, handing back a DOCUMENT DOWNLOAD url dressed up as the
 * case link (live 2026-08-19). Supplying the real one removes the temptation.
 *
 * Returns null when the app base URL isn't configured or the case has no id,
 * so the prompt can tell the model to say it has no link rather than invent
 * one from a half-built string.
 */
function buildCaseUrl(caseId: number | null): string | null {
  const base = process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/+$/, '');
  if (!base || caseId === null) return null;
  return `${base}/dashboard/case-overview/${caseId}`;
}

export function mapCaseFullDetail(topLevel: Raw, appOrigin?: string): CaseFullDetailData {
  const c: Raw = topLevel?.case ?? {};
  return {
    caseId: num(c.id),
    caseUrl: buildCaseUrl(num(c.id)),
    caseNumber: str(c.caseNumber),
    fileNumber: str(c.fileNumber),
    caseName: str(c.caseName) ?? str(c.displayNameForCaseSearch),
    caseType: mapCaseType(c),
    caseStatus: mapCaseStatus(c),
    caseDate: str(c.caseDate),
    venue: mapVenue(c, topLevel),
    adjNumber: str(c.adjNumber),
    jetFileId: num(c.jetFileId),
    jetFileSubmissionDate: mapJetFileSubmissionDate(topLevel),

    attorney: person(c.caseAttorneyName, c.caseAttorneyNikeName),
    supervisorAttorney: person(c.caseSupervisorAttorneyName, c.caseSupervisorAttorneyNikeName),
    coordinator: person(c.caseCoordinatorName, c.caseCoordinatorNikeName),
    paralegal: person(c.caseParaLegalName, c.caseParaLegalNikeName),
    contacts: mapContacts(getPartiesArray(c, topLevel)),

    applicant: mapApplicant(c, topLevel),
    employer: mapEmployer(c, topLevel),
    insuranceCarrier: mapInsuranceCarrier(c, topLevel),
    defendant: mapDefendant(c, topLevel),

    injuries: mapInjuries(c, topLevel),

    tasks: mapTasks(topLevel),
    events: mapEvents(topLevel),
    documents: mapDocuments(topLevel, appOrigin),
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

/**
 * The dedicated case-documents endpoint (POST /api/CaseDocs) the dashboard's
 * own Docs tab uses — see the call site in fetchCaseFullDetail for why
 * GetCaseFullDetail's embedded documents array can't be trusted on its own.
 *
 * pageSize 200 (vs the dashboard's own 50) fetches every document in one
 * call for realistic case sizes — live-verified against a 68-document case
 * (totalPages went 2 -> 1, 68KB response). A case with more than 200
 * documents would still be truncated; that's an accepted limit here rather
 * than paginating, since the chatbot summarizes rather than paginates, and
 * 200 is already far past what a chat answer usefully lists.
 */
const CASE_DOCS_PAGE_SIZE = 200;

async function fetchCaseDocsList(
  apiBaseUrl: string,
  jwtToken: string,
  caseId: number,
): Promise<Raw[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/CaseDocs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ caseId, page: 1, pageSize: CASE_DOCS_PAGE_SIZE }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Raw;
    const items = json?.data?.items;
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

export interface FetchCaseFullDetailOpts {
  apiBaseUrl: string;
  jwtToken: string;
  caseNumber?: string;
  caseId?: number;
  caseName?: string;
  /** This app's own origin (scheme+host), used to build an ABSOLUTE download
   *  URL for each document — a relative one lets the model invent a wrong
   *  fake host when it writes the markdown link itself (live bug,
   *  2026-07-28). Optional so non-chat callers (tests, scripts) keep getting
   *  the raw fileUrl unchanged. */
  appOrigin?: string;
}

type FullDetailAttempt =
  | { kind: 'success'; data: CaseFullDetailData }
  | { kind: 'ambiguous'; candidates: CaseFullDetailCandidate[] }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/** One GetCaseFullDetail call + the documents re-fetch/mapping that already
 *  followed it — extracted so fetchCaseFullDetail can retry it once with a
 *  resolved caseNumber (see resolveCaseNumber's doc comment) without
 *  duplicating the success-path logic. */
async function attemptFetchCaseFullDetail(
  apiBaseUrl: string,
  jwtToken: string,
  args: { caseNumber?: string; caseId?: number; caseName?: string },
  appOrigin: string | undefined,
): Promise<FullDetailAttempt> {
  const { status, json } = await httpGetWithJsonBody(
    `${apiBaseUrl}/api/Case/GetCaseFullDetail`,
    { Authorization: `Bearer ${jwtToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    args,
  );

  // Live bug fixed 2026-07-29: the backend answers "case not found" with an
  // actual HTTP 404 (not a 200 with an empty/succeeded:false body), so this
  // status check — which ran BEFORE the !inner?.data check below — was
  // classifying every not-found case as a generic 'error', never 'not-found'.
  // That silently disabled the caseNumber/fileNumber fallback below: it
  // could never fire because its trigger condition never occurred.
  if (status === 404) {
    return { kind: 'not-found' };
  }
  if (status < 200 || status >= 300) {
    return { kind: 'error', message: `API error ${status}` };
  }

  const body = json as Raw;
  if (body?.succeeded === false) {
    return { kind: 'error', message: sanitizeUpstreamError(body?.message, 'caseFullDetail') };
  }

  const inner = body?.data;
  if (inner?.isAmbiguous) {
    return { kind: 'ambiguous', candidates: (inner.candidates ?? []).map(mapCandidate) };
  }
  if (!inner?.data) {
    return { kind: 'not-found' };
  }

  const mapped = mapCaseFullDetail(inner.data, appOrigin);

  // GetCaseFullDetail's OWN documents array is unreliable — live-verified
  // 2026-07-28 that case AE-00224 (internal id 224) returns documents: []
  // from it despite genuinely having 68 documents (its tasks/events/notes
  // came back empty too, while activities returned 989, so it looks like a
  // partial-payload issue on a large case rather than a permission one).
  // Other cases (e.g. AE005) DO get a correct documents array from it, so
  // the failure is silent and case-dependent — the chatbot simply reported
  // "no documents on file" for a case with 68 of them.
  //
  // POST /api/CaseDocs is the dedicated, paginated endpoint the dashboard's
  // own Docs tab uses, and it returns all 68 correctly. Its item shape is
  // the same one mapDocuments already handles (docId/origin/name/fileName/
  // uploadedBy/uploadDate/fileLocation), so the rows just get re-mapped.
  // Best-effort: any failure leaves GetCaseFullDetail's own array in place,
  // so this can never be worse than before.
  const internalCaseId = num(inner.data?.case?.id);
  if (internalCaseId !== null) {
    const items = await fetchCaseDocsList(apiBaseUrl, jwtToken, internalCaseId);
    if (items) mapped.documents = mapDocuments({ documents: items }, appOrigin);
  }

  return { kind: 'success', data: mapped };
}

export async function fetchCaseFullDetail(opts: FetchCaseFullDetailOpts): Promise<CaseFullDetailToolOutput> {
  const { apiBaseUrl, jwtToken, caseNumber, caseId, caseName, appOrigin } = opts;
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
    let attempt = await attemptFetchCaseFullDetail(
      apiBaseUrl, jwtToken, { caseNumber, caseId: resolvedCaseId, caseName }, appOrigin,
    );

    // caseNumber-vs-fileNumber fallback (see resolveCaseNumber's doc
    // comment) — triggered by the identifier STRING the model supplied, in
    // whichever field it chose to put it, not by the caseNumber field alone.
    //
    // Live bug fixed 2026-07-29: this originally only fired for caseNumber,
    // so "how many documents with this case AE00224" still failed whenever
    // the model happened to pass it as caseName instead — which it does
    // non-deterministically, and much more often once the conversation
    // already contains case-name-shaped search results (reproduced locally:
    // the identical question routed as {caseNumber:"AE00224"} in a fresh
    // chat but {caseName:"AE00224"} as a follow-up to a case search).
    // caseName has exactly the same fileNumber blind spot — verified
    // directly against the backend: caseName="AE00224" 404s while
    // caseName="AE-00224" succeeds.
    //
    // Safe to widen: resolveCaseNumber only returns a match when the string
    // EXACTLY equals some case's caseNumber or fileNumber, so a genuine
    // case-name argument ("Elgin Perdomo vs Allied Universal") still
    // resolves to null and leaves the not-found result untouched.
    const searchableIdentifier = caseNumber ?? caseName;
    if (attempt.kind === 'not-found' && searchableIdentifier !== undefined) {
      const resolved = await resolveCaseNumber(apiBaseUrl, jwtToken, searchableIdentifier);
      if (resolved && resolved !== searchableIdentifier) {
        attempt = await attemptFetchCaseFullDetail(apiBaseUrl, jwtToken, { caseNumber: resolved }, appOrigin);
      }
    }

    if (attempt.kind === 'error') return { success: false, error: attempt.message };
    if (attempt.kind === 'ambiguous') return { success: false, ambiguous: true, candidates: attempt.candidates };
    if (attempt.kind === 'not-found') return { success: false, error: `Case "${identifier}" not found.` };

    cacheSet(key, attempt.data);
    return { success: true, data: attempt.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return { success: false, error: message };
  }
}
