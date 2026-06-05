# Implementation Checklist — Aeliuscase Global Search Chatbot Widget
**Version:** 1.2 (Next.js 15 + AI SDK 6.x)
**Date:** 2026-06-05
**Status:** Implementation in progress — AI chat layer added beyond original MVP spec

This checklist is the developer's authoritative task list. Items marked [x] are verified complete by code review (2026-06-05). Items marked [ ] are outstanding.

> **Architecture note (v1.2):** The implementation has diverged from MVP-scope v1.0. The chat layer now routes through an LLM (currently OpenAI GPT-4o-mini via `app/api/chat/route.ts`) before calling the CaseController API as a tool call. This is a significant scope expansion. See QUESTIONS.md AI-13 for the open decision on AI provider (OpenAI vs Claude). See MVP-scope.md v2.0 for the revised scope boundary.

---

## Project Setup

- [x] Scaffold Next.js 15 project (TypeScript, Tailwind, ESLint, App Router, src/ dir, `@/*` alias)
- [x] Install utility dependencies: `clsx`, `tailwind-merge`
- [x] Create `src/lib/utils.ts` with `cn()` helper
- [ ] Create `.env.local` (gitignored) with required variables — **developer action required**:
  ```
  JWT_TOKEN=<your_jwt_token>
  API_BASE_URL=https://uatapi.aeliuscase.com
  NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com
  OPENAI_API_KEY=<your_openai_key>
  ```
- [x] Create `.env.example` (committed) — contains `JWT_TOKEN`, `API_BASE_URL`, `OPENAI_API_KEY`, `NEXT_PUBLIC_APP_BASE_URL` with placeholder values
- [x] Confirm `.env.local` is in `.gitignore` (Next.js adds this automatically)
- [x] TypeScript strict mode enabled in `tsconfig.json`
- [x] `app/page.tsx` — minimal server component rendering `<ChatWidget />`
- [x] `app/globals.css` — Tailwind directives only
- [x] `app/layout.tsx` — server component, imports `globals.css`

---

## API Layer

### Server-Side Proxy (Next.js API Route — Direct Search)

- [x] `app/api/cases/search/route.ts` — GET handler
- [x] Reads `JWT_TOKEN` and `API_BASE_URL` from `process.env` (no `NEXT_PUBLIC_` prefix)
- [x] Returns 500 with clear message if either env var is missing
- [x] Builds upstream URL: `${API_BASE_URL}/api/Case/Search` with query params forwarded
- [x] Adds `Authorization: Bearer ${JWT_TOKEN}` and `Accept: application/json` headers
- [x] Uses `cache: 'no-store'` on the fetch call
- [x] Forwards the upstream HTTP status code to the browser response
- [x] Handles fetch errors (upstream unreachable) with a 502 response

### AI Chat Endpoint (NEW — beyond original MVP spec)

- [x] `app/api/chat/route.ts` — POST handler using AI SDK 6.x
- [x] Reads `JWT_TOKEN`, `API_BASE_URL`, and `OPENAI_API_KEY` from `process.env`
- [x] Returns 500 if any required env var is missing
- [x] Uses `streamText` from Vercel AI SDK with `openai('gpt-4o-mini')` model
- [x] Defines `searchCases` tool (Zod schema: `searchText`, `searchType`, `page`)
- [x] Tool execute function calls CaseController API directly (server-to-server, JWT secured)
- [x] Returns streaming UI message response via `result.toUIMessageStreamResponse()`
- [x] `searchTypeHint` forwarded from frontend to system prompt as active filter context
- [ ] **Open decision:** Switch AI provider from OpenAI to Claude (see QUESTIONS.md AI-13)

### Client-Side Types

- [x] `src/types/case.ts`:
  - [x] `MainSearchType` enum (1=AllCases, 2=OpenCases, 3=ClosedCases, 4=SubOutCases)
  - [x] `CaseApplicant` interface (firstName, lastName, fullName, dob?, phone?)
  - [x] `CaseSearchItem` interface — camelCase fields matching real API response (includes `fileNumber`, `caseTypeId`, `caseEmployee`)
  - [x] `PagedApiResponse<T>` interface
  - [x] `CaseSearchParams` interface
  - [x] `SearchToolOutput` interface — added for AI SDK tool return type

- [x] `src/types/chat.ts` — complete with `MessageType`, `UserMessage`, `BotTextMessage`, `BotErrorMessage`, `BotCasesMessage`, `Message`
  - ⚠️ **Currently unused** — the AI SDK implementation uses `UIMessage` from the `ai` package. This file was built per original spec but the architecture shifted to AI SDK. Candidates for removal or repurposing; see QUESTIONS.md DEV-1.

### Client-Side API Helper

