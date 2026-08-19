import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mapCaseFullDetail, fetchCaseFullDetail } from '@/lib/caseFullDetail';

// ── Mocks for the fetchCaseFullDetail request-body regression tests below.
// Captures the JSON body written to the outgoing http(s) request so we can
// assert exactly what gets sent to the real backend without a network call. ──
let capturedBody: string | undefined;
/** Every JSON body written to an outgoing GetCaseFullDetail request, in order —
 *  the fallback path issues more than one, so the single capturedBody above
 *  (kept for the existing single-call tests) isn't enough on its own. */
let capturedBodies: string[] = [];
/** Queued {status, body} responses for tests that need something other than the
 *  default 200; consumed one per request, then the default resumes. */
let responseQueue: Array<{ status: number; body: unknown }> = [];

const DEFAULT_RESPONSE = {
  succeeded: true,
  data: {
    isAmbiguous: false,
    data: { case: { caseNumber: 'RP-TEST' }, tasks: [], events: [], documents: [], notes: [], activities: [], accounting: {} },
  },
};

const mockRequest = vi.fn((_options: unknown, callback: (res: EventEmitter & { statusCode: number }) => void) => {
  const req = new EventEmitter() as EventEmitter & { write: (b: string) => void; end: () => void };
  req.write = (b: string) => { capturedBody = b; capturedBodies.push(b); };
  req.end = () => {
    const queued = responseQueue.shift();
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = queued?.status ?? 200;
    callback(res);
    queueMicrotask(() => {
      res.emit('data', Buffer.from(JSON.stringify(queued ? queued.body : DEFAULT_RESPONSE)));
      res.emit('end');
    });
  };
  return req;
});
vi.mock('node:https', () => ({ request: (...args: [unknown, (res: unknown) => void]) => mockRequest(...args) }));
vi.mock('node:http', () => ({ request: (...args: [unknown, (res: unknown) => void]) => mockRequest(...args) }));

// Both fixtures below are trimmed, real shapes observed live against UAT
// (2026-07-17 docx dump for RP2011, 2026-07-19 direct curl for RP003583) — see
// project memory notes dated those days. The two responses disagree on several
// field shapes for the conceptually same data; mapCaseFullDetail must normalize
// both without throwing or silently dropping data.

const DOCX_VARIANT = {
  case: {
    caseNumber: 'RP2011',
    fileNumber: 'RP2011',
    caseName: null,
    displayNameForCaseSearch: 'RP2011 -  vs \r\n',
    caseType: { description: 'WCAB', id: 1 },
    caseStatus: { caseStatusDescription: 'Closed by C & R' },
    caseDate: '2015-01-14 14:48:06',
    caseVenue: { description: 'RIV', id: 13 },
    adjNumber: null,
    attorneyResponsibleId: 1,
    jetFileId: null,
    caseDefendent: null,
  },
  applicant: [
    { firstName: 'Elgin', lastName: 'Perdomo', phone: '555-0100', email: 'Mandarin Chinese' },
  ],
  employee: [
    { company: 'Allied Universal', address: '4100 E Jurupa St', phone: '555-0200', email: 'hr@allieduniversal.com' },
  ],
  injury: [
    {
      injuryAdjNo: 'ADJ21563942',
      doiStart: '2025-09-04T00:00:00',
      statuteLimitation: '2030-09-03T00:00:00',
      injuryExplain: 'Struck by object',
      caseInjuryBodyPartsList: [
        { bodyPartsId: 1, bodyPartValue: 'Head' },
        { bodyPartsId: 6, bodyPartValue: 'Eye' },
      ],
    },
  ],
  parties: [
    { partyTypeName: 'Insurance Carrier', company: 'ESIS CHATSWORTH', comPhone: '(800)-654-5374', fax: '800-350-8263', email: 'claims@esis.com' },
  ],
  tasks: [], events: [], documents: [], notes: [], activities: [], accounting: {},
};

const LIVE_VARIANT = {
  case: {
    caseNumber: 'RP003583',
    fileNumber: 'RP003583',
    caseName: 'Philip Alexander vs Slate Healthcare LLC',
    caseType: 'WCAB',
    caseStatusDescription: 'Open',
    caseDate: '2025-08-06T00:00:00',
    venueId: 13,
    adjNumber: 'Unassigned',
    caseAttorneyId: 5935,
    caseAttorneyName: 'Raj Patel',
    caseAttorneyNikeName: 'RP',
    caseSupervisorAttorneyName: 'Jennifer Paredes',
    caseCoordinatorName: 'Muskan Shaikh',
    jetFileId: 10601,
    caseApplicant: { firstName: 'Philip', lastName: 'Alexander', fullName: 'Philip Alexander', dob: '1963-03-10T00:00:00', phone: '(702)-806-1694' },
    caseEmployee: { company: 'Slate Healthcare LLC' },
    caseDefendent: null,
    // Verified live 2026-07-19 (RP003583, via direct Node inspection of the
    // parsed response — not text bracket-counting, which gave a wrong answer
    // first try): injury and parties are BOTH direct siblings inside "case"
    // (case.injury, case.parties) — not at the top level as the docx (RP2011)
    // sample had it, and parties is NOT nested inside the injury entry either.
    injury: [
      {
        injuryAdjNo: 'ADJ21345544',
        doiStart: '2025-07-15T00:00:00',
        statuteLimitation: '2030-07-14T00:00:00',
        bodyParts: [
          { bodyPartsId: 17, bodyPartValue: '200 - Neck' },
        ],
      },
    ],
    parties: [
      { partyTypeName: 'Insurance Carrier', company: 'AMTRUST IRVINE', phone: '844-601-7760', email: '' },
    ],
  },
  tasks: [], events: [], documents: [], notes: [], activities: [], accounting: {},
};

