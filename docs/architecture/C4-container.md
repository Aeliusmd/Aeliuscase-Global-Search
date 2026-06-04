# C4 Level 2 — Container Diagram

## Aeliuscase Chatbot Widget — Internal Containers

This diagram shows the internal containers (logical building blocks) of the widget and their relationships
to the external CaseController REST API. At this scale "containers" map to distinct runtime or deployment
units, configuration boundaries, and major module responsibilities.

All field names below are derived from the actual CaseController API (`/api/Case` base path, confirmed
from `CaseController API.docx`).

```mermaid
C4Container
    title Container Diagram — Aeliuscase Chatbot Widget

    Person(user, "Legal Staff / Case Worker", "Types free-text queries to find legal cases.")

    System_Ext(caseApi, "CaseController REST API", "Base path: /api/Case. UAT base URL: https://uatapi.aeliuscase.com. Returns PagedResponse<T> with camelCase JSON. Bearer JWT required on all endpoints.")
    System_Ext(aeliusApp, "Aeliuscase Web Application", "Hosts case detail pages. The widget opens these in a new browser tab.")

    System_Boundary(widget, "Aeliuscase Chatbot Widget — Vite React SPA Bundle") {

        Container(chatWidget, "ChatWidget", "React 19 / TypeScript", "Root mount point. Renders FloatingButton at all times. Owns isOpen boolean state. Conditionally renders ChatPanel when isOpen = true.")

        Container(floatingButton, "FloatingButton", "React 19 / TypeScript / Tailwind CSS", "Fixed-position icon button, bottom-right corner. Fires onClick to toggle ChatWidget.isOpen. Visually distinct open vs. closed state (icon swap).")

        Container(chatPanel, "ChatPanel", "React 19 / TypeScript / Tailwind CSS", "Slide-in panel rendered when isOpen. Owns the messages[] conversation array. Composes MessageList and ChatInput. Calls useCaseSearch on user submit.")

        Container(messageList, "MessageList", "React 19 / TypeScript / Tailwind CSS", "Scrollable container rendering one entry per conversation turn. Delegates to UserMessage, BotMessage, or CaseResultList based on message.type.")

        Container(userMessage, "UserMessage", "React 19 / TypeScript / Tailwind CSS", "Right-aligned bubble rendering the user's raw query string.")

        Container(botMessage, "BotMessage", "React 19 / TypeScript / Tailwind CSS", "Left-aligned bubble for system text responses (loading, error, empty state, JWT-expired guidance).")

        Container(caseResultList, "CaseResultList", "React 19 / TypeScript / Tailwind CSS", "Bot response variant that renders a list of CaseCard components when the API returns one or more results.")

        Container(caseCard, "CaseCard", "React 19 / TypeScript / Tailwind CSS", "Displays one case result. Fields shown: caseNumber / fileNumber, caseName, caseType, caseStatusDescription, createdDateTime (formatted DD MMM YYYY). 'View' button calls window.open(caseDetailUrl, '_blank', 'noopener,noreferrer').")

        Container(chatInput, "ChatInput", "React 19 / TypeScript / Tailwind CSS", "Text field + Send button. Submit on Enter key or button click. Forwards raw query string up to ChatPanel.onSubmit.")

        Container(useCaseSearch, "useCaseSearch", "React 19 custom hook / TypeScript", "Orchestration hook. Accepts a raw query string. Calls caseApi.searchCases(). Manages loading, cases, and error state. Returns { cases, loading, error, search }. Maps 401 response to a JWT-expired error variant.")

        Container(useChatHistory, "useChatHistory", "React 19 custom hook / TypeScript", "Manages the messages[] array for the session lifetime. Appends UserMessage and BotMessage entries. Provides clearHistory(). State is session-only: not persisted across page reloads.")

        Container(caseApiClient, "caseApi.ts", "TypeScript / Axios", "Axios instance with baseURL = import.meta.env.VITE_API_BASE_URL. Request interceptor injects Authorization: Bearer <VITE_JWT_TOKEN> header. Exports searchCases(params: CaseSearchParams): Promise<Case[]>. Calls GET /api/Case/Search with page, pageSize, searchText, searchType query params. Unwraps PagedResponse<T>.data array.")

        Container(caseTypes, "types/case.ts + types/chat.ts", "TypeScript", "case.ts: Case (mapped from Search response), CaseSearchParams, PagedApiResponse<T>, ApiError. chat.ts: Message, MessageType enum (USER | BOT_TEXT | BOT_CASES | BOT_ERROR), ChatState.")

        Container(envConfig, ".env / .env.example", "Vite environment variables", "VITE_JWT_TOKEN: Bearer token (~1 hour TTL, manually rotated). VITE_API_BASE_URL: e.g. https://uatapi.aeliuscase.com. Not committed to version control. .env.example is committed as a template.")
    }

    %% User interactions
    Rel(user, chatWidget, "Clicks floating button", "DOM click event")
    Rel(user, chatInput, "Types query and submits", "DOM keyboard / click event")

    %% Render tree
    Rel(chatWidget, floatingButton, "Always renders", "React render tree")
    Rel(chatWidget, chatPanel, "Renders when isOpen = true", "React render tree")
    Rel(chatPanel, messageList, "Renders message history", "React render tree")
    Rel(chatPanel, chatInput, "Renders input bar", "React render tree")
    Rel(messageList, userMessage, "Renders for message.type = USER", "React render tree")
    Rel(messageList, botMessage, "Renders for BOT_TEXT and BOT_ERROR", "React render tree")
    Rel(messageList, caseResultList, "Renders for message.type = BOT_CASES", "React render tree")
    Rel(caseResultList, caseCard, "One card per Case in results[]", "React render tree")

    %% Hook wiring
    Rel(chatPanel, useCaseSearch, "Calls search(queryString) on submit", "React hook call")
    Rel(chatPanel, useChatHistory, "Calls append() to add messages", "React hook call")

    %% Infrastructure layer
    Rel(useCaseSearch, caseApiClient, "Calls searchCases(params)", "TypeScript async call")
    Rel(caseApiClient, envConfig, "Reads VITE_JWT_TOKEN, VITE_API_BASE_URL", "import.meta.env at build time")
    Rel(caseApiClient, caseTypes, "Returns typed Case[]", "TypeScript types")

    %% External API call
    Rel(caseApiClient, caseApi, "GET /api/Case/Search?page=1&pageSize=20&searchText=...&searchType=2", "HTTPS / REST / Authorization: Bearer {token}")

    %% Deep-link navigation
    Rel(caseCard, aeliusApp, "window.open(caseDetailUrl, '_blank', 'noopener,noreferrer')", "Browser navigation — new tab")
```

