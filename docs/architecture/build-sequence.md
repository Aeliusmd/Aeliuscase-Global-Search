# Build Sequence — Aeliuscase Global Search Chatbot Widget

**Version:** 1.1 (Next.js 15)
**Date:** 2026-06-02
**Framework:** Next.js 15 App Router + React 19 + TypeScript + Tailwind CSS v3

Execute top to bottom. Each phase ends with a clear done-signal.

---

## Phase 1 — Project Scaffold (Day 1)

Goal: a running empty app with the full toolchain wired. Zero business logic.

### 1.1 Create Next.js project

```bash
npx create-next-app@latest aeliuscase-global-search \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
cd aeliuscase-global-search
```

The `create-next-app` wizard sets up:
- Next.js 15 + React 19
- TypeScript (strict mode pre-configured)
- Tailwind CSS v3 with PostCSS
- ESLint with Next.js rules
- App Router (`app/` directory)
- `src/` directory for components
- `@/` path alias → `src/`

Verify: `npm run dev` opens `http://localhost:3000` with the default Next.js page.

### 1.2 Install runtime dependencies

```bash
npm install clsx tailwind-merge
```

- `clsx` + `tailwind-merge` — conditional class composition (`cn()` utility)

> Note: Axios is **not needed** — the client-side code uses native `fetch()` to call the local
> Next.js API route. Axios is only needed if you prefer it for the server-side proxy, but
> `app/api/cases/search/route.ts` uses the native `fetch()` API which is available in the
> Next.js runtime.

### 1.3 Create the `cn()` utility

Create `src/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 1.4 Configure `.env` files

Create `.env.local` (gitignored by Next.js automatically):
```
JWT_TOKEN=paste-your-jwt-here
API_BASE_URL=https://uatapi.aeliuscase.com
NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com
```

Create `.env.example` (committed):
```
JWT_TOKEN=eyJhbGci...your_jwt_token_here
API_BASE_URL=https://uatapi.aeliuscase.com
NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com
```

Verify `.env.local` is in `.gitignore` (Next.js adds it automatically).

### 1.5 Scaffold empty source structure

Create the following empty files (no logic yet, just the folders):

```
src/types/case.ts
src/types/chat.ts
src/api/searchCases.ts
src/hooks/useCaseSearch.ts
src/hooks/useChatHistory.ts
src/components/ChatWidget.tsx
src/components/FloatingButton.tsx
src/components/ChatPanel.tsx
src/components/MessageList.tsx
src/components/UserMessage.tsx
src/components/BotMessage.tsx
src/components/CaseResultList.tsx
src/components/CaseCard.tsx
src/components/ChatInput.tsx
app/api/cases/search/route.ts
```

### 1.6 Clean up default Next.js files

- Remove the default content from `app/page.tsx` (replace with `<ChatWidget />`).
- Remove or simplify `app/globals.css` — keep only the Tailwind directives:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  ```

### Phase 1 done-signal

- `npm run dev` — app starts on port 3000, no TypeScript errors
- `npm run lint` — no ESLint errors
- `.env.local` does NOT appear as a tracked file in `git status`

---

## Phase 2 — API Layer: Server-Side Proxy + Client Types (Days 1–2)

Goal: the Next.js API route proxies calls to the real CaseController UAT API with the JWT server-side.
The browser never sees the token.

### 2.1 Define types in `src/types/case.ts`

```typescript
export enum MainSearchType {
  AllCases    = 1,
  OpenCases   = 2,
  ClosedCases = 3,
  SubOutCases = 4,
}

export interface CaseApplicant {
  firstName: string;
  lastName: string;
  fullName: string;
  dob?: string;
  phone?: string;
}

export interface CaseSearchItem {
  id: number;
  caseNumber: string;
  fileNumber: string;
  caseName: string;
  caseTypeId: number;
  caseType: string;
  caseStatusDescription: string;
  caseAttorneyNickName: string;
  caseCoordinatorNickName: string;
  createdDateTime: string;
  caseApplicant: CaseApplicant | null;
  caseEmployee: { company: string } | null;
}

export interface PagedApiResponse<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  hasMorePages: boolean;
  status: number;
  succeeded: boolean;
  message: string | null;
  errors: string | null;
  data: T[];
}

export interface CaseSearchParams {
  searchText: string;
  searchType?: MainSearchType;
  page?: number;
  pageSize?: number;
}
```

### 2.2 Implement `app/api/cases/search/route.ts` (SERVER-SIDE)

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const jwtToken = process.env.JWT_TOKEN;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!jwtToken || !apiBaseUrl) {
    return NextResponse.json(
      { succeeded: false, message: 'Server configuration error: missing API credentials.' },
      { status: 500 }
    );
  }

  const upstream = new URL(`${apiBaseUrl}/api/Case/Search`);
  upstream.searchParams.set('searchText', searchParams.get('searchText') ?? '');
  upstream.searchParams.set('searchType', searchParams.get('searchType') ?? '1');
  upstream.searchParams.set('page',       searchParams.get('page') ?? '1');
  upstream.searchParams.set('pageSize',   searchParams.get('pageSize') ?? '20');

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { succeeded: false, message: 'Failed to reach the CaseController API.' },
      { status: 502 }
    );
  }
}
```

### 2.3 Implement `src/api/searchCases.ts` (CLIENT-SIDE)

```typescript
import type { CaseSearchParams, CaseSearchItem, PagedApiResponse } from '@/types/case';