- [x] `src/api/searchCases.ts`
- [x] `ApiError` class with `status: number` and `isAuthError: boolean`
- [x] `searchCases()` calls `/api/cases/search` (local Next.js route)
- [x] Throws `ApiError` on non-OK or `succeeded: false` response
- [x] Returns typed `PagedApiResponse<CaseSearchItem>`
- ⚠️ **Currently unused in main chat flow** — `ChatPanel` routes through `/api/chat` (AI layer). `searchCases` is only called by the Load More button in `CaseResultList` for pagination. See QUESTIONS.md DEV-1.

---

## Hooks

- [x] `src/hooks/useChatHistory.ts`
  - [x] `messages: Message[]` state with localStorage persistence (up to 100 messages)
  - [x] `append(message)`, `replace(id, message)`, `clear()` functions
  - ⚠️ **Currently unused** — `ChatPanel` uses `useChat` from `@ai-sdk/react` instead. Candidate for removal; see QUESTIONS.md DEV-1.

- [x] `src/hooks/useCaseSearch.ts`
  - [x] `loading`, `error` state with `isAuthError`, `isNetworkError`, `isConfigError`
  - [x] `search(query, searchType, page)` function using `searchCases`
  - ⚠️ **Currently unused** — superseded by AI SDK chat flow. Candidate for removal; see QUESTIONS.md DEV-1.

---

## Components

All interactive components have `'use client'` at the top.

- [x] `src/components/ChatWidget.tsx` — `'use client'`
  - [x] `isOpen` boolean state
  - [x] `useEffect` Escape key listener → `setIsOpen(false)`
  - [x] Renders `<FloatingButton>` always + `<ChatPanel>` when `isOpen`

- [x] `src/components/FloatingButton.tsx` — `'use client'`
  - [x] `position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 50`
  - [x] Chat bubble SVG icon when `isOpen=false`; X icon when `isOpen=true`
  - [x] `aria-label` changes: "Open case search" / "Close case search"

- [x] `src/components/ChatPanel.tsx` — `'use client'`
  - [x] Uses `useChat` from `@ai-sdk/react` (AI SDK 6.x) — **not** `useChatHistory` + `useCaseSearch`
  - [x] `DefaultChatTransport` to `/api/chat` with `searchTypeHint` body
  - [x] localStorage persistence for chat history (key: `aelius_chat_v2`)
  - [x] Clear history button in header
  - [x] Passes `messages`, `isLoading`, `onLoadMore` to `<MessageList>`, `onSubmit`+`disabled` to `<ChatInput>`
  - [x] `handleLoadMore` fetches next page directly from `/api/cases/search` and patches message state

- [x] `src/components/ChatInput.tsx` — `'use client'`
  - [x] Controlled input with local `value` state
  - [x] Send button disabled when `disabled=true` or `value.trim() === ''`
  - [x] Enter submits; Shift+Enter does not
  - [x] Clears input after submit
  - [x] `lang="si"` attribute on input

- [x] `src/components/MessageList.tsx` — `'use client'`
  - [x] `useRef` + `useEffect` auto-scroll to bottom
  - [x] Uses AI SDK `UIMessage` type (not `Message` from `src/types/chat.ts`)
  - [x] Renders: user messages via `<UserMessage>`, text parts via `<BotMessage>`, `tool-searchCases` parts via `<CaseResultList>`
  - [x] `role="log"` + `aria-live="polite"`
  - [x] Typing indicator while waiting for first response

- [x] `src/components/UserMessage.tsx` — right-aligned bubble, `bg-blue-600 text-white rounded-2xl rounded-tr-sm`

- [x] `src/components/BotMessage.tsx`
  - [x] `variant='default'` — gray background with react-markdown rendering (GFM support)
  - [x] `variant='loading'` — animated three-dot indicator
  - [x] `variant='error'` — red border and text

- [x] `src/components/CaseResultList.tsx`
  - [x] Count header: "Showing N of M results" / "Found N cases"
  - [x] Scrollable container: `max-h-80 overflow-y-auto`
  - [x] Maps `cases` → `<CaseCard key={item.id} caseItem={item} />`
  - [x] Empty state: "No cases found for '{query}'" message
  - [x] Load More button when `hasMorePages` is true

- [x] `src/components/CaseCard.tsx`
  - [x] Constructs URL: `` `${NEXT_PUBLIC_APP_BASE_URL}/dashboard/case-overview/${caseItem.id}` ``
  - ⚠️ **URL path unconfirmed** — currently `/dashboard/case-overview/{id}`; spec assumed `/cases/{id}`. See QUESTIONS.md API-11.
  - [x] Displays: `caseNumber` (bold mono), `caseName`, applicant name (constructed from firstName+lastName or capitalized fullName), `caseType`
  - [x] `caseStatusDescription` badge — Open=green, Close*=gray, other=amber (case-insensitive)
  - [x] `createdDateTime` formatted as `DD MMM YYYY`
  - [x] "View Case" as `<a>` with `target="_blank" rel="noopener noreferrer"`
  - [x] `aria-label="View case {caseNumber}"`

