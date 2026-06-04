# Component Map — Aeliuscase Global Search Chatbot Widget

**Framework: Next.js 15 (App Router)**
This document is the definitive handoff reference for the development team. Field names are confirmed against `CaseController API.docx`.

---

## Component tree

```
app/page.tsx                            (Server Component — root page, mounts ChatWidget)
└── ChatWidget            'use client'  src/components/ChatWidget.tsx
    ├── FloatingButton    'use client'  src/components/FloatingButton.tsx
    └── ChatPanel         'use client'  src/components/ChatPanel.tsx  [when isOpen=true]
        ├── MessageList   'use client'  src/components/MessageList.tsx
        │   ├── UserMessage              src/components/UserMessage.tsx
        │   ├── BotMessage               src/components/BotMessage.tsx
        │   └── CaseResultList           src/components/CaseResultList.tsx
        │       └── CaseCard             src/components/CaseCard.tsx
        └── ChatInput     'use client'  src/components/ChatInput.tsx
```

Custom hooks (client-side, consumed by ChatPanel):
```
useCaseSearch                           src/hooks/useCaseSearch.ts
useChatHistory                          src/hooks/useChatHistory.ts
```

API layer:
```
Next.js API Route (server-side proxy)   app/api/cases/search/route.ts
Client fetch helper                     src/api/searchCases.ts
```

Types (consumed by all layers):
```
types/case.ts                           src/types/case.ts
types/chat.ts                           src/types/chat.ts
```

---

## Full project file tree

```
aeliuscase-global-search/
├── .env                                # (gitignored) JWT_TOKEN, API_BASE_URL, NEXT_PUBLIC_APP_BASE_URL
├── .env.example                        # Committed template — variable names with placeholder values
├── .gitignore                          # Excludes .env, .next/, node_modules/
├── next.config.ts                      # Next.js config; minimal for MVP
├── tailwind.config.ts                  # Tailwind JIT; content paths
├── postcss.config.js                   # Tailwind + Autoprefixer
├── tsconfig.json                       # TypeScript strict mode; paths aliases
├── package.json                        # Next.js 15, React 19, Tailwind 3, TypeScript 5, clsx
│
├── app/
│   ├── layout.tsx                      # Root layout (Server Component); imports globals.css; sets <html lang="en">
│   ├── page.tsx                        # Home page (Server Component); renders <ChatWidget />
│   ├── globals.css                     # @tailwind base/components/utilities
│   └── api/
│       └── cases/
│           └── search/
│               └── route.ts           # SERVER-SIDE proxy to CaseController API; reads JWT_TOKEN + API_BASE_URL
│
└── src/
    ├── components/
    │   ├── ChatWidget.tsx              # 'use client' — root mount; owns isOpen state
    │   ├── FloatingButton.tsx          # 'use client' — fixed FAB, bottom-right; swaps icon open/closed
    │   ├── ChatPanel.tsx               # 'use client' — panel shell; calls both hooks
    │   ├── MessageList.tsx             # 'use client' — scrollable history; auto-scroll on new messages
    │   ├── UserMessage.tsx             # right-aligned bubble; props: { text: string }
    │   ├── BotMessage.tsx              # left-aligned bubble; props: { text, variant }
    │   ├── CaseResultList.tsx          # list of CaseCard; props: { cases, totalRecords }
    │   ├── CaseCard.tsx                # single case result + View link
    │   └── ChatInput.tsx               # 'use client' — controlled input + Send button
    │
    ├── hooks/
    │   ├── useCaseSearch.ts            # client hook; calls /api/cases/search (Next.js route)
    │   └── useChatHistory.ts           # client hook; manages message array state
    │
    ├── api/
    │   └── searchCases.ts              # typed fetch() wrapper calling /api/cases/search
    │
    └── types/
        ├── case.ts                     # CaseSearchItem, PagedApiResponse<T>, CaseSearchParams, MainSearchType
        └── chat.ts                     # Message discriminated union, MessageType
```

---

## Next.js API Route — `app/api/cases/search/route.ts`

**This is the key security component.** It runs server-side only and proxies the browser request to the CaseController API with the JWT injected from server-side environment variables.

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const apiUrl = new URL(`${process.env.API_BASE_URL}/api/Case/Search`);
  apiUrl.searchParams.set('searchText', searchParams.get('searchText') ?? '');
  apiUrl.searchParams.set('searchType', searchParams.get('searchType') ?? '1');
  apiUrl.searchParams.set('page',       searchParams.get('page') ?? '1');
  apiUrl.searchParams.set('pageSize',   searchParams.get('pageSize') ?? '20');

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.JWT_TOKEN}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

**What this achieves:**
- `JWT_TOKEN` is read from `process.env` — it exists only on the server, never in the browser
- The browser calls `/api/cases/search?searchText=John` (local Next.js URL)
- Next.js server calls `https://uatapi.aeliuscase.com/api/Case/Search` with the JWT header
- CORS is not needed on the CaseController API
- 401 responses are forwarded to the client as-is so the widget can show the JWT-expiry message

---

## Component specifications

### ChatWidget — `src/components/ChatWidget.tsx`

```typescript
'use client';
```

**Responsibility:** Root mount point. Owns the single boolean that controls panel visibility.

**State:** `isOpen: boolean` — initialized to `false`

**Props:** None (mounted in `app/page.tsx`)

**Renders:**
- `<FloatingButton isOpen={isOpen} onClick={() => setIsOpen(o => !o)} />` — always
- `<ChatPanel onClose={() => setIsOpen(false)} />` — conditionally when `isOpen === true`

**Keyboard:** `Escape` key closes the panel via `useEffect` event listener on `document`.

---

