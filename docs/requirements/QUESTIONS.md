# Open Questions — Aeliuscase Global Search Chatbot Widget
**Date Opened:** 2026-06-02
**Last Updated:** 2026-06-05
**Status:** Partially resolved — CaseController API.docx reviewed 2026-06-02; AI layer questions added 2026-06-05

These questions must be resolved before the corresponding work item can move to development. Each question is tagged with the artefact it blocks.

---

## API / Backend Questions

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| API-1 | What is the exact HTTP method and URL path for the case search endpoint? | api-contract.md, US-002 | Dev Team | **Resolved** |
| API-2 | Are JSON field names camelCase or snake_case? | api-contract.md, TypeScript interfaces | Dev Team | **Resolved** |
| API-3 | What are the exact valid values for the `status` field? | api-contract.md, US-002 AC4 | Dev Team | **Resolved** |
| API-4 | Is `caseUrl` returned directly by the API, or must the widget construct the URL from `caseId`? | api-contract.md, US-003 | Dev Team | **Partially Resolved** |
| API-5 | What is the structure of the error response body? | api-contract.md, US-005 | Dev Team | **Resolved** |
| API-6 | Does the API support CORS for browser requests? If not, will a reverse-proxy be provided? | api-contract.md, deployment | Infra / Dev Team | Open |
| API-7 | What is the maximum `pageSize` the API accepts? | api-contract.md, MVP-scope.md | Dev Team | **Resolved** |
| API-8 | Does the `query` parameter accept Sinhala Unicode text directly, or is a specific encoding / transliteration required? | US-002 AC7 | Dev Team | Open |
| API-9 | Is `openedDate` returned as an ISO 8601 date string or a full datetime string? | api-contract.md, case card formatting | Dev Team | **Resolved** |
| API-10 | Where is the CaseController API docx? Can it be shared so the contract template can be finalised? | api-contract.md | Project Manager | **Resolved** |
| API-11 | What is the exact URL path to open a case in the Aeliuscase web app? (e.g. `/cases/{id}` or `/kase/{id}`) Used to construct the "View" link since `caseUrl` is not returned by the API. | US-003, implementation-checklist.md | Dev Team / Frontend Team | **Open — NEW** |
| API-12 | The env variable name in MVP-scope.md is `VITE_API_JWT_TOKEN` but the project brief and user stories use `VITE_JWT_TOKEN`. Which is canonical? | api-contract.md, US-003, implementation-checklist.md | Product Owner / Dev Team | **Open — NEW** |

---

### API Question Resolutions (from CaseController API.docx reviewed 2026-06-02)

**API-1 — Resolved:**
The search endpoint is `GET /api/Case/Search` (not POST). Query parameters: `page` (int, required), `pageSize` (int, required), `searchText` (string, optional), `searchType` (int, optional — MainSearchType enum), `enteredUserId` (int, optional). Base path is `/api/Case` (not `/api/cases`).

**API-2 — Resolved:**
All JSON field names are camelCase (e.g. `caseNumber`, `caseStatusDescription`, `createdDateTime`, `caseApplicant`, `fileNumber`).

**API-3 — Resolved:**
Case status is returned as a string in the field `caseStatusDescription`. The exact status string values are defined by the `kaseStatus` dropdown (returned by `GET /api/Case/GetKaseDropdownData`); "Open" and "Closed" are confirmed from API examples. `searchType` (MainSearchType enum) can filter by status: `1`=AllCases, `2`=OpenCases, `3`=ClosedCases, `4`=SubOutCases, `5`=Documents, `6`=Events, `7`=Tasks, `8`=Contacts, `9`=SOL.

**API-4 — Partially Resolved:**
The `GET /api/Case/Search` response does NOT include a `caseUrl` field. The case `id` (integer) is returned. The widget must construct the case detail URL from a separately configured `VITE_APP_BASE_URL` and the case `id`. The exact path pattern within the Aeliuscase SPA is not documented in the API docx and must be confirmed (see API-11 above).

**API-5 — Resolved:**
Error response shape confirmed:
```json
{
  "status": 400,
  "succeeded": false,
  "message": "Error description",
  "errors": "Inner exception details",
  "data": null
}
```
The `succeeded` boolean is the primary signal. HTTP 401 is used for authentication failures; HTTP 400 for validation errors; HTTP 404 for not found; HTTP 500 for server errors. The `message` field contains a human-readable description.

**API-7 — Resolved:**
The API accepts any `pageSize`. The `GetAllKases` example uses `pageSize=10`; the `Search` example uses `pageSize=20`. No hard upper limit is documented. MVP will use `pageSize=20`.