describe('mapCaseFullDetail — docx (RP2011) variant', () => {
  const data = mapCaseFullDetail(DOCX_VARIANT);

  it('extracts caseType from a nested {description} object', () => {
    expect(data.caseType).toBe('WCAB');
  });
  it('extracts caseStatus from a nested caseStatusDescription', () => {
    expect(data.caseStatus).toBe('Closed by C & R');
  });
  it('extracts venue from the joined caseVenue.description', () => {
    expect(data.venue).toBe('RIV');
  });
  it('normalizes null jetFileId', () => {
    expect(data.jetFileId).toBeNull();
  });
  it('has no attorney name — attorneyResponsibleId-only variant carries no name', () => {
    expect(data.attorney).toBeNull();
  });
  it('falls back to the top-level applicant[] array and rejects the corrupted email', () => {
    expect(data.applicant?.fullName).toBe('Elgin Perdomo');
    expect(data.applicant?.email).toBeNull(); // "Mandarin Chinese" is not email-shaped
  });
  it('falls back to the top-level employee[] array for employer', () => {
    expect(data.employer?.company).toBe('Allied Universal');
    expect(data.employer?.email).toBe('hr@allieduniversal.com');
  });
  it('reads insurance carrier from parties[] by partyTypeName', () => {
    expect(data.insuranceCarrier?.company).toBe('ESIS CHATSWORTH');
    expect(data.insuranceCarrier?.email).toBe('claims@esis.com');
  });
  it('flattens caseInjuryBodyPartsList into per-body-part injury summaries', () => {
    expect(data.injuries).toHaveLength(2);
    expect(data.injuries[0]).toMatchObject({ bodyPartId: 1, bodyPart: 'Head', adjNumber: 'ADJ21563942' });
    expect(data.injuries[1]).toMatchObject({ bodyPartId: 6, bodyPart: 'Eye' });
  });
  it('falls back to displayNameForCaseSearch when caseName is absent', () => {
    expect(data.caseName).toBe('RP2011 -  vs');
  });
});

describe('mapCaseFullDetail — live (RP003583) variant', () => {
  const data = mapCaseFullDetail(LIVE_VARIANT);

  it('extracts caseType from a flat string', () => {
    expect(data.caseType).toBe('WCAB');
  });
  it('extracts caseStatus from the flat caseStatusDescription', () => {
    expect(data.caseStatus).toBe('Open');
  });
  it('falls back to a raw venueId when no caseVenue is joined', () => {
    expect(data.venue).toBe('Venue 13');
  });
  it('normalizes the literal "Unassigned" adjNumber to null', () => {
    expect(data.adjNumber).toBeNull();
  });
  it('populates jetFileId when present', () => {
    expect(data.jetFileId).toBe(10601);
  });
  it('reads attorney/supervisor/coordinator names from flat case-level fields', () => {
    expect(data.attorney).toEqual({ name: 'Raj Patel', nickName: 'RP', email: null, phone: null });
    expect(data.supervisorAttorney?.name).toBe('Jennifer Paredes');
    expect(data.coordinator?.name).toBe('Muskan Shaikh');
  });
  it('reads applicant from the nested caseApplicant object (fullName present directly)', () => {
    expect(data.applicant?.fullName).toBe('Philip Alexander');
    expect(data.applicant?.email).toBeNull(); // no email key at all in this variant
  });
  it('reads employer from the nested caseEmployee object', () => {
    expect(data.employer?.company).toBe('Slate Healthcare LLC');
  });
  it('rejects an empty-string email as "not set"', () => {
    expect(data.insuranceCarrier?.email).toBeNull();
  });
  it('reads injury body parts from the bodyParts key (not caseInjuryBodyPartsList)', () => {
    expect(data.injuries).toHaveLength(1);
    expect(data.injuries[0]).toMatchObject({ bodyPartId: 17, bodyPart: '200 - Neck' });
  });
  it('defendant stays null when caseDefendent is null and no matching party exists', () => {
    expect(data.defendant).toBeNull();
  });
});

describe('mapCaseFullDetail — JetFile submission history', () => {
  it('maps the earliest successful submission even when case.jetFileId is null', () => {
    const data = mapCaseFullDetail({
      case: { jetFileId: null },
      eamsSubmissions: [
        { id: 15, jetfileId: null, appStatus: 1, createdDateTime: '2026-07-28T08:31:39Z' },
        { id: 14, jetfileId: 'JET-224', appStatus: 3, createdDateTime: '2026-07-27T10:00:45Z' },
        { id: 12, jetfileId: 'JET-224', appStatus: 3, createdDateTime: '2026-07-27T09:30:33Z' },
      ],
    });

    expect(data.jetFileId).toBeNull();
    expect(data.jetFileSubmissionDate).toBe('2026-07-27T09:30:33Z');
  });

  it('leaves the submission date null when no successful submission exists', () => {
    const data = mapCaseFullDetail({
      case: { jetFileId: null },
      eamsSubmissions: [{ jetfileId: null, appStatus: 1, createdDateTime: '2026-07-28T08:31:39Z' }],
    });
    expect(data.jetFileSubmissionDate).toBeNull();
  });
});

