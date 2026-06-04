# Implementation Checklist — Aeliuscase Global Search Chatbot Widget
**Version:** 1.1 (Next.js 15)
**Date:** 2026-06-02
**Status:** Ready for development

This checklist is the developer's authoritative task list. Check items off as they are completed.

---

## Project Setup

- [ ] Scaffold Next.js 15 project:
  ```bash
  npx create-next-app@latest aeliuscase-global-search \
    --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
  ```
- [ ] Install utility dependencies:
  ```bash
  npm install clsx tailwind-merge
  ```
- [ ] Create `src/lib/utils.ts` with `cn()` helper (clsx + tailwind-merge)
- [ ] Create `.env.local` (gitignored) with the three required variables:
  ```
  JWT_TOKEN=your_jwt_token_here
  API_BASE_URL=https://uatapi.aeliuscase.com
  NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com
  ```
- [ ] Create `.env.example` (committed to repo) with the same variable names and placeholder values
- [ ] Confirm `.env.local` is in `.gitignore` (Next.js adds this automatically)
- [ ] Verify TypeScript strict mode is enabled in `tsconfig.json` (`"strict": true`)
- [ ] Clean `app/page.tsx` to a minimal server component that renders `<ChatWidget />`
- [ ] Clean `app/globals.css` to Tailwind directives only (`@tailwind base/components/utilities`)

---

## API Layer

### Server-Side Proxy (Next.js API Route)

- [ ] Create `app/api/cases/search/route.ts`
- [ ] Read `JWT_TOKEN` and `API_BASE_URL` from `process.env` (no `NEXT_PUBLIC_` prefix — server-side only)
- [ ] Return 500 with clear error message if either env var is missing
- [ ] Build upstream URL: `${API_BASE_URL}/api/Case/Search` with query params forwarded from the request
- [ ] Add `Authorization: Bearer ${JWT_TOKEN}` and `Accept: application/json` headers
- [ ] Use `cache: 'no-store'` on the fetch call (case data must always be fresh)
- [ ] Forward the upstream HTTP status code to the browser response
- [ ] Handle fetch errors (upstream unreachable) with a 502 response

### Client-Side Types

- [ ] Create `src/types/case.ts` with:
  - [ ] `MainSearchType` enum (1=AllCases, 2=OpenCases, 3=ClosedCases, 4=SubOutCases)
  - [ ] `CaseApplicant` interface
  - [ ] `CaseSearchItem` interface (all camelCase field names from docx)
  - [ ] `PagedApiResponse<T>` interface (PagedResponse wrapper)
  - [ ] `CaseSearchParams` interface
- [ ] Create `src/types/chat.ts` with:
  - [ ] `MessageType` enum
  - [ ] `UserMessage`, `BotTextMessage`, `BotErrorMessage`, `BotCasesMessage` interfaces
  - [ ] `Message` discriminated union type

### Client-Side API Helper

- [ ] Create `src/api/searchCases.ts`
- [ ] Export `ApiError` class with `status: number` and `isAuthError: boolean` properties
- [ ] `searchCases()` function calls `/api/cases/search` (local Next.js route — NOT `uatapi.aeliuscase.com`)
- [ ] Throw `ApiError` when response is not OK
- [ ] Return typed `PagedApiResponse<CaseSearchItem>`

---

## Hooks

