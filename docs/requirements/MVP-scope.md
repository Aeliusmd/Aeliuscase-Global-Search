# MVP Scope — Aeliuscase Global Search Chatbot Widget
**Version:** 2.0
**Date:** 2026-06-05
**Status:** Updated to reflect Next.js 15 implementation and AI chat layer. Pending stakeholder sign-off on AI scope expansion.

> **Change from v1.0:** Stack changed from Vite+React to Next.js 15 (App Router). An AI chat layer (LLM-mediated search via Vercel AI SDK) was added beyond the original spec. JWT is now server-side only — never in the browser bundle. All `VITE_*` env variable names have been replaced with Next.js equivalents.

---

## Overview

A chatbot widget (Next.js 15 + React 19 + TypeScript + Tailwind CSS) embedded on the Aeliuscase legal case management platform. The widget allows legal staff to search and filter cases using natural language queries, surfacing results as interactive case cards without leaving the current page.

Chat messages are processed by an LLM (AI layer) which calls the CaseController Search API as a tool, then streams a response back to the widget. The JWT token is never exposed to the browser — it lives exclusively on the Next.js server.

---

## In Scope — MVP v2.0

### Widget Shell
- Floating chatbot icon rendered in the bottom-right corner of the host page
- Click to open / click or press Escape to close the chat window
- Chat window renders inside the host page (no modal overlay, no separate route)
- Responsive layout that does not obstruct core Aeliuscase UI

### Chat Interaction
- Single text input field accepting free-text natural language queries in English or Sinhala script
- Submit on Enter key or a Send button
- Query is sent to `/api/chat` (Next.js API Route) where an LLM processes it and calls the CaseController API as a tool
- Loading / streaming state while awaiting AI response
- Search type filter (All Cases | Open | Closed | Sub-Out) as pill buttons above the input
- Chat history persisted to localStorage; clear button in panel header

### Case Result Cards
- Results rendered as a scrollable list of case cards inside the chat window
- Each card displays: Case Number, Case Name, Applicant Name, Status badge, Case Type, Created Date
- "View Case" link on each card opens the case URL in a new browser tab (`target="_blank"`, `rel="noopener noreferrer"`)
- Default 20 results per query; "Load More" button for paginated results when `hasMorePages` is true

### AI Chat Layer (new in v2.0)
- Every user message is processed by an LLM (currently OpenAI GPT-4o-mini; target: Claude — see QUESTIONS.md AI-13)
- LLM uses the `searchCases` tool to call `GET /api/Case/Search` on the CaseController API
- LLM provides a short summary alongside case results (e.g. "Found 42 open cases for John Smith")
- Non-search messages (greetings, thanks) receive a conversational response without a tool call
- `searchTypeHint` from the active filter is included in the LLM system prompt

### Empty State
- Friendly message when the API returns zero results
- Message includes the original query text

### Error State
- Distinct error message on API failure (network error, non-2xx response)
- Specific guidance when a 401 response is received (JWT expired)
- User can retry without refreshing

### Authentication & Security
- `JWT_TOKEN` loaded from server-side `.env.local` only — **never reaches the browser**
- Token injected into CaseController API requests inside the Next.js server
- No login UI; token rotation is a developer/operator responsibility in MVP

### Environment Configuration
- All API base URL, JWT token, AI API key, and app base URL values configurable via `.env.local`
- No hardcoded credentials or URLs in source code
- `.env.example` committed with placeholder values documenting required variables

### Browser Support
- Chrome (latest stable)
- Microsoft Edge (latest stable)

---

## Out of Scope — MVP v2.0

| Item | Reason |
|---|---|
| Automatic JWT refresh / OAuth flow | Manual rotation is accepted MVP trade-off |
| User authentication UI (login screen) | Host platform handles auth |
| Advanced filter UI beyond status filter | Status filter pill buttons now in scope; date/user filters post-MVP |
| Sinhala NLP / intent parsing beyond LLM | LLM handles intent; no separate NLP pipeline |
| Case creation or editing from widget | Read-only search widget |
| Mobile / touch layout optimisation | Desktop legal workstations are the primary target |
| Firefox, Safari browser support | Post-MVP |
| Dark mode | Post-MVP |
| Analytics / usage tracking | Post-MVP |
| Full WCAG AA audit | Basic keyboard navigation + ARIA in scope; full audit post-MVP |
| Unit test coverage > 80% | Smoke tests and manual testing sufficient for MVP |
| AI model fine-tuning | Off-the-shelf model is sufficient |
| AI response caching | Post-MVP optimisation |

---

## Environment Variables (v2.0)

| Variable | Side | Required | Description |
|---|---|---|---|
| `JWT_TOKEN` | Server | Yes | JWT Bearer token for CaseController API. No `NEXT_PUBLIC_` prefix — server-side only. |
| `API_BASE_URL` | Server | Yes | CaseController base URL. UAT: `https://uatapi.aeliuscase.com`. |
| `OPENAI_API_KEY` | Server | Yes* | OpenAI API key for AI chat layer. *Replace with `ANTHROPIC_API_KEY` once AI-13 is resolved. |
| `NEXT_PUBLIC_APP_BASE_URL` | Client | Yes | Aeliuscase web app base URL. Used to construct case detail links. UAT: `https://uat.aeliuscase.com`. |

> `JWT_TOKEN` and `API_BASE_URL` must NOT have the `NEXT_PUBLIC_` prefix. They are read only by server-side API routes. Exposing them via `NEXT_PUBLIC_` would leak the JWT to the browser.

---

## Success Criteria (v2.0)

MVP v2.0 is considered complete when ALL of the following are true:

1. **Functional:** A legal staff member can open the chat widget, type "show me open cases for [client name]", and receive matching case cards within 5 seconds on a standard office network (includes LLM round-trip).
2. **AI-mediated:** The LLM correctly calls the `searchCases` tool for any case search request and responds conversationally for non-search messages (e.g. greetings).
3. **Navigation:** Clicking "View Case" on any result card opens the correct case in a new browser tab without navigating away from the current page.
4. **Security:** The `Authorization: Bearer <JWT>` header is not visible in the browser's Network tab — all API calls are server-to-server.
5. **Error handling:** When the JWT token is expired or missing, the widget displays a clear, actionable error message.
6. **Configuration:** A developer can switch environments by editing only `.env.local` and restarting the server — no source code changes required.
7. **Stability:** No unhandled JavaScript exceptions during a standard session (open → query → view results → close) in Chrome and Edge.
8. **Build:** `npm run build` exits 0 with no TypeScript or ESLint errors.

---

## Assumptions and Dependencies

- The CaseController REST API is available and returns a response conforming to the contract in `docs/requirements/api-contract.md`.
- JWT tokens are provided to the developer out-of-band and are valid for at least 1 hour.
- An AI API key (OpenAI or Anthropic) is available and has sufficient quota for MVP usage.
- The host Aeliuscase page does not block requests to the Next.js server origin.
- Case detail URL path is confirmed to be `/dashboard/case-overview/{id}` (see QUESTIONS.md API-11).

---

## Open Questions

See `docs/requirements/QUESTIONS.md` — in particular AI-13 (OpenAI vs Claude provider), AI-14 (AI scope sign-off), and API-11 (case detail URL path).