// Real shape, captured live 2026-07-19 against RP003583 (3 genuine tasks — the
// live UAT data was cleared/changed minutes later during the same session, a
// known characteristic of this shared test environment; see project memory).
const REAL_TASKS_FIXTURE = {
  tasks: [
    {
      id: 46628,
      newCaseId: 9601,
      title: 'Follow Up On PTP Scheduling',
      description: '<p>Follow Up On PTP Scheduling</p>',
      doi: '2025-07-15T00:00:00',
      categoryId: 13,
      category: 'Standard',
      assignedTo: [
        { id: 6014, name: 'Muskan Shaikh', nickName: 'MSH' },
        { id: 6014, name: 'Muskan Shaikh', nickName: 'MSH' }, // duplicate, as observed live
      ],
      cc: [],
      dueDate: '2025-08-26T00:00:00',
      status: 'Open',
      statusId: 1,
      priority: 'Normal',
      priorityId: 2,
      enteredBy: { id: 6014, name: 'Muskan Shaikh', nickName: 'MSH' },
      createdDate: '2025-08-13T20:35:57.190738',
      updatedDateTime: '2025-08-25T22:29:54.685029+00:00',
      isDeleted: false,
    },
    {
      id: 46629,
      title: 'Need to follow up on QME letter or Denial Letter after 10 days',
      description: '<p>Need to follow up on QME letter or Denial Letter after 10 days</p>',
      category: 'Standard',
      assignedTo: [{ id: 6014, name: 'Muskan Shaikh', nickName: 'MSH' }],
      dueDate: '2025-08-26T00:00:00',
      status: 'Open',
      priority: 'Normal',
      createdDate: '2025-08-13T20:36:35.380735',
      isDeleted: false,
    },
    {
      id: 99999,
      title: 'Old cancelled task',
      description: '<p>Should not appear</p>',
      category: 'Standard',
      assignedTo: [{ id: 1, name: 'Someone' }],
      dueDate: '2025-01-01T00:00:00',
      status: 'Cancelled',
      priority: 'Low',
      createdDate: '2024-01-01T00:00:00',
      isDeleted: true, // soft-deleted — must be filtered out
    },
  ],
};

describe('mapCaseFullDetail — tasks (Section 2)', () => {
  it('maps the real 3-task fixture, filtering the soft-deleted one', () => {
    const data = mapCaseFullDetail(REAL_TASKS_FIXTURE);
    expect(data.tasks).toHaveLength(2); // the isDeleted:true task is excluded
  });

  it('strips HTML from the description field', () => {
    const data = mapCaseFullDetail(REAL_TASKS_FIXTURE);
    expect(data.tasks[0].description).toBe('Follow Up On PTP Scheduling');
  });

  it('dedupes assignedTo by id (raw data had the same person twice)', () => {
    const data = mapCaseFullDetail(REAL_TASKS_FIXTURE);
    expect(data.tasks[0].assignedTo).toEqual(['Muskan Shaikh']);
  });

  it('keeps a single assignedTo entry unchanged when there is no duplicate', () => {
    const data = mapCaseFullDetail(REAL_TASKS_FIXTURE);
    expect(data.tasks[1].assignedTo).toEqual(['Muskan Shaikh']);
  });

  it('maps title, category, dueDate, status, priority, createdDate', () => {
    const data = mapCaseFullDetail(REAL_TASKS_FIXTURE);
    expect(data.tasks[0]).toMatchObject({
      id: 46628,
      title: 'Follow Up On PTP Scheduling',
      category: 'Standard',
      dueDate: '2025-08-26T00:00:00',
      status: 'Open',
      priority: 'Normal',
      createdDate: '2025-08-13T20:35:57.190738',
    });
  });

  it('returns an empty array for a case with no tasks', () => {
    const data = mapCaseFullDetail({ tasks: [] });
    expect(data.tasks).toEqual([]);
  });

  it('returns an empty array when the tasks key is missing entirely', () => {
    const data = mapCaseFullDetail({});
    expect(data.tasks).toEqual([]);
  });

  it('does not throw on a task with missing/null optional fields', () => {
    const data = mapCaseFullDetail({
      tasks: [{ id: 1, title: null, description: null, category: null, assignedTo: [], dueDate: null, status: null, priority: null, createdDate: null }],
    });
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toEqual({
      id: 1, title: null, description: null, category: null, assignedTo: [], dueDate: null, status: null, priority: null, createdDate: null,
    });
  });

  it('skips assignedTo entries with no name rather than pushing an empty string', () => {
    const data = mapCaseFullDetail({
      tasks: [{ id: 1, assignedTo: [{ id: 1, name: null }, { id: 2, name: 'Real Person' }] }],
    });
    expect(data.tasks[0].assignedTo).toEqual(['Real Person']);
  });

  it('does not throw when a task entry is entirely empty/malformed', () => {
    expect(() => mapCaseFullDetail({ tasks: [{}] })).not.toThrow();
  });
});

// Real shape, captured live 2026-07-19 against RP2119 (found via a broader
// GetCaseListCombined sweep, since the first 7 cases checked all happened to
// have zero events). Confirms the real field names are title/date, not the
// backend doc sample's subject/when.
const REAL_EVENTS_FIXTURE = {
  events: [
    {
      id: 240, typeId: 36, type: 'intake', title: 'Rogelio Perez vs Milgard Manufacturing, Inc - 00/00/0000',
      date: '2015-02-05T11:14:00', location: '', notes: '<p>Kase Intake by Jennifer Paredes</p>\n', status: 'Scheduled',
    },
    {
      id: 6315, typeId: 8, type: 'Lien Conference', title: 'Lien Conference', date: '2017-09-19T08:30:00',
      location: 'RIV-ADJ', notes: 'Lien Conference\r\n\r\nAdded via automatic Court Calendar Update on 09/15/17', status: 'Scheduled',
    },
  ],
};