- [ ] `src/hooks/useChatHistory.ts`
  - [ ] `messages: Message[]` state
  - [ ] `append(message: Message): void`
  - [ ] `replace(id: string, message: Message): void` — used to swap loading placeholder with result
  - [ ] `clear(): void`
  - [ ] File must NOT have `'use client'` (it's imported by a client component that already has it) — OR add it; both are valid

- [ ] `src/hooks/useCaseSearch.ts`
  - [ ] `loading: boolean` state
  - [ ] `error: { message: string; isAuthError: boolean } | null` state
  - [ ] `search(query: string): Promise<{ cases: CaseSearchItem[]; totalRecords: number }>`
  - [ ] Uses `searchCases()` from `src/api/searchCases.ts`
  - [ ] Detects auth error via `err instanceof ApiError && err.isAuthError`

---

## Components

All interactive components need `'use client'` at the top.

- [ ] `src/components/ChatWidget.tsx` — `'use client'`
  - [ ] `isOpen` boolean state (default `false`)
  - [ ] `useEffect` Escape key listener → `setIsOpen(false)`
  - [ ] Renders `<FloatingButton>` always + `<ChatPanel>` when `isOpen`

- [ ] `src/components/FloatingButton.tsx` — `'use client'`
  - [ ] `position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 50`
  - [ ] Chat bubble SVG icon when `isOpen=false`; X icon when `isOpen=true`
  - [ ] `aria-label` changes between "Open case search" / "Close case search"

- [ ] `src/components/ChatPanel.tsx` — `'use client'`
  - [ ] Calls `useChatHistory` and `useCaseSearch`
  - [ ] `handleSubmit(query)`: append UserMessage → append loading BotMessage → call search → replace loading with result (cases / empty-state / error)
  - [ ] Passes `messages` to `<MessageList>` and `onSubmit + disabled` to `<ChatInput>`

- [ ] `src/components/ChatInput.tsx` — `'use client'`
  - [ ] Controlled input with local `value` state
  - [ ] Send button disabled when `disabled=true` or `value.trim() === ''`
  - [ ] Enter submits; Shift+Enter does not
  - [ ] Clears input after submit
  - [ ] `lang="si"` attribute on input

- [ ] `src/components/MessageList.tsx` — `'use client'`
  - [ ] `useRef` + `useEffect` auto-scroll to bottom on `messages` change
  - [ ] Renders correct component per `MessageType`
  - [ ] `role="log"` + `aria-live="polite"` for accessibility

- [ ] `src/components/UserMessage.tsx`
  - [ ] Right-aligned bubble (`flex justify-end`)
  - [ ] `bg-blue-600 text-white rounded-2xl rounded-tr-sm`

- [ ] `src/components/BotMessage.tsx`
  - [ ] Left-aligned bubble
  - [ ] `variant='default'` — gray background
  - [ ] `variant='loading'` — animated dots
  - [ ] `variant='error'` — red border and text

- [ ] `src/components/CaseResultList.tsx`
  - [ ] Count header: "Showing N results" / "Showing N of M results"
  - [ ] Scrollable container: `max-h-96 overflow-y-auto`
  - [ ] Maps `cases` → `<CaseCard key={item.id} caseItem={item} />`
  - [ ] Empty state: friendly message with original query text

- [ ] `src/components/CaseCard.tsx`
  - [ ] Constructs URL: `` `${process.env.NEXT_PUBLIC_APP_BASE_URL}/cases/${caseItem.id}` ``
  - [ ] Displays: `caseNumber` (bold), `caseName`, `caseApplicant?.fullName` (capitalize), `caseType`, `caseStatusDescription` (badge), `createdDateTime` (formatted)
  - [ ] Status badge colours: Open=green, Closed=gray, other=amber (case-insensitive)
  - [ ] "View Case" as `<a href={url} target="_blank" rel="noopener noreferrer">`
  - [ ] `aria-label="View case {caseNumber}"`

---

## App Entry

- [ ] `app/layout.tsx` — Server Component; imports `globals.css`; sets `<html lang="en">`
- [ ] `app/page.tsx` — Server Component; imports and renders `<ChatWidget />`; no `'use client'`

---

## Configuration Files

- [ ] `.env.example` — committed; three variables with placeholder values (see above)
- [ ] `next.config.ts` — minimal; no extra config needed for MVP
- [ ] `tailwind.config.ts` — content paths: `['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}']`
- [ ] `tsconfig.json` — `strict: true`, `paths: { "@/*": ["./src/*"] }` (set up by `create-next-app`)
- [ ] `.gitignore` — must include `.env.local`, `.next/`, `node_modules/`

---

## Quality

- [ ] Smoke test — Browser Network tab shows request to `/api/cases/search` only (NOT to `uatapi.aeliuscase.com`)
- [ ] Smoke test — Response contains real case records from UAT API
- [ ] Smoke test — No `Authorization` header visible in browser Network tab
- [ ] Manual test — "View Case" opens new tab with `NEXT_PUBLIC_APP_BASE_URL/cases/{id}`
- [ ] Manual test — Set `JWT_TOKEN` to an expired value in `.env.local`, restart → 401 → JWT-expiry message shown
- [ ] Manual test — DevTools → Network → Offline → submit query → network error message shown
- [ ] Manual test — Query with no results → empty state message includes original query text
- [ ] Manual test — Escape key closes the chat panel
- [ ] `npm run build` — exits 0 with no TypeScript or ESLint errors
- [ ] `npm run start` — production server starts and widget functions correctly

---

## Developer Notes

1. **JWT is server-side only.** `JWT_TOKEN` (no `NEXT_PUBLIC_` prefix) never reaches the browser. Only `app/api/cases/search/route.ts` reads it. This is the primary security benefit of Next.js over Vite.

2. **`NEXT_PUBLIC_` prefix required for client-side env vars.** Only `NEXT_PUBLIC_APP_BASE_URL` needs the prefix because it is used in a client component (`CaseCard.tsx`). The other two variables must NOT have the prefix.

3. **`caseApplicant.fullName` is lowercase.** The API returns e.g. `"johndoe"`. Display with CSS `capitalize` class or construct from `firstName + ' ' + lastName`.

4. **`createdDateTime` is a full ISO 8601 datetime.** Format for display using:
   ```typescript
   new Date(item.createdDateTime).toLocaleDateString('en-GB', {
     day: '2-digit', month: 'short', year: 'numeric'
   })
   ```

5. **CORS is solved by the proxy.** The browser never calls `uatapi.aeliuscase.com` directly. If CORS errors appear, the request is going to the wrong URL — check that `searchCases.ts` calls `/api/cases/search` (no hostname), not the full CaseController URL.

6. **JWT token rotation workflow:**
   - Developer receives a new JWT from the Aeliuscase team
   - Updates `JWT_TOKEN` in `.env.local`
   - Runs `npm run dev` (or `npm run build && npm run start` for production)
   - Widget immediately uses the new token — no browser action needed