---

## Container responsibilities summary

| Container | Layer | Primary responsibility |
|---|---|---|
| ChatWidget | Presentation — Root | Mount point; floating button; open/close state |
| FloatingButton | Presentation | Fixed-position chat icon; toggle trigger |
| ChatPanel | Presentation | Chat panel shell; message thread; submit dispatch |
| MessageList | Presentation | Scrollable conversation history renderer |
| UserMessage | Presentation | User query bubble |
| BotMessage | Presentation | System text response bubble (loading / error / empty) |
| CaseResultList | Presentation | Bot response variant containing case cards |
| CaseCard | Presentation | Single case result display + deep-link navigation |
| ChatInput | Presentation | Text field + Send button |
| useCaseSearch | Application | Search orchestration; loading / error / result state |
| useChatHistory | Application | Session message history management |
| caseApi.ts | Infrastructure | HTTP transport; JWT injection; URL construction |
| types/case.ts | Domain | API response type contracts |
| types/chat.ts | Domain | UI message shape contracts |
| .env | Configuration | Developer-managed runtime credentials |

---

## Confirmed API endpoints used by the widget

The widget's primary integration point is the search endpoint confirmed in `CaseController API.docx`:

| Usage | Method | Path | Key params |
|---|---|---|---|
| Case search (primary) | GET | `/api/Case/Search` | `page`, `pageSize`, `searchText`, `searchType` (2 = OpenCases) |
| Autocomplete / dropdown | GET | `/api/Case/Dropdown` | `page`, `pageSize`, `searchText` |
| Update last viewed | PUT | `/api/Case/UpdateLastView` | body: `{ id: int }` |

The `MainSearchType` enum controls scope: `1` = AllCases, `2` = OpenCases, `3` = ClosedCases, etc.
The widget defaults to `searchType=1` (AllCases) and lets the user's query text filter results.

---

## Search response field mapping

The Search endpoint (`GET /api/Case/Search`) returns `PagedResponse<T>` with the following `data[]` fields
that the widget consumes. Field names are camelCase (confirmed from docx).

| API field | Widget display | Notes |
|---|---|---|
| `id` | React list key | Numeric integer, used as `key` prop |
| `fileNumber` / `caseNumber` | Case number on card | Both exist; display `caseNumber` |
| `caseName` | Card title | e.g. "John Doe vs ABC Company" |
| `caseType` | Type badge on card | "WCAB" or "Personal Injury" |
| `caseStatusDescription` | Status badge | e.g. "Open", "Closed" |
| `createdDateTime` | "Opened" date on card | ISO 8601 datetime → format as DD MMM YYYY |
| `caseApplicant.fullName` | Applicant name on card | Available for WCAB cases |

The `caseDetailUrl` is NOT returned by the API. The widget constructs it as:
`{VITE_AELIUS_APP_BASE_URL}/cases/{id}` — a third env variable `VITE_AELIUS_APP_BASE_URL` must be
added to `.env` to support deep-link generation.

---

## Data flow — happy path

```
User types query and presses Enter
  -> ChatPanel.handleSubmit(queryString)
  -> useChatHistory.append({ type: USER, text: queryString })
  -> useCaseSearch.search(queryString)
      -> caseApi.searchCases({ page: 1, pageSize: 20, searchText: queryString, searchType: 1 })
          -> GET /api/Case/Search?page=1&pageSize=20&searchText=...&searchType=1
             Authorization: Bearer <VITE_JWT_TOKEN>
          <- PagedResponse { data: Case[], totalRecords, page, pageSize }
      <- Case[] (typed)
  -> useChatHistory.append({ type: BOT_CASES, cases: Case[] })
  -> MessageList re-renders; CaseResultList renders N CaseCard components
  -> User clicks "View" on a CaseCard
  -> window.open("https://aeliusapp.example.com/cases/9806", "_blank", "noopener,noreferrer")
```

## Data flow — 401 JWT expired

```
  -> GET /api/Case/Search → HTTP 401
  -> caseApi.ts Axios interceptor detects 401
  -> throws ApiError { code: 'JWT_EXPIRED', status: 401 }
  -> useCaseSearch sets error = { type: 'JWT_EXPIRED' }
  -> ChatPanel renders BotMessage with JWT-expiry guidance text
     "Your session token has expired. Ask a developer to update .env and restart."
```

---

## Environment variables (complete set)

| Variable | Example value | Purpose |
|---|---|---|
| `VITE_JWT_TOKEN` | `eyJhbGci...` | Bearer token; rotate every ~1 hour |
| `VITE_API_BASE_URL` | `https://uatapi.aeliuscase.com` | CaseController API base URL; no trailing slash |
| `VITE_AELIUS_APP_BASE_URL` | `https://uat.aeliuscase.com` | Aeliuscase web app base URL for constructing case deep-links |