**API-9 — Resolved:**
The API returns full ISO 8601 datetime strings (e.g. `"2026-03-26T17:35:27Z"`), not date-only strings. The widget must format these for display (suggested: `DD MMM YYYY` using `Intl.DateTimeFormat` or `date-fns`).

**API-10 — Resolved:**
CaseController API.docx was located in the project root (`E:\04-Dev Visal\Aeliuscase Global Search\CaseController API.docx`) and reviewed 2026-06-02. The api-contract.md template has been superseded by the confirmed endpoint details documented here and in the user stories.

---

## Product / Scope Questions

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| PRD-1 | Which Aeliuscase pages should the widget appear on — all pages, or a specific subset? | US-001 AC1, widget injection | Product Owner | Open |
| PRD-2 | Should the widget display case results from previous queries when re-opened within the same session, or always start fresh? | US-001, session state design | Product Owner | Open |
| PRD-3 | Is the 20-result cap per query acceptable to users, or do legal staff regularly need to browse larger result sets? | MVP-scope.md | Product Owner | Open |
| PRD-4 | Who is responsible for rotating the JWT token in production? Is a manual process acceptable long-term? | US-003, MVP-scope.md | Product Owner / Infra | Open |
| PRD-5 | Should the "View" link open the case in a new tab (current assumption) or navigate the current tab? | US-003 | Product Owner | **Resolved** |

### PRD Question Resolutions

**PRD-5 — Resolved:**
Confirmed in the project brief: "View" button opens the case in a **new browser tab** using `target="_blank"` and `rel="noopener noreferrer"`.

---

## Infrastructure / Deployment Questions

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| INF-1 | How is the widget bundle delivered to the host Aeliuscase page? (Script tag injection, npm package, iframe?) | Deployment architecture | Infra / Dev Team | Open |
| INF-2 | Is there a Content-Security-Policy on the Aeliuscase host that may block inline scripts or external API calls? | Widget integration | Infra | Open |
| INF-3 | Are there staging and production API base URLs, and will separate `.env` files be maintained per environment? | US-003, deployment | Dev Team | **Partially Resolved** |
| INF-4 | Is `https://uatapi.aeliuscase.com` the correct UAT base URL for the CaseController API? Does the API support CORS from the Aeliuscase web app origin? | api-contract.md, implementation-checklist.md | Dev Team / Infra | **Open — NEW** |

### INF Question Resolutions

**INF-3 — Partially Resolved:**
The UAT API base URL is `https://uatapi.aeliuscase.com` (confirmed in project brief). Production URL is not yet confirmed. Separate `.env` files per environment are recommended and documented in implementation-checklist.md.

---

## Confirmed Values (for api-contract.md update)

The following values are confirmed from the CaseController API docx and the project brief and should be used to update `api-contract.md`:

| Item | Confirmed Value |
|---|---|
| API base path | `/api/Case` |
| UAT base URL | `https://uatapi.aeliuscase.com` |
| Search endpoint | `GET /api/Case/Search` |
| Search parameter: query text | `searchText` (string, URL query param) |
| Search parameter: page | `page` (int, required) |
| Search parameter: page size | `pageSize` (int, required) |
| Search parameter: filter type | `searchType` (int, optional, MainSearchType enum) |
| Response wrapper | `PagedResponse<T>` with `succeeded`, `totalRecords`, `data[]` |
| Case ID field | `id` (integer) |
| Case number field | `caseNumber` (string) |
| Case name field | `caseName` (string) |
| Status field | `caseStatusDescription` (string) |
| Date field | `createdDateTime` (ISO 8601 datetime string) |
| Applicant field | `caseApplicant.fullName` (string, lowercase) |
| Case type field | `caseType` (string, e.g. "WCAB") |
| caseUrl | NOT returned — widget constructs from `VITE_APP_BASE_URL + '/cases/' + id` (path to confirm) |
| Error response | `{ status, succeeded, message, errors, data }` |
| Auth claim used server-side | `UserId` from JWT (used by coordinator endpoints) |

---

---

## AI Layer Questions (added 2026-06-05 — post-implementation review)

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| AI-13 | The `/api/chat/route.ts` AI layer uses OpenAI GPT-4o-mini. The project standard (CLAUDE.md) is Claude (claude-sonnet-4-6). Should the AI provider be switched to Claude/Anthropic? | app/api/chat/route.ts, OPENAI_API_KEY env var, billing | Product Owner / Dev Team | **Open — CRITICAL** |
| AI-14 | Is the AI chat layer within the agreed MVP scope? MVP-scope.md v1.0 explicitly excludes "local NLP processing" and states "Query is forwarded as-is to the CaseController API". The current implementation routes every query through an LLM. Was this a deliberate scope expansion? | MVP-scope.md, billing, product sign-off | Product Owner | **Open** |
| AI-15 | `src/types/chat.ts`, `src/hooks/useChatHistory.ts`, and `src/hooks/useCaseSearch.ts` were built to the original spec but are now unused (the AI SDK implementation bypasses them). Should they be deleted as dead code, or kept as a fallback if the AI layer is removed? | Code maintenance | Dev Team | **Open** |