### FloatingButton — `src/components/FloatingButton.tsx`

```typescript
'use client';
```

**Props:**
```typescript
interface FloatingButtonProps {
  isOpen: boolean;
  onClick: () => void;
}
```

**Layout:** `position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 50`
**Icon:** Chat bubble SVG when closed; X SVG when open.
**Accessibility:** `aria-label="Open case search"` / `"Close case search"`

---

### ChatPanel — `src/components/ChatPanel.tsx`

```typescript
'use client';
```

**Hooks used:** `useCaseSearch`, `useChatHistory`

**Submit flow:**
1. `ChatInput` fires `onSubmit(queryString)`
2. Append `UserMessage` to history
3. Append loading `BotMessage` to history
4. Call `useCaseSearch.search(queryString)` — hits `/api/cases/search`
5. Replace loading message with result:
   - Success + cases → `BotCasesMessage`
   - Success + 0 results → `BotTextMessage` (empty state)
   - 401 error → `BotErrorMessage` (JWT-expiry text)
   - Other error → `BotErrorMessage` (generic text)

---

### CaseCard — `src/components/CaseCard.tsx`

**Fields displayed** (confirmed from `CaseController API.docx`):

| Display label | Source field | Notes |
|---|---|---|
| Case No. | `caseNumber` | e.g. "RP003782" |
| Case Name | `caseName` | e.g. "John Doe vs ABC Company" |
| Type | `caseType` | "WCAB" or "Personal Injury" |
| Status | `caseStatusDescription` | Badge: Open=green, Closed=grey, other=amber |
| Applicant | `caseApplicant?.fullName` | WCAB only; omit if null |
| Opened | `createdDateTime` | Format as "26 Mar 2026" |

**View link:**
```typescript
const caseDetailUrl = `${process.env.NEXT_PUBLIC_APP_BASE_URL}/cases/${caseItem.id}`;
// <a href={caseDetailUrl} target="_blank" rel="noopener noreferrer">View</a>
```

---

### ChatInput — `src/components/ChatInput.tsx`

```typescript
'use client';
```

**Props:**
```typescript
interface ChatInputProps {
  onSubmit: (query: string) => void;
  disabled: boolean;
}
```

Enter key fires `onSubmit`. Clears input after submit. Accepts Sinhala Unicode.

---

## API client — `src/api/searchCases.ts`

Client-side `fetch()` wrapper that calls the **local Next.js API route** (not the CaseController URL directly):

```typescript
import type { CaseSearchParams, CaseSearchItem, PagedApiResponse } from '../types/case';

export async function searchCases(params: CaseSearchParams): Promise<PagedApiResponse<CaseSearchItem>> {
  const url = new URL('/api/cases/search', window.location.origin);
  url.searchParams.set('searchText', params.searchText);
  url.searchParams.set('searchType', String(params.searchType ?? 1));
  url.searchParams.set('page',       String(params.page ?? 1));
  url.searchParams.set('pageSize',   String(params.pageSize ?? 20));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw { status: response.status, isAuthError: response.status === 401 };
  }
  return response.json();
}
```

---

## Environment variables — complete set

| Variable | `NEXT_PUBLIC_`? | Exposed to browser | Description |
|---|---|---|---|
| `JWT_TOKEN` | No | **Never** | Bearer token for CaseController API. Server-side only. Rotated every ~1 hour. |
| `API_BASE_URL` | No | **Never** | CaseController API base URL. Used only in `app/api/cases/search/route.ts`. |
| `NEXT_PUBLIC_APP_BASE_URL` | Yes | Yes | Aeliuscase host app URL for constructing case deep-link URLs. |

**.env.example** (committed to repo):
```
JWT_TOKEN=eyJhbGci...
API_BASE_URL=https://uatapi.aeliuscase.com
NEXT_PUBLIC_APP_BASE_URL=https://uat.aeliuscase.com
```

---

## Dependency flow

```
app/page.tsx  (Server Component)
  └── ChatWidget.tsx          'use client' — isOpen state
        ├── FloatingButton    'use client' — props: isOpen, onClick
        └── ChatPanel         'use client' — state via hooks
              ├── useChatHistory            state: messages[]
              ├── useCaseSearch             state: loading, error
              │     └── searchCases.ts      fetch /api/cases/search
              │           └── route.ts      SERVER: reads JWT_TOKEN, calls CaseController
              ├── MessageList  'use client'  props: messages[]
              │     ├── UserMessage
              │     ├── BotMessage
              │     └── CaseResultList
              │           └── CaseCard      href={NEXT_PUBLIC_APP_BASE_URL/cases/id}
              └── ChatInput    'use client'  props: onSubmit, disabled
```

---

## Layer rules

| Layer | Files | Notes |
|---|---|---|
| Server Route | `app/api/cases/search/route.ts` | Only place that reads `JWT_TOKEN` and `API_BASE_URL` |
| Page | `app/page.tsx`, `app/layout.tsx` | Server Components — no hooks, no useState |
| Client Components | `src/components/*.tsx` | Must have `'use client'` if they use hooks or event handlers |
| Client Hooks | `src/hooks/*.ts` | Client-side only; never imported by server files |
| Client API | `src/api/searchCases.ts` | Calls `/api/cases/search` (local); never calls CaseController directly |
| Types | `src/types/*.ts` | Shared between server and client; no project imports |
| Configuration | `.env` | `JWT_TOKEN` and `API_BASE_URL` server-only; `NEXT_PUBLIC_APP_BASE_URL` client-safe |

---

## Files that must never be committed

| File | Reason |
|---|---|
| `.env` | Contains `JWT_TOKEN` (live API credential) and `API_BASE_URL`. Committing exposes credentials in version history. |