describe('mapCaseFullDetail — events (Section 3, verified against real live data)', () => {
  it('maps the real RP2119 fixture: title/date fields, HTML-stripped notes, empty location → null', () => {
    const data = mapCaseFullDetail(REAL_EVENTS_FIXTURE);
    expect(data.events).toHaveLength(2);
    expect(data.events[0]).toEqual({
      id: 240, title: 'Rogelio Perez vs Milgard Manufacturing, Inc - 00/00/0000', type: 'intake',
      when: '2015-02-05T11:14:00', location: null, status: 'Scheduled', notes: 'Kase Intake by Jennifer Paredes',
    });
    expect(data.events[1]).toEqual({
      id: 6315, title: 'Lien Conference', type: 'Lien Conference', when: '2017-09-19T08:30:00',
      location: 'RIV-ADJ', status: 'Scheduled', notes: 'Lien Conference\r\n\r\nAdded via automatic Court Calendar Update on 09/15/17',
    });
  });

  it('maps the backend doc-sample shape (subject/when/address) — still supported defensively', () => {
    const data = mapCaseFullDetail({
      events: [{ id: 3310, subject: 'Status Conference', when: '2026-08-03T00:00:00', address: 'Dept 4, RIV' }],
    });
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({
      id: 3310, title: 'Status Conference', when: '2026-08-03T00:00:00', location: 'Dept 4, RIV',
    });
  });

  it('maps a richer shape with title/date/time/location/status/type/notes', () => {
    const data = mapCaseFullDetail({
      events: [{
        id: 42, type: 'Hearing', title: 'Status Conference', date: '2026-08-03', time: '09:30',
        location: 'Dept 4, RIV', status: 'Scheduled', notes: 'Bring documents',
      }],
    });
    expect(data.events[0]).toEqual({
      id: 42, title: 'Status Conference', type: 'Hearing', when: '2026-08-03 09:30',
      location: 'Dept 4, RIV', status: 'Scheduled', notes: 'Bring documents',
    });
  });

  it('does not duplicate time when "when" already contains it', () => {
    const data = mapCaseFullDetail({
      events: [{ id: 1, when: '2026-08-03T09:30:00', time: '09:30:00' }],
    });
    expect(data.events[0].when).toBe('2026-08-03T09:30:00');
  });

  it('filters out soft-deleted events', () => {
    const data = mapCaseFullDetail({
      events: [
        { id: 1, subject: 'Kept', isDeleted: false },
        { id: 2, subject: 'Removed', isDeleted: true },
      ],
    });
    expect(data.events).toHaveLength(1);
    expect(data.events[0].title).toBe('Kept');
  });

  it('returns an empty array for a case with no events', () => {
    expect(mapCaseFullDetail({ events: [] }).events).toEqual([]);
  });

  it('returns an empty array when the events key is missing entirely', () => {
    expect(mapCaseFullDetail({}).events).toEqual([]);
  });

  it('does not throw on an event with missing/null optional fields', () => {
    const data = mapCaseFullDetail({ events: [{ id: 1 }] });
    expect(data.events[0]).toEqual({ id: 1, title: null, type: null, when: null, location: null, status: null, notes: null });
  });

  it('does not throw when an event entry is entirely empty/malformed', () => {
    expect(() => mapCaseFullDetail({ events: [{}] })).not.toThrow();
  });
});

// Real shape, captured live 2026-07-19 against RP2021 (199 real documents,
// found via a broader GetCaseListCombined sweep, since the first 7 cases
// checked all happened to have zero documents). Confirms uploadedBy really is
// a plain string in production data, and real fileUrl values are full
// uatapi.aeliuscase.com URLs.
// id/docId/origin added 2026-07-28 after switching document links to the
// GetFirmDocFile-backed download proxy. The second row deliberately has
// id !== docId, mirroring the real origin=1 (batch-scan) rows found live on
// case 224 — GetFirmDocFile needs `id` there, not `docId` (see
// buildDownloadUrl's doc comment).
const REAL_DOCUMENTS_FIXTURE = {
  documents: [
    {
      id: 41494, docId: 41494, origin: 3, name: 'Williams, Brandon Scan NOH 10.3.16', uploadedBy: 'Maryanne Olivas',
      uploadedDate: '2016-10-10T14:13:47',
      fileUrl: 'https://uatapi.aeliuscase.com/Data01/aeliuscase_rplaw_pr/CaseDocs/CaseDocFiles/3075/Williams, Brandon Scan NOH 10.3.16.pdf',
    },
    {
      id: 123, docId: 40218, origin: 1, name: 'Williams, Brandon Scan Sub of Attny 9.8.16', uploadedBy: 'Jennette',
      uploadedDate: '2016-09-12T11:56:12',
      fileUrl: 'https://uatapi.aeliuscase.com/Data01/aeliuscase_rplaw_pr/CaseDocs/CaseDocFiles/3075/Williams, Brandon Scan Sub of Attny 9.8.16.pdf',
    },
  ],
};