### AI Layer Question Notes

**AI-13 — OpenAI vs Claude:**
The current implementation requires `OPENAI_API_KEY` in `.env.local`. To switch to Claude, replace `@ai-sdk/openai` with `@ai-sdk/anthropic`, update the model call from `openai('gpt-4o-mini')` to `anthropic('claude-haiku-4-5-20251001')` (or `claude-sonnet-4-6` for higher quality), and add `ANTHROPIC_API_KEY` to `.env.local`. The AI SDK 6.x provider swap is minimal — same `streamText` API.

**AI-14 — Scope:**
The AI layer adds: (1) an LLM call on every user message — cost and latency; (2) a new external API dependency (OpenAI or Anthropic); (3) intelligent query understanding (the LLM decides when to call `searchCases` vs. respond conversationally). This is materially beyond MVP v1.0. A product sign-off and cost estimate is recommended before moving to production.

---

## Updated API Questions

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| API-11 | Case detail URL path. `CaseCard.tsx` currently constructs URLs as `{NEXT_PUBLIC_APP_BASE_URL}/dashboard/case-overview/{id}`. Confirm this is the correct SPA route. | CaseCard.tsx, US-003 | Dev Team / Frontend Team | **Open — partially resolved** |
| API-12 | Env variable naming: original spec used `VITE_JWT_TOKEN`; actual implementation uses `JWT_TOKEN` (server-side, no prefix). This is correct for Next.js. User stories US-002, US-003, US-006 still reference old `VITE_` names. | US-002, US-003, US-006 | Dev Team | **Resolved in code — docs need update** |

### API-11 Update (2026-06-05)
`CaseCard.tsx` was implemented with `/dashboard/case-overview/{id}` as the URL path. This is a developer assumption. If the actual Aeliuscase SPA uses a different route (e.g. `/cases/{id}`, `/kase/{id}`), the `CaseCard.tsx` line must be updated. Confirm with Aeliuscase frontend team.

### API-12 Update (2026-06-05)
The migration to Next.js 15 resolved the env variable naming problem: `JWT_TOKEN` and `API_BASE_URL` are server-side only (no `VITE_`/`NEXT_PUBLIC_` prefix needed); `NEXT_PUBLIC_APP_BASE_URL` is the only client-side variable. The old Vite-era `VITE_JWT_TOKEN` name referenced in US-002, US-003, US-006, and MVP-scope.md is stale and should be updated in those documents.

---

## DEV Questions (internal — implementation decisions)

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| DEV-1 | Remove dead code? `src/types/chat.ts`, `src/hooks/useChatHistory.ts`, `src/hooks/useCaseSearch.ts` are unused by the current AI SDK architecture. | Code quality | Dev Team | **Open** |

---

## How to Resolve Remaining Questions

1. **AI-13 (OpenAI vs Claude):** Decision needed from Product Owner on AI provider and API key. If Claude: update `app/api/chat/route.ts` to use `@ai-sdk/anthropic` provider and `ANTHROPIC_API_KEY`. Remove `OPENAI_API_KEY` from `.env.example`.
2. **AI-14 (AI scope sign-off):** Schedule a product alignment call to confirm the AI layer is in scope, agree on cost budget, and update MVP-scope.md accordingly.
3. **AI-15 / DEV-1 (dead code):** If the AI layer is confirmed in scope, delete `src/types/chat.ts`, `src/hooks/useChatHistory.ts`, `src/hooks/useCaseSearch.ts`. If there's a plan to support a no-LLM fallback, keep them.
4. **API-6 / INF-4 (CORS):** CORS is not relevant for the Next.js proxy architecture — the browser only calls `localhost` or the same origin. This question is resolved by the architecture.
5. **API-8 (Sinhala Unicode):** Submit a test query with Sinhala characters and verify in Network tab that `searchText` is correctly encoded.
6. **API-11 (case detail URL path):** Ask the Aeliuscase frontend team for the correct SPA route. Update `CaseCard.tsx` line: `const caseDetailUrl = \`${appBaseUrl}/dashboard/case-overview/${caseItem.id}\`;`
7. **PRD-1, PRD-2, PRD-3, PRD-4:** Schedule a short product alignment call with the Product Owner.
8. **INF-1, INF-2:** Schedule a deployment alignment call with the Infra team.