export class ApiError extends Error {
  constructor(public status: number, public isAuthError: boolean, message?: string) {
    super(message ?? `HTTP ${status}`);
  }
}

export async function searchCases(
  params: CaseSearchParams
): Promise<PagedApiResponse<CaseSearchItem>> {
  const url = new URL('/api/cases/search', window.location.origin);
  url.searchParams.set('searchText', params.searchText);
  url.searchParams.set('searchType', String(params.searchType ?? 1));
  url.searchParams.set('page',       String(params.page ?? 1));
  url.searchParams.set('pageSize',   String(params.pageSize ?? 20));

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new ApiError(response.status, response.status === 401);
  }

  const data: PagedApiResponse<CaseSearchItem> = await response.json();
  if (!data.succeeded) {
    throw new ApiError(response.status, response.status === 401, data.message ?? undefined);
  }

  return data;
}
```

### 2.4 Smoke test the proxy

In Chrome DevTools → Network tab, check that:
- The browser request goes to `http://localhost:3000/api/cases/search?searchText=test`
- **No request to `uatapi.aeliuscase.com` is visible in the browser network tab**
- The response JSON contains `{ succeeded: true, data: [...] }` with real case records

This confirms the JWT is entirely server-side.

### Phase 2 done-signal

- `GET /api/cases/search?searchText=test` returns real data from UAT
- No `Authorization` header visible in the browser's Network tab
- A 401 from CaseController is forwarded as a 401 response to the browser
- No TypeScript errors; no ESLint errors

---

## Phase 3 — Core Components (Days 2–4)

Goal: all UI components render correctly with static/mock data. No real API calls.

### 3.1 Define types in `src/types/chat.ts`

```typescript
import type { CaseSearchItem } from './case';

export type MessageRole = 'user' | 'bot';

export enum MessageType {
  USER      = 'USER',
  BOT_TEXT  = 'BOT_TEXT',
  BOT_CASES = 'BOT_CASES',
  BOT_ERROR = 'BOT_ERROR',
}

interface BaseMessage {
  id: string;
  timestamp: Date;
  type: MessageType;
}

export interface UserMessage extends BaseMessage {
  type: MessageType.USER;
  text: string;
}

export interface BotTextMessage extends BaseMessage {
  type: MessageType.BOT_TEXT;
  text: string;
  variant: 'default' | 'loading';
}

export interface BotErrorMessage extends BaseMessage {
  type: MessageType.BOT_ERROR;
  text: string;
  isAuthError: boolean;
}

export interface BotCasesMessage extends BaseMessage {
  type: MessageType.BOT_CASES;
  cases: CaseSearchItem[];
  totalRecords: number;
  query: string;
}

export type Message = UserMessage | BotTextMessage | BotErrorMessage | BotCasesMessage;
```

### 3.2 FloatingButton

File: `src/components/FloatingButton.tsx`

```typescript
'use client';
```

- Fixed position: `bottom-6 right-6 z-50`
- Circular: `w-14 h-14 rounded-full shadow-lg`
- Background: `bg-blue-600 hover:bg-blue-700`
- Chat bubble SVG when `isOpen=false`; X SVG when `isOpen=true`

### 3.3 ChatInput

```typescript
'use client';
```

- Controlled input with local state
- Enter key → submit; Shift+Enter → newline (do NOT submit)
- `lang="si"` attribute to hint Sinhala keyboard support

### 3.4 UserMessage, BotMessage, CaseCard, CaseResultList, MessageList

Build each as in `component-map.md`. Key points:
- `CaseCard` constructs `caseDetailUrl` as `` `${process.env.NEXT_PUBLIC_APP_BASE_URL}/cases/${caseItem.id}` ``
- `CaseResultList` renders `<CaseCard>` per item in a scrollable `max-h-96 overflow-y-auto` container
- `MessageList` uses `useRef` + `useEffect` to auto-scroll to bottom on new messages

### 3.5 ChatPanel

```typescript
'use client';
```

For Phase 3 only: hard-code `messages={[]}` and a stub `onSubmit`. Real wiring in Phase 4.

### 3.6 ChatWidget

```typescript
'use client';
```

Wire `FloatingButton` and `ChatPanel`. Add `Escape` key listener.

### 3.7 Mount in app/page.tsx

```typescript
// app/page.tsx — Server Component
import ChatWidget from '@/components/ChatWidget';

export default function Home() {
  return (
    <main>
      <ChatWidget />
    </main>
  );
}
```

> `app/page.tsx` is a Server Component (no `'use client'`). It simply renders the ChatWidget
> which is a Client Component. The boundary is clean.

### Phase 3 done-signal