describe('mapCaseFullDetail — documents (Section 4, verified against real live data)', () => {
  it('maps the real RP2021 fixture: plain-string uploadedBy, real file URLs, null category', () => {
    const data = mapCaseFullDetail(REAL_DOCUMENTS_FIXTURE);
    expect(data.documents).toHaveLength(2);
    expect(data.documents[0]).toEqual({
      id: 41494, name: 'Williams, Brandon Scan NOH 10.3.16', category: null, uploadedBy: 'Maryanne Olivas',
      uploadedDate: '2016-10-10T14:13:47',
      fileUrl: 'https://uatapi.aeliuscase.com/Data01/aeliuscase_rplaw_pr/CaseDocs/CaseDocFiles/3075/Williams, Brandon Scan NOH 10.3.16.pdf',
    });
    expect(data.documents[1].uploadedBy).toBe('Jennette');
  });

  it('maps the backend doc-sample shape (uploadedBy as a plain string, fileLocation) — still supported defensively', () => {
    const data = mapCaseFullDetail({
      documents: [{
        id: 9021, name: 'Settlement Agreement', fileName: 'Settlement Agreement.pdf',
        uploadedBy: 'Raj Patel', uploadDate: '2026-06-15T00:00:00',
        fileLocation: 'https://files.example.com/firm/cases/7007/Settlement Agreement.pdf',
      }],
    });
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]).toEqual({
      id: 9021,
      name: 'Settlement Agreement',
      category: null,
      uploadedBy: 'Raj Patel',
      uploadedDate: '2026-06-15T00:00:00',
      fileUrl: 'https://files.example.com/firm/cases/7007/Settlement Agreement.pdf',
    });
  });

  it('maps the original PM-request shape (uploadedBy as {id,name}, fileUrl, uploadedDate, category)', () => {
    const data = mapCaseFullDetail({
      documents: [{
        id: 9022, name: 'Medical Records.pdf', category: 'Medical',
        uploadedBy: { id: 5935, name: 'Raj Patel' }, uploadedDate: '2026-06-20T00:00:00',
        fileUrl: '/cases/RP003668/documents/9022/download',
      }],
    });
    expect(data.documents[0]).toEqual({
      id: 9022,
      name: 'Medical Records.pdf',
      category: 'Medical',
      uploadedBy: 'Raj Patel',
      uploadedDate: '2026-06-20T00:00:00',
      fileUrl: '/cases/RP003668/documents/9022/download',
    });
  });

  it('falls back to fileName when name is absent', () => {
    const data = mapCaseFullDetail({ documents: [{ id: 1, fileName: 'Notice.pdf' }] });
    expect(data.documents[0].name).toBe('Notice.pdf');
  });

  it('filters out soft-deleted documents', () => {
    const data = mapCaseFullDetail({
      documents: [
        { id: 1, name: 'Kept.pdf', isDeleted: false },
        { id: 2, name: 'Removed.pdf', isDeleted: true },
      ],
    });
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0].name).toBe('Kept.pdf');
  });

  it('returns an empty array for a case with no documents', () => {
    expect(mapCaseFullDetail({ documents: [] }).documents).toEqual([]);
  });

  it('returns an empty array when the documents key is missing entirely', () => {
    expect(mapCaseFullDetail({}).documents).toEqual([]);
  });

  it('does not throw on a document with missing/null optional fields', () => {
    const data = mapCaseFullDetail({ documents: [{ id: 1 }] });
    expect(data.documents[0]).toEqual({ id: 1, name: null, category: null, uploadedBy: null, uploadedDate: null, fileUrl: null });
  });

  it('does not throw when uploadedBy is entirely missing (no crash on undefined.name)', () => {
    expect(() => mapCaseFullDetail({ documents: [{ id: 1, name: 'X.pdf' }] })).not.toThrow();
  });

  it('does not throw when a document entry is entirely empty/malformed', () => {
    expect(() => mapCaseFullDetail({ documents: [{}] })).not.toThrow();
  });

  // Live 401 reproduced 2026-07-28: every backend file endpoint (confirmed
  // via the backend's own Swagger spec — global security requirement, no
  // per-endpoint override, no query-string API-key alternative) requires a
  // header-based Bearer JWT, which a plain browser link click can never
  // attach. Document links now point at our own authenticated proxy
  // (app/api/documents/download) instead, carrying the docId/origin
  // (confirmed live to map to GetFirmDocFile's docId/docCategory params).
  // No session id in the URL — see the next describe block for why.
  it('builds an ABSOLUTE download-proxy URL from the row id + origin, when appOrigin is provided', () => {
    const data = mapCaseFullDetail(REAL_DOCUMENTS_FIXTURE, 'https://aeliuscase-global-search.vercel.app');
    expect(data.documents[0].fileUrl).toBe(
      'https://aeliuscase-global-search.vercel.app/api/documents/download?docId=41494&docCategory=3',
    );
  });

  // Live-verified 2026-07-28 on case 224: origin=1 (batch-scan) rows are the
  // only ones where id !== docId, and GetFirmDocFile 500s on their docId
  // (607/405) while returning real PDFs for their id (123/111). Using the
  // row's own `id` is what makes both origins work.
  it('uses the row id (not docId) when they differ, as origin=1 rows require', () => {
    const data = mapCaseFullDetail(REAL_DOCUMENTS_FIXTURE, 'https://aeliuscase-global-search.vercel.app');
    expect(data.documents[1].fileUrl).toBe(
      'https://aeliuscase-global-search.vercel.app/api/documents/download?docId=123&docCategory=1',
    );
  });

  // Live bug (2026-07-28): with a RELATIVE download url, the model itself
  // invented a fake "https://your-domain.com/..." host when writing the
  // markdown link — an always-broken link. Requiring appOrigin to build the
  // link at all closes that gap: no appOrigin means no proxy link gets
  // built, rather than risking a relative one.
  it('leaves fileUrl as the raw URL when appOrigin is not provided (existing fixture tests rely on this)', () => {
    const data = mapCaseFullDetail(REAL_DOCUMENTS_FIXTURE);
    expect(data.documents[0].fileUrl).toBe(
      'https://uatapi.aeliuscase.com/Data01/aeliuscase_rplaw_pr/CaseDocs/CaseDocFiles/3075/Williams, Brandon Scan NOH 10.3.16.pdf',
    );
  });

  it('falls back to the raw fileUrl when id/origin are missing, even with appOrigin', () => {
    const data = mapCaseFullDetail({
      documents: [{ id: 1, name: 'X.pdf', fileUrl: 'https://uatapi.aeliuscase.com/x.pdf' }],
    }, 'https://aeliuscase-global-search.vercel.app');
    expect(data.documents[0].fileUrl).toBe('https://uatapi.aeliuscase.com/x.pdf');
  });

  it('never produces a fileUrl for a document with no raw fileUrl at all', () => {
    const data = mapCaseFullDetail({ documents: [{ id: 1 }] }, 'https://aeliuscase-global-search.vercel.app');
    expect(data.documents[0].fileUrl).toBeNull();
  });
});

// Live bug fixed 2026-07-29: the download link previously embedded the chat
// session's opaque id in its own query string, so opening a document link
// even a day later 401'd — the session (~1h TTL) had long expired, even
// though the user's CURRENT session was perfectly valid. Confirms the link
// itself carries no session-specific state, so it can never go stale.
describe('mapCaseFullDetail — documents never embed a session id (fixed 2026-07-29)', () => {
  it('the download url has no sessionId param, regardless of case sensitivity in the query string', () => {
    const data = mapCaseFullDetail(REAL_DOCUMENTS_FIXTURE, 'https://aeliuscase-global-search.vercel.app');
    expect(data.documents[0].fileUrl).not.toContain('sessionId');
    expect(data.documents[0].fileUrl).not.toContain('session');
  });
});

