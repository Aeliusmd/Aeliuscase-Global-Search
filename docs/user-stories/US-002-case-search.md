# US-002: Natural Language Case Search
**Epic:** Chatbot Widget — Case Search Flow
**Version:** 1.0
**Date:** 2026-06-02
**Status:** Draft — Based on confirmed CaseController API (GET /api/Case/Search)

---

## User Story

**As a** legal staff member,
**I want to** type a natural language query in the chatbot,
**So that** I see a filtered list of my cases that match my query.

---

## Background and Context

The chatbot widget sends the user's free-text query as the `searchText` query parameter to `GET /api/Case/Search`. The API applies its own keyword matching and returns a paginated `PagedResponse` containing an array of case objects. No local NLP or intent parsing is performed by the widget. The JWT in the request header identifies the user; the API returns only records accessible to that user.

The confirmed endpoint from the CaseController API documentation is:

```
GET /api/Case/Search?page=1&pageSize=20&searchText={query}&searchType={type}
Authorization: Bearer {VITE_JWT_TOKEN}
```

`searchType` values (MainSearchType enum):
- `1` = AllCases (default)
- `2` = OpenCases
- `3` = ClosedCases
- `4` = SubOutCases

For the MVP chatbot widget, `searchType=1` (AllCases) is used unless the natural language query explicitly implies a status filter. Status filtering via `searchType` is a post-MVP enhancement.

---

## Acceptance Criteria

### AC1 — Query submitted via Enter key
Given the chat window is open and the input field is focused,
When I type a query and press the Enter key,
Then the query text is sent as the `searchText` parameter in a `GET` request to `/api/Case/Search` with `page=1`, `pageSize=20`, and `searchType=1`.

### AC2 — Query submitted via Send button
Given the chat window is open and I have typed at least one character in the input field,
When I click the Send button,
Then the same `GET /api/Case/Search` request is made as described in AC1.

### AC3 — Empty query is not submitted
Given the input field is empty or contains only whitespace,
When I press Enter or click Send,
Then no API request is made and the input field retains focus.

### AC4 — JWT Bearer token is attached to every request
Given the `.env` file contains a non-empty `VITE_JWT_TOKEN`,
When the search request is sent to `GET /api/Case/Search`,
Then the HTTP request includes the header `Authorization: Bearer <VITE_JWT_TOKEN>` and the token value matches the `.env` value exactly.

### AC5 — Loading indicator is shown during the API call
Given a query has been submitted,
When the HTTP request to `/api/Case/Search` is in-flight,
Then a loading indicator is visible in the chat panel and the input field is disabled to prevent duplicate submissions.

### AC6 — Case result cards are rendered on success
Given the API responds with HTTP 200 and `succeeded: true` and at least one item in the `data` array,
When the response is received,
Then each item in `data` is rendered as a case card displaying:
- Case Number (field: `caseNumber`)
- Case Name (field: `caseName`)
- Applicant Full Name (field: `caseApplicant.fullName`)
- Status (field: `caseStatusDescription`, rendered as a colour-coded badge)
- Created Date (field: `createdDateTime`, formatted as `DD MMM YYYY`)
- Case Type (field: `caseType`, e.g. "WCAB" or "Personal Injury")

### AC7 — Result count and truncation notice
Given the API responds with `totalRecords` greater than 20,
When the results are rendered,
Then a notice is shown (e.g. "Showing 20 of {totalRecords} results") immediately above or below the result list.

### AC8 — Empty state when no results are returned
Given the API responds with HTTP 200, `succeeded: true`, and `totalRecords: 0` with an empty `data` array,
When the response is received,
Then the chat panel displays the message: "No cases found for '{query}'. Try a different search term."
And no case card elements are rendered in the DOM.

### AC9 — Generic error state on non-2xx response (excluding 401)
Given the API responds with a non-2xx HTTP status code that is not 401,
When the response is received,
Then the chat panel displays: "Something went wrong. Please try again."
And the `message` field from the response body (`succeeded: false`) is logged to the browser console for developer diagnostics.

### AC10 — 401 error state with token-rotation guidance
Given the API responds with HTTP 401 Unauthorized,
When the response is received,
Then the chat panel displays: "Session token has expired. Please ask your administrator to update the API token in the .env file and restart the dev server."
And the input field is re-enabled so the user can retry after the token is rotated.