- [x] `src/components/SearchTypeFilter.tsx` — **NEW (beyond original MVP spec)**
  - [x] Pill button group: All Cases | Open | Closed | Sub-Out
  - [x] Disabled during AI response streaming
  - [x] Filter value passed to AI chat route as `searchTypeHint`

---

## App Entry

- [x] `app/layout.tsx` — Server Component; imports `globals.css`; sets `<html lang="en">`
- [x] `app/page.tsx` — Server Component; imports and renders `<ChatWidget />`

---

## Configuration Files

- [x] `.env.example` — committed; four variables with placeholder values (JWT_TOKEN, API_BASE_URL, OPENAI_API_KEY, NEXT_PUBLIC_APP_BASE_URL)
- [x] `next.config.ts` — minimal
- [x] `tailwind.config.ts` — content paths cover `app/**` and `src/**`
- [x] `tsconfig.json` — `strict: true`, `@/*` alias to `./src/*`
- [x] `.gitignore` — includes `.env.local`, `.next/`, `node_modules/`

---

## Dependencies (actual vs original spec)

| Package | Origin | Purpose |
|---|---|---|
| `next` ^15 | Spec | Framework |
| `react` / `react-dom` ^19 | Spec | UI |
| `typescript` | Spec | Type safety |
| `tailwindcss` | Spec | Styling |
| `clsx` / `tailwind-merge` | Spec | Class merging |
| `zod` ^4 | **Added** | AI tool input schema validation |
| `ai` ^6 | **Added** | Vercel AI SDK — streaming, UIMessage, DefaultChatTransport |
| `@ai-sdk/react` ^3 | **Added** | `useChat` hook |
| `@ai-sdk/openai` ^3 | **Added** | OpenAI provider for AI SDK |
| `openai` ^6 | **Added** | OpenAI client (transitive) |
| `react-markdown` ^10 | **Added** | Markdown rendering in bot messages |
| `remark-gfm` ^4 | **Added** | GFM tables/strikethrough in markdown |

---

## Quality

- [ ] Smoke test — browser Network tab shows `/api/chat` POST only (NOT direct `uatapi.aeliuscase.com`)
- [ ] Smoke test — response streams real case records
- [ ] Smoke test — no `Authorization` header visible in browser Network tab
- [ ] Manual test — "View Case" opens new tab at `NEXT_PUBLIC_APP_BASE_URL/dashboard/case-overview/{id}`
- [ ] Manual test — set `JWT_TOKEN` to expired value → 401 → widget shows expiry message
- [ ] Manual test — DevTools → Network → Offline → submit query → error message shown
- [ ] Manual test — query with no results → empty state message includes original query text
- [ ] Manual test — Escape key closes chat panel
- [ ] Manual test — SearchTypeFilter correctly scopes results (test Open vs All)
- [ ] `npm run build` — exits 0 with no TypeScript or ESLint errors
- [ ] `npm run start` — production server starts and widget functions correctly

---

## Developer Notes

1. **JWT is server-side only.** `JWT_TOKEN` (no `NEXT_PUBLIC_` prefix) never reaches the browser. Both `app/api/cases/search/route.ts` and `app/api/chat/route.ts` read it. This is the primary security benefit of Next.js over the original Vite design.

2. **AI provider is currently OpenAI.** The `/api/chat/route.ts` uses `openai('gpt-4o-mini')`. The project standard (per CLAUDE.md) is Claude. This should be switched — see QUESTIONS.md AI-13 and the `/claude-api` skill for migration guidance.

3. **Dead code.** `src/types/chat.ts`, `src/hooks/useChatHistory.ts`, and `src/hooks/useCaseSearch.ts` were built to the original spec but are now unused. They should be removed unless the team decides to keep them as a fallback path.

4. **Case URL path.** `CaseCard` currently links to `/dashboard/case-overview/{id}`. This is an assumption — API-11 in QUESTIONS.md is still open.

5. **`caseApplicant.fullName` is lowercase.** CaseCard constructs the display name from `firstName + ' ' + lastName` when available, falling back to capitalizing `fullName`.

6. **`createdDateTime` is ISO 8601.** Formatted using `toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })`.

7. **CORS is solved by the proxy.** The browser never calls `uatapi.aeliuscase.com` directly.

8. **Load More pagination.** The `CaseResultList` component has a "Load More" button that fetches the next page directly from `/api/cases/search` and appends to the AI SDK message state. This is outside the AI layer and calls the proxy directly.