// Real shape, captured live 2026-07-19 against RP003668 (42 real notes).
const REAL_NOTES_FIXTURE = {
  notes: [
    {
      id: 315475, categoryId: 1, category: null, noteType: null, subject: 'General Note',
      text: '<p>E Filed Application for Adjudication of Claim SP 10-30-2024</p><p>Served to insurance via fax at F: (800)-350-8299</p>',
      doi: '0001-01-01T00:00:00', noteDate: '2025-10-23T10:20:00', noteUpdateDate: null,
      statusTypeId: 1, statusType: 'MostImportant', caseNoteCategoryId: 0, caseNoteCategory: 'General',
      createdBy: { id: 0, name: 'Aditi Mandal', nickName: 'AMM' }, createdDate: '2025-10-23T10:20:00',
    },
    {
      id: 315631, category: null, subject: 'Email sent to adjuster with E filed application',
      text: '<p><span style="color: inherit;">Aditi Mandal</span></p><p>Hello,</p><p>Matrix Order processed.</p>',
      doi: '0001-01-01T00:00:00', noteDate: '2025-10-24T09:03:00',
      caseNoteCategory: 'General', createdBy: { id: 0, name: 'Aditi Mandal', nickName: 'AMM' }, createdDate: '2025-10-24T09:03:00',
    },
  ],
};

describe('mapCaseFullDetail — notes (Section 5, verified against real live data)', () => {
  it('maps the real RP003668 fixture: subject, HTML-stripped text, caseNoteCategory, createdBy.name, noteDate', () => {
    const data = mapCaseFullDetail(REAL_NOTES_FIXTURE);
    expect(data.notes).toHaveLength(2);
    expect(data.notes[0]).toEqual({
      id: 315475,
      subject: 'General Note',
      text: 'E Filed Application for Adjudication of Claim SP 10-30-2024Served to insurance via fax at F: (800)-350-8299',
      category: 'General',
      createdBy: 'Aditi Mandal',
      createdDate: '2025-10-23T10:20:00',
    });
  });

  it('prefers caseNoteCategory over the flat (null) category field', () => {
    const data = mapCaseFullDetail(REAL_NOTES_FIXTURE);
    expect(data.notes[0].category).toBe('General');
  });

  it('decodes HTML entities like &nbsp; instead of leaving them literal (found live on RP003668)', () => {
    const data = mapCaseFullDetail({
      notes: [{ id: 1, text: '<p>relating to,&nbsp;Elgin &amp; Perdomo &lt;test&gt;</p>' }],
    });
    expect(data.notes[0].text).toBe('relating to, Elgin & Perdomo <test>');
  });

  it('normalizes the "0001-01-01" sentinel date to null (tested via a synthetic noteDate)', () => {
    const data = mapCaseFullDetail({ notes: [{ id: 1, subject: 'X', noteDate: '0001-01-01T00:00:00' }] });
    expect(data.notes[0].createdDate).toBeNull();
  });

  it('falls back to createdDate when noteDate is a sentinel/missing', () => {
    const data = mapCaseFullDetail({ notes: [{ id: 1, subject: 'X', noteDate: '0001-01-01T00:00:00', createdDate: '2025-01-01T00:00:00' }] });
    expect(data.notes[0].createdDate).toBe('2025-01-01T00:00:00');
  });

  it('falls back to a plain-string createdBy when not an object', () => {
    const data = mapCaseFullDetail({ notes: [{ id: 1, createdBy: 'Raj Patel' }] });
    expect(data.notes[0].createdBy).toBe('Raj Patel');
  });

  it('falls back to category/noteType when caseNoteCategory is absent', () => {
    const data = mapCaseFullDetail({ notes: [{ id: 1, category: 'Settlement' }] });
    expect(data.notes[0].category).toBe('Settlement');
  });

  it('filters out soft-deleted notes', () => {
    const data = mapCaseFullDetail({
      notes: [
        { id: 1, subject: 'Kept', isDeleted: false },
        { id: 2, subject: 'Removed', isDeleted: true },
      ],
    });
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].subject).toBe('Kept');
  });

  it('returns an empty array for a case with no notes', () => {
    expect(mapCaseFullDetail({ notes: [] }).notes).toEqual([]);
  });

  it('returns an empty array when the notes key is missing entirely', () => {
    expect(mapCaseFullDetail({}).notes).toEqual([]);
  });

  it('does not throw on a note with missing/null optional fields', () => {
    const data = mapCaseFullDetail({ notes: [{ id: 1 }] });
    expect(data.notes[0]).toEqual({ id: 1, subject: null, text: null, category: null, createdBy: null, createdDate: null });
  });

  it('does not throw when a note entry is entirely empty/malformed', () => {
    expect(() => mapCaseFullDetail({ notes: [{}] })).not.toThrow();
  });
});

// Real shape, captured live 2026-07-19 against RP003668 (128 real activities).
const REAL_ACTIVITIES_FIXTURE = {
  activities: [
    {
      id: 1636834, caseId: 9686, typeId: 13,
      description: 'General Note Note was inserted by Sachin Giri',
      performedBy: { id: null, name: 'Sachin Giri', nickName: null },
      timestamp: '2025-11-11T21:48:36.513625',
      activityTag: 'NOTE_CREATED', createdBy: 'Sachin Giri',
      previewHtml: '<p>Elgin G. Perdomo - Sub &amp; Dismissal</p>',
      caseNoteId: 318698, caseTaskId: null, caseEventId: null,
      createdDateTime: '2025-11-11T21:48:36.517984+00:00',
    },
  ],
};

