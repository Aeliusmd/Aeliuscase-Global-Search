# User Stories — Aeliuscase Global Search Chatbot Widget
**Epic:** Chatbot Widget
**Version:** 1.1
**Date:** 2026-06-02
**Status:** Updated — API contract confirmed from CaseController API.docx

---

## Change Log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-02 | Initial draft |
| 1.1 | 2026-06-02 | Updated env variable name to `VITE_JWT_TOKEN` (per project brief); updated US-002 AC6 to reflect confirmed `GET /api/Case/Search` endpoint and actual response shape from CaseController API docx; updated US-006 AC1 env var name; added note on `caseUrl` construction since the API does not return a `caseUrl` field |

---

## US-001: Open and Close the Chatbot Widget

**As a** legal staff member using Aeliuscase,
**I want to** open and close the chatbot widget by clicking a floating icon,
**So that** I can access case search quickly without navigating away from my current work.

### Acceptance Criteria

- [ ] **AC1 — Icon is always visible:**
  Given I am on any Aeliuscase page,
  When the page has finished loading,
  Then a floating chatbot icon is visible in the bottom-right corner of the viewport.

- [ ] **AC2 — Click to open:**
  Given the chat window is closed,
  When I click the floating chatbot icon,
  Then the chat window opens, is visible on screen, and the input field receives focus automatically.

- [ ] **AC3 — Click icon to close:**
  Given the chat window is open,
  When I click the floating chatbot icon again,
  Then the chat window closes and the floating icon remains visible.

- [ ] **AC4 — Escape key closes the window:**
  Given the chat window is open,
  When I press the Escape key,
  Then the chat window closes.

- [ ] **AC5 — Chat window does not obstruct the host page:**
  Given the chat window is open,
  When I attempt to interact with Aeliuscase UI elements behind the chat window,
  Then the chat window does not cover the full viewport and core navigation elements remain accessible.

### Definition of Done
- Unit tests pass for open/close toggle logic
- Manual test verified on Chrome (latest) and Edge (latest)
- No console errors on open or close

---

## US-002: Type a Natural Language Query and Receive Case Results

**As a** legal staff member,
**I want to** type a plain English (or Sinhala) query into the chatbot and receive a list of matching case cards,
**So that** I can find relevant cases quickly without learning a complex search syntax.

### Acceptance Criteria

- [ ] **AC1 — Query submission via Enter key:**
  Given the chat window is open and the input field is focused,
  When I type a query and press Enter,
  Then the query is submitted to `GET /api/Case/Search` on the CaseController API.

- [ ] **AC2 — Query submission via Send button:**
  Given the chat window is open and I have typed a query,
  When I click the Send button,
  Then the query is submitted to `GET /api/Case/Search` on the CaseController API.

- [ ] **AC3 — Loading state is shown:**
  Given I have submitted a query,
  When the API call is in-flight,
  Then a loading indicator (spinner or skeleton) is visible inside the chat window and the input field is disabled to prevent duplicate submissions.

- [ ] **AC4 — Results appear as case cards:**
  Given the API returns one or more case records in the `data` array of the `PagedResponse`,
  When the response is received and `succeeded` is `true`,
  Then each case is rendered as a card showing: Case Number (`caseNumber`), Case Name (`caseName`), Applicant full name (`caseApplicant.fullName`), Status (`caseStatusDescription`), and Created Date (`createdDateTime` formatted as `DD MMM YYYY`).

- [ ] **AC5 — Up to 20 results are displayed:**
  Given the API is called with `pageSize=20`,
  When the results are rendered,
  Then only the first 20 cards are shown and, if `totalRecords` exceeds 20, a note indicates that the result set was truncated.

- [ ] **AC6 — JWT token is included in the request:**
  Given the `.env` file contains `VITE_JWT_TOKEN`,
  When any search query is submitted,
  Then the HTTP request to `GET /api/Case/Search` includes the header `Authorization: Bearer <token>`.

- [ ] **AC7 — Sinhala script input is accepted:**
  Given I type a query using Sinhala Unicode characters,
  When I submit the query,
  Then the characters are preserved exactly in the `searchText` query parameter and forwarded to the API without corruption.

### Definition of Done
- Unit tests pass for query submission, loading state, and result rendering
- API integration verified against the UAT CaseController endpoint (`https://uatapi.aeliuscase.com/api/Case/Search`)
- Manual test on Chrome (latest) and Edge (latest)
- No console errors during a successful search session

---

## US-003: View a Case in a New Browser Tab from a Result Card

**As a** legal staff member,
**I want to** click a "View" button on a result card to open the full case,
**So that** I can review case details without losing my current context in Aeliuscase.

### Acceptance Criteria

- [ ] **AC1 — Every result card has a View button:**
  Given one or more case cards are displayed in the chat window,
  When I look at any card,
  Then a clearly labelled "View" button or link is present on the card.

- [ ] **AC2 — View opens case in a new tab:**
  Given a case card with a valid case `id` is displayed,
  When I click the "View" button,
  Then the case URL constructed from the base URL and case `id` opens in a new browser tab and the current Aeliuscase tab remains unchanged.

  > Note: The CaseController API does not return a `caseUrl` field. The widget must construct the URL from `VITE_API_BASE_URL` and the case `id` field. Pattern to confirm with dev team: `{APP_BASE_URL}/cases/{id}`.

- [ ] **AC3 — New tab uses secure link attributes:**
  Given the View button renders an anchor element,
  When the HTML is inspected,
  Then the anchor has `target="_blank"` and `rel="noopener noreferrer"`.