### AC11 — Network error state
Given the network request fails entirely (DNS failure, timeout, CORS preflight rejection),
When the request errors before a response is received,
Then the chat panel displays: "Unable to reach the server. Please check your network connection and try again."

### AC12 — Input re-enabled after any outcome
Given a search has completed (success, empty result, or error),
When the final state is rendered in the chat panel,
Then the input field is enabled and the user can type a new query without reloading the page.

### AC13 — Sinhala Unicode query is preserved
Given I type a query using Sinhala Unicode characters (U+0D80 through U+0DFF),
When the search request is sent,
Then the `searchText` query parameter in the URL is correctly percent-encoded from the original Unicode input and the API receives the unaltered Sinhala text.

### AC14 — Previous results are replaced by a new search
Given one or more result cards from a previous query are visible,
When I submit a new query,
Then the previous result cards are replaced by the loading indicator and subsequently by the new results (or empty/error state) from the new query.

---

## Out-of-Scope for This Story

- Parsing the natural language query to extract filter intent (status, date range) — post-MVP
- Pagination beyond the first 20 results — post-MVP
- Saving or replaying past searches — post-MVP
- `searchType` auto-detection from query text — post-MVP

---

## API Reference (Confirmed)

**Endpoint:** `GET /api/Case/Search`
**Base URL:** Configured via `VITE_API_BASE_URL` (UAT: `https://uatapi.aeliuscase.com`)

**Query Parameters:**

| Parameter | Type | Required | Value for MVP |
|---|---|---|---|
| `page` | int | Yes | `1` |
| `pageSize` | int | Yes | `20` |
| `searchText` | string | No | User's free-text query |
| `searchType` | int | No | `1` (AllCases) |
| `enteredUserId` | int | No | Omitted in MVP |

**Success Response Shape (PagedResponse):**

```json
{
  "page": 1,
  "pageSize": 20,
  "totalPages": 3,
  "totalRecords": 5,
  "isFirstPage": true,
  "isLastPage": false,
  "hasMorePages": true,
  "status": 200,
  "succeeded": true,
  "message": "Successfully Completed",
  "errors": null,
  "errorCode": 0,
  "data": [
    {
      "id": 9806,
      "fileNumber": "RP003782",
      "caseNumber": "RP003782",
      "caseTypeId": 1,
      "caseType": "WCAB",
      "caseStatusDescription": "Open",
      "caseAttorneyNickName": "JS",
      "caseCoordinatorNickName": "RP",
      "createdDateTime": "2026-03-26T17:35:27Z",
      "caseApplicant": {
        "firstName": "John",
        "lastName": "Doe",
        "fullName": "johndoe",
        "dob": "1985-06-15",
        "ssn": "****1234",
        "phone": "5551234567"
      },
      "caseEmployee": { "company": "ABC Company" },
      "injury": [{ "injuryAdjNo": "ADJ12345", "doiStart": "2026-01-15" }]
    }
  ]
}
```

**Error Response Shape:**

```json
{
  "status": 400,
  "succeeded": false,
  "message": "Error message",
  "errors": "Inner exception details",
  "data": null
}
```

**Note on `caseUrl`:** The API does not return a `caseUrl` field. The widget constructs the case link using the case `id` and a separate `VITE_APP_BASE_URL` environment variable. The exact URL pattern (`{VITE_APP_BASE_URL}/cases/{id}`) must be confirmed with the dev team before implementation of US-003.

---

## Definition of Done

- [ ] All 14 acceptance criteria have corresponding unit or integration tests
- [ ] API integration smoke-tested against `https://uatapi.aeliuscase.com/api/Case/Search` with a valid JWT
- [ ] Sinhala Unicode input manually verified by submitting a Sinhala query and confirming the `searchText` parameter in the Network tab
- [ ] 401 error state manually tested by using an expired or invalid JWT
- [ ] No unhandled JavaScript exceptions in Chrome DevTools during any of the above tests
- [ ] TypeScript build (`vite build`) passes with no errors
- [ ] Tested on Chrome (latest stable) and Microsoft Edge (latest stable)