describe('mapCaseFullDetail — activities (Section 6, verified against real live data)', () => {
  it('maps the real RP003668 fixture: description, activityTag as type, performedBy.name, timestamp, relatedEntity', () => {
    const data = mapCaseFullDetail(REAL_ACTIVITIES_FIXTURE);
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0]).toEqual({
      id: 1636834,
      description: 'General Note Note was inserted by Sachin Giri',
      type: 'NOTE_CREATED',
      performedBy: 'Sachin Giri',
      timestamp: '2025-11-11T21:48:36.513625',
      relatedEntity: { type: 'note', id: 318698 },
    });
  });

  it('does NOT surface previewHtml (deliberately excluded from the slim shape)', () => {
    const data = mapCaseFullDetail(REAL_ACTIVITIES_FIXTURE);
    expect(Object.keys(data.activities[0])).not.toContain('previewHtml');
  });

  it('derives relatedEntity as task when caseTaskId is set instead of caseNoteId', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1, caseTaskId: 500 }] });
    expect(data.activities[0].relatedEntity).toEqual({ type: 'task', id: 500 });
  });

  it('derives relatedEntity as event when caseEventId is set', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1, caseEventId: 42 }] });
    expect(data.activities[0].relatedEntity).toEqual({ type: 'event', id: 42 });
  });

  it('relatedEntity is null when none of caseNoteId/caseTaskId/caseEventId are set', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1 }] });
    expect(data.activities[0].relatedEntity).toBeNull();
  });

  it('falls back to the flat createdBy string when performedBy.name is absent', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1, createdBy: 'Raj Patel' }] });
    expect(data.activities[0].performedBy).toBe('Raj Patel');
  });

  it('falls back to createdDateTime when timestamp is absent', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1, createdDateTime: '2026-01-01T00:00:00Z' }] });
    expect(data.activities[0].timestamp).toBe('2026-01-01T00:00:00Z');
  });

  it('filters out soft-deleted activities', () => {
    const data = mapCaseFullDetail({
      activities: [
        { id: 1, description: 'Kept', isDeleted: false },
        { id: 2, description: 'Removed', isDeleted: true },
      ],
    });
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0].description).toBe('Kept');
  });

  it('returns an empty array for a case with no activities', () => {
    expect(mapCaseFullDetail({ activities: [] }).activities).toEqual([]);
  });

  it('returns an empty array when the activities key is missing entirely', () => {
    expect(mapCaseFullDetail({}).activities).toEqual([]);
  });

  it('does not throw on an activity with missing/null optional fields', () => {
    const data = mapCaseFullDetail({ activities: [{ id: 1 }] });
    expect(data.activities[0]).toEqual({ id: 1, description: null, type: null, performedBy: null, timestamp: null, relatedEntity: null });
  });

  it('does not throw when an activity entry is entirely empty/malformed', () => {
    expect(() => mapCaseFullDetail({ activities: [{}] })).not.toThrow();
  });
});

// NOT live-verified against populated data — 91 real cases checked live
// 2026-07-19 all had EMPTY accounting. The top-level shape (these 4 arrays
// under "accounting") IS confirmed live; fields within each row are from the
// backend's own doc sample only.
const DOC_SAMPLE_ACCOUNTING = {
  accounting: {
    chequeRequests: [
      { id: 601, amount: 850.00, description: 'Medical records fee', requestedDate: '2026-06-10T00:00:00', status: 'Pending' },
    ],
    payments: [
      { id: 3390, amount: 1500.00, transactionDate: '2026-06-05T00:00:00', method: 'Cheque' },
    ],
    clientCostsPaid: [],
    settlementFees: [
      { id: 1203, invoice: 'INV-1203', amount: 2200.00, remainingBalance: 700.00 },
    ],
  },
};

describe('mapCaseFullDetail — accounting (Section 7, defensive — not live-verified against populated data)', () => {
  it('maps the backend doc-sample shape for all 4 arrays', () => {
    const data = mapCaseFullDetail(DOC_SAMPLE_ACCOUNTING);
    expect(data.accounting.chequeRequests).toEqual([
      { id: 601, amount: 850, description: 'Medical records fee', requestedDate: '2026-06-10T00:00:00', status: 'Pending' },
    ]);
    expect(data.accounting.payments).toEqual([
      { id: 3390, amount: 1500, date: '2026-06-05T00:00:00', method: 'Cheque' },
    ]);
    expect(data.accounting.clientCostsPaid).toEqual([]);
    expect(data.accounting.settlementFees).toEqual([
      { id: 1203, invoice: 'INV-1203', amount: 2200, remainingBalance: 700 },
    ]);
  });

  it('falls back to "date"/"purpose" field-name variants when the primary names are absent', () => {
    const data = mapCaseFullDetail({
      accounting: {
        chequeRequests: [{ id: 1, amount: 100, purpose: 'Filing fee', date: '2026-01-01' }],
        payments: [{ id: 2, amount: 200, date: '2026-01-02' }],
      },
    });
    expect(data.accounting.chequeRequests[0]).toMatchObject({ description: 'Filing fee', requestedDate: '2026-01-01' });
    expect(data.accounting.payments[0]).toMatchObject({ date: '2026-01-02' });
  });

  it('returns all-empty arrays when accounting is entirely absent (matches real live cases)', () => {
    const data = mapCaseFullDetail({});
    expect(data.accounting).toEqual({ chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] });
  });

  it('returns all-empty arrays when accounting is present but every array is empty (the real observed case)', () => {
    const data = mapCaseFullDetail({ accounting: { chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] } });
    expect(data.accounting).toEqual({ chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] });
  });

  it('does not throw on a cheque request / payment / settlement fee with missing/null fields', () => {
    const data = mapCaseFullDetail({
      accounting: { chequeRequests: [{}], payments: [{}], clientCostsPaid: [{}], settlementFees: [{}] },
    });
    expect(data.accounting.chequeRequests[0]).toEqual({ id: null, amount: null, description: null, requestedDate: null, status: null });
    expect(data.accounting.payments[0]).toEqual({ id: null, amount: null, date: null, method: null });
    expect(data.accounting.settlementFees[0]).toEqual({ id: null, invoice: null, amount: null, remainingBalance: null });
  });

  it('does not throw when accounting itself is null/malformed', () => {
    expect(() => mapCaseFullDetail({ accounting: null })).not.toThrow();
    expect(mapCaseFullDetail({ accounting: null }).accounting).toEqual({ chequeRequests: [], payments: [], clientCostsPaid: [], settlementFees: [] });
  });
});