- [ ] **AC4 — Chat window remains open after viewing:**
  Given I have clicked View on a result card,
  When the new tab opens,
  Then the chat window on the original tab remains open and the result list is still visible.

### Definition of Done
- Unit test verifies anchor attributes (`target`, `rel`) on case cards
- Manual test confirms new tab opens correctly in Chrome and Edge
- No focus loss or scroll reset in the chat window after clicking View

---

## US-004: Empty State — No Results Found

**As a** legal staff member,
**I want to** see a clear message when my query returns no matching cases,
**So that** I know the search completed successfully and can try a different query.

### Acceptance Criteria

- [ ] **AC1 — Empty state message is displayed:**
  Given I submit a query,
  When the API returns a successful response (`succeeded: true`) with `totalRecords: 0` and an empty `data` array,
  Then the chat window displays a message such as "No cases found for your search."

- [ ] **AC2 — Original query is echoed in the empty state:**
  Given the empty state is displayed,
  When I read the message,
  Then it includes the query I submitted so I can confirm what was searched.

- [ ] **AC3 — Input field is re-enabled after empty result:**
  Given the empty state is displayed,
  When I look at the input field,
  Then it is enabled and I can type a new query immediately.

- [ ] **AC4 — No case cards are rendered in the empty state:**
  Given the empty state is displayed,
  When I inspect the chat window,
  Then no case card elements are present in the DOM.

### Definition of Done
- Unit test covers the empty-response branch (`totalRecords: 0`, `data: []`)
- Empty state tested manually with a query that is known to return zero results
- Verified on Chrome and Edge

---

## US-005: Error State — API Failure and JWT Expiry

**As a** legal staff member,
**I want to** see a clear, actionable error message when the case search fails,
**So that** I understand what went wrong and know what to do next (e.g. notify IT if the token has expired).

### Acceptance Criteria

- [ ] **AC1 — Generic API error message:**
  Given I submit a query,
  When the API returns a non-2xx HTTP response (excluding 401) or the network request fails entirely,
  Then the chat window displays an error message such as "Something went wrong. Please try again."

- [ ] **AC2 — JWT-expired / 401 error message:**
  Given I submit a query,
  When the API returns a 401 Unauthorized response,
  Then the chat window displays a specific message such as "Session token has expired. Please contact your administrator to refresh the API token."

- [ ] **AC3 — API validation error message:**
  Given I submit a query,
  When the API returns a 400 Bad Request response with `succeeded: false`,
  Then the chat window displays the `message` field from the response body if present, or a generic fallback error message.

- [ ] **AC4 — Input field is re-enabled after an error:**
  Given an error state is displayed,
  When I look at the input field,
  Then it is enabled and I can submit a new query without refreshing the page.

- [ ] **AC5 — Error does not crash the widget:**
  Given an error state is displayed,
  When I inspect the browser console,
  Then no unhandled JavaScript exceptions have been thrown.

- [ ] **AC6 — Previous results are cleared on new query after error:**
  Given an error was displayed from a previous query,
  When I submit a new query that succeeds,
  Then the error message is replaced by the new result cards.

### Definition of Done
- Unit tests cover 401, 400, generic non-2xx, and network failure branches
- Error states tested manually by providing an invalid JWT and by disabling the network
- Verified on Chrome and Edge

---

## US-006: JWT Token Configuration via .env

**As a** developer deploying the chatbot widget,
**I want to** configure the API JWT token and base URL via an `.env` file,
**So that** I can update credentials and target different environments without modifying source code.

### Acceptance Criteria

- [ ] **AC1 — JWT token is read from .env:**
  Given the `.env` file contains `VITE_JWT_TOKEN=<token>`,
  When a search query is submitted,
  Then the request Authorization header value matches the token from `.env` exactly.

- [ ] **AC2 — API base URL is read from .env:**
  Given the `.env` file contains `VITE_API_BASE_URL=<url>`,
  When a search query is submitted,
  Then the request is sent to the URL constructed from `VITE_API_BASE_URL` (not a hardcoded URL).

- [ ] **AC3 — Missing token produces a widget-level warning:**
  Given `VITE_JWT_TOKEN` is not set or is an empty string in `.env`,
  When the chat window is opened,
  Then the widget displays a configuration warning (e.g. "API token not configured") and disables the input field.

- [ ] **AC4 — No credentials appear in source code:**
  Given the production build is inspected,
  When source files and the compiled bundle are scanned for hardcoded JWT strings,
  Then no JWT token or API secret values are present in committed source files.

- [ ] **AC5 — .env file is excluded from version control:**
  Given the repository root is inspected,
  When the `.gitignore` file is read,
  Then `.env` and `.env.local` are listed as ignored files.

### Definition of Done
- Unit test mocks `import.meta.env` and verifies the Authorization header is set correctly
- `.gitignore` contains `.env` and `.env.local` entries
- `README.md` documents the required `.env` variables
- Verified on Chrome and Edge after rotating the token value in `.env`

---

## Story Map Summary

| ID | Title | Priority |
|---|---|---|
| US-001 | Open and Close Chatbot Widget | Must Have |
| US-002 | Type Query and Receive Case Results | Must Have |
| US-003 | View Case in New Tab | Must Have |
| US-004 | Empty State | Must Have |
| US-005 | Error State (API Failure / JWT Expiry) | Must Have |
| US-006 | JWT Token Configuration via .env | Must Have |

All six stories are **Must Have** for MVP v1.0. No Should Have or Could Have stories are defined at this stage.