- Floating button appears bottom-right; click opens/closes panel
- Panel shows empty MessageList and functional ChatInput
- Static `CaseCard` renders with hard-coded mock data
- "View" link opens a new tab; tab URL begins with `NEXT_PUBLIC_APP_BASE_URL`
- No TypeScript errors; no ESLint errors

---

## Phase 4 — Search Integration (Days 4–5)

Goal: typing a query calls the API route proxy and renders live results.

### 4.1 Implement useChatHistory

File: `src/hooks/useChatHistory.ts`

```typescript
'use client';
import { useState, useCallback } from 'react';
import type { Message } from '@/types/chat';

export function useChatHistory() {
  const [messages, setMessages] = useState<Message[]>([]);

  const append = useCallback((message: Message) =>
    setMessages(prev => [...prev, message]), []);

  const replace = useCallback((id: string, message: Message) =>
    setMessages(prev => prev.map(m => m.id === id ? message : m)), []);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, append, replace, clear };
}
```

### 4.2 Implement useCaseSearch

File: `src/hooks/useCaseSearch.ts`

```typescript
'use client';
import { useState, useCallback } from 'react';
import { searchCases, ApiError } from '@/api/searchCases';
import type { CaseSearchItem } from '@/types/case';
import { MainSearchType } from '@/types/case';

export function useCaseSearch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; isAuthError: boolean } | null>(null);

  const search = useCallback(async (query: string): Promise<{
    cases: CaseSearchItem[];
    totalRecords: number;
  }> => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchCases({
        searchText: query,
        searchType: MainSearchType.AllCases,
        page: 1,
        pageSize: 20,
      });
      return { cases: result.data ?? [], totalRecords: result.totalRecords };
    } catch (err) {
      const isAuthError = err instanceof ApiError && err.isAuthError;
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError({ message, isAuthError });
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, search };
}
```

### 4.3 Wire ChatPanel

Replace the Phase 3 stubs with real hook calls and the full message dispatch logic from `component-map.md`.

### 4.4 Error message constants

Create `src/lib/errorMessages.ts`:
```typescript
export const ERR_JWT_EXPIRED =
  'Your session token has expired. Ask a developer to update JWT_TOKEN in .env.local and restart the dev server.';
export const ERR_NETWORK =
  'Could not reach the server. Check your network connection and try again.';
export const ERR_API =
  'Something went wrong. Please try again.';
export const ERR_NO_RESULTS = (query: string) =>
  `No cases found for "${query}". Try a different name, case number, or keyword.`;
```

### 4.5 Manual test checklist

| Scenario | How to trigger | Expected result |
|---|---|---|
| Happy path | Valid JWT; query "John" | CaseResultList with real cards |
| Empty results | Unlikely query string | Empty-state BotMessage |
| JWT expired | Set expired token in .env.local, restart | JWT-expiry BotErrorMessage |
| Network error | Block request in DevTools | Network error BotErrorMessage |
| Loading state | Throttle to "Slow 3G" in DevTools | Loading BotMessage during fetch |
| Token hidden | Check Network tab | No request to uatapi.aeliuscase.com |

### Phase 4 done-signal

- Full round-trip: type → submit → loading → real case cards
- "View" link opens correct case URL in new tab
- All 5 scenarios produce correct UI state
- CaseController URL is NOT visible in browser Network tab (proxy confirmed working)

---

## Phase 5 — Polish and Production Build (Days 5–6)

### 5.1 Tailwind styling pass

Status badge colours (case-insensitive match on `caseStatusDescription`):

| Value | Badge style |
|---|---|
| contains "open" | `bg-green-100 text-green-800` |
| contains "closed" | `bg-gray-100 text-gray-600` |
| other | `bg-amber-100 text-amber-800` |

### 5.2 Accessibility

- `aria-label` on FloatingButton, ChatInput
- `role="log"` + `aria-live="polite"` on MessageList
- `aria-label="View case {caseNumber}"` on CaseCard View link
- Visible focus rings on all interactive elements (`focus-visible:ring-2`)

### 5.3 Production build

```bash
npm run build
npm run start   # verify production build works
```

Check:
- Zero TypeScript errors
- Zero ESLint errors
- `.next/` output folder generated

### 5.4 Final go/no-go checklist

| Check | Pass criteria |
|---|---|
| `npm run build` | Exit 0; no TS/lint errors |
| Widget opens | FloatingButton visible; click opens ChatPanel |
| Search | Real case cards returned from UAT API |
| View link | Opens new tab with correct URL |
| JWT expiry | Error message shown; no unhandled exception |
| Network off | Network error message shown |
| Escape key | Panel closes |
| Token hidden | No `uatapi.aeliuscase.com` request in browser Network tab |
| `.env.local` not in git | `git status` confirms it is ignored |

---

## API endpoints used by the widget

| Phase | Caller | Method | Path | Purpose |
|---|---|---|---|---|
| 2, 4 | Browser | GET | `/api/cases/search` | Local Next.js proxy route |
| 2, 4 | Next.js server | GET | `/api/Case/Search` | CaseController UAT API |

Base URL (server-to-server): `https://uatapi.aeliuscase.com` (from `process.env.API_BASE_URL`).
The browser never directly calls the CaseController URL.