// Regression test for a live bug found 2026-07-19 (QA round 3, end-to-end
// testing with real AI + real backend calls): the model frequently supplies a
// GUESSED caseId alongside a correct caseNumber (e.g. caseId: 2021 parsed from
// "RP2021", which is not the case's real internal ID). Confirmed live against
// the real UAT backend that GetCaseFullDetail requires every supplied
// identifier to resolve to the SAME case — caseNumber alone → 200 OK;
// caseNumber+caseId(wrong)+caseName → 404 "No case matched the supplied
// caseId/caseNumber/caseName". Fixed by dropping caseId whenever caseNumber or
// caseName is also present (both are already unambiguous on their own).
describe('fetchCaseFullDetail — drops a guessed caseId that could corrupt a correct caseNumber/caseName lookup', () => {
  beforeEach(() => {
    capturedBody = undefined;
    mockRequest.mockClear();
  });

  it('omits caseId from the outgoing request when caseNumber is also supplied', async () => {
    await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'tok-1', caseNumber: 'RP2021', caseId: 2021 });
    expect(JSON.parse(capturedBody!)).toEqual({ caseNumber: 'RP2021' });
  });

  it('omits caseId from the outgoing request when caseName is also supplied', async () => {
    await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'tok-2', caseName: 'Smith vs Wallmart', caseId: 4242 });
    expect(JSON.parse(capturedBody!)).toEqual({ caseName: 'Smith vs Wallmart' });
  });

  it('still sends caseId when it is the ONLY identifier provided', async () => {
    await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'tok-3', caseId: 4242 });
    expect(JSON.parse(capturedBody!)).toEqual({ caseId: 4242 });
  });

  it('sends caseNumber and caseName together unchanged when both are given without caseId', async () => {
    await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'tok-4', caseNumber: 'RP2021', caseName: 'Brandon Doe vs Acme' });
    expect(JSON.parse(capturedBody!)).toEqual({ caseNumber: 'RP2021', caseName: 'Brandon Doe vs Acme' });
  });
});

// Regression tests for a live bug found 2026-07-29 (case AE-00224): its
// caseNumber is "AE-00224" but its fileNumber is "AE00224", and the dashboard's
// search results display fileNumber — so users type the string that 404s.
// GetCaseFullDetail exact-matches caseNumber only, for BOTH its caseNumber and
// caseName parameters (verified directly against the backend: caseName=
// "AE00224" 404s, caseName="AE-00224" succeeds). The first version of this
// fallback only covered the caseNumber parameter, so the identical user
// question still failed whenever the model chose to pass the string as
// caseName instead — which it does non-deterministically, and much more often
// once the conversation already contains case-name-shaped search results.
describe('fetchCaseFullDetail — resolves a fileNumber-shaped identifier in whichever field the model supplied it', () => {
  const SEARCH_HIT = {
    data: { cases: [{ id: 224, caseNumber: 'AE-00224', fileNumber: 'AE00224' }] },
  };

  function stubSearch(payload: unknown = SEARCH_HIT) {
    // Covers both the GetCaseListCombined lookup and the CaseDocs re-fetch;
    // the latter tolerates any shape it doesn't recognise.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
  }

  beforeEach(() => {
    capturedBody = undefined;
    capturedBodies = [];
    responseQueue = [];
    mockRequest.mockClear();
    vi.unstubAllGlobals();
  });

  it('retries with the real caseNumber when a caseNumber lookup 404s', async () => {
    responseQueue = [{ status: 404, body: { message: 'No case matched the supplied caseId/caseNumber/caseName.' } }];
    stubSearch();

    const result = await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'fb-1', caseNumber: 'AE00224' });

    expect(capturedBodies.map((b) => JSON.parse(b))).toEqual([{ caseNumber: 'AE00224' }, { caseNumber: 'AE-00224' }]);
    expect(result.success).toBe(true);
  });

  it('retries with the real caseNumber when the SAME string arrives as caseName', async () => {
    responseQueue = [{ status: 404, body: { message: 'No case matched the supplied caseId/caseNumber/caseName.' } }];
    stubSearch();

    const result = await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'fb-2', caseName: 'AE00224' });

    expect(capturedBodies.map((b) => JSON.parse(b))).toEqual([{ caseName: 'AE00224' }, { caseNumber: 'AE-00224' }]);
    expect(result.success).toBe(true);
  });

  // The widened trigger must not turn a genuine case-NAME argument into a
  // bogus retry: resolveCaseNumber only matches a string that exactly equals
  // some case's caseNumber or fileNumber, which a real case name never does.
  it('does not retry when the identifier matches no caseNumber/fileNumber exactly', async () => {
    responseQueue = [{ status: 404, body: { message: 'No case matched the supplied caseId/caseNumber/caseName.' } }];
    stubSearch({ data: { cases: [{ id: 9, caseNumber: 'ZZ-1', fileNumber: 'ZZ1' }] } });

    const result = await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'fb-3', caseName: 'Elgin Perdomo vs Allied Universal' });

    expect(capturedBodies).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('does not retry a caseId-only lookup (no string to resolve)', async () => {
    responseQueue = [{ status: 404, body: { message: 'No case matched the supplied caseId/caseNumber/caseName.' } }];
    stubSearch();

    const result = await fetchCaseFullDetail({ apiBaseUrl: 'https://uatapi.example.com', jwtToken: 'fb-4', caseId: 99999 });

    expect(capturedBodies).toHaveLength(1);
    expect(result.success).toBe(false);
  });
});
