# ADR-001: Technology Stack Selection

| Field | Value |
|---|---|
| Status | Accepted (revised 2026-06-02 — Next.js replaces React+Vite) |
| Date | 2026-06-02 |
| Deciders | Architect |
| Consulted | Frontend dev team, Backend dev team |
| Informed | Project stakeholders |

---

## Decision 1: Next.js 15 (App Router) over plain React + Vite

### Decision

Use **Next.js 15** with the App Router as the frontend framework. All interactive components use the `'use client'` directive. Server Components handle the root layout only.

### Context

The deliverable is a chatbot widget — a floating UI panel that queries the CaseController REST API and displays filtered case results. The widget could be built as a plain React+Vite static bundle, but Next.js 15 was selected because the team is standardising on Next.js across the Aeliuscase product suite and it enables a critical security improvement: the JWT Bearer token can be kept server-side via a Next.js API Route proxy (see Decision 5).

### Rationale

- **Team standardisation.** Using the same framework across projects reduces context-switching, onboarding cost, and toolchain fragmentation. The Aeliuscase product suite benefits from a single framework.
- **Built-in API Route proxy.** Next.js API Routes allow the widget to proxy requests to the CaseController API server-side. This means the JWT token never leaves the Next.js server — it is never bundled into client JavaScript and never visible in the browser. This eliminates a significant JWT exposure risk present in the plain Vite approach.
- **CORS solved automatically.** The API Route proxy calls the CaseController API from the server; no browser CORS preflight is needed.
- **Deployment simplicity.** Next.js deploys to Vercel (zero-config), Azure App Service, or any Node.js host. One `npm run build` produces both the frontend bundle and the API route handler.
- **Tailwind CSS v3/v4 support.** Next.js 15 ships with first-class Tailwind CSS setup via `create-next-app`.
- **React 19 included.** Next.js 15 bundles React 19 — all the same component patterns (hooks, concurrent features) apply.

### Consequences

- Positive: JWT is fully server-side; never exposed in browser DevTools or network requests to the client.
- Positive: No CORS configuration required on the CaseController API for the widget.
- Positive: Consistent framework across Aeliuscase product suite.
- Positive: First-class Vercel deployment support.
- Negative: Next.js requires a Node.js server (or serverless runtime) at runtime — it cannot be served as a purely static file from a CDN without configuration.
- Negative: All interactive components must be explicitly marked `'use client'`. Forgetting this causes hydration errors.
- Negative: Slightly larger framework footprint than a plain Vite bundle. Mitigated by Next.js code-splitting.

---

## Decision 2: No AI/NLP Layer in MVP

### Decision

The MVP widget uses **keyword and filter-based search only**, delegating all matching logic to the existing CaseController REST API query parameters. No large-language model, no embedding model, no semantic search layer is introduced for MVP.

### Context

The CaseController `GET /api/Case/Search` endpoint already accepts free-text `searchText` and a `searchType` enum (AllCases, OpenCases, ClosedCases, SubOutCases). A natural-language query such as "open cases for John Smith" can be submitted directly as `searchText`. An AI layer would introduce external service dependencies, latency, API cost, and complexity before the core search-and-display loop is validated.

### Rationale

- **Dependency minimisation.** Adding an AI layer in MVP means the widget cannot function if the LLM provider is down or slow. The CaseController API is the only hard dependency.
- **Legal data sensitivity.** Routing user queries through a third-party LLM API raises data privacy concerns for a legal case management platform. This requires a DPA review out of scope for MVP.
- **Incremental upgrade path.** The `useCaseSearch` hook encapsulates all query logic. An AI-powered query parser can be swapped in behind that interface in a future iteration without touching the UI layer.

### Alternatives rejected

| Alternative | Reason rejected |
|---|---|
| **Claude API (Anthropic) as query parser** | External dependency, per-token cost, latency, legal data privacy review needed. Post-MVP. |
| **Local embedding model (transformers.js / WebLLM)** | 50-200 MB bundle, slow first inference, disproportionate for MVP. |

### Consequences

- Positive: Zero AI infrastructure cost for MVP.
- Negative: Query matching is limited to what the CaseController `searchText` parameter supports.

---

## Decision 3: JWT Stored Server-Side via Next.js API Route (not in .env client bundle)

### Decision

The JWT Bearer token is stored in a **server-side environment variable** (`JWT_TOKEN`, no `NEXT_PUBLIC_` prefix). It is injected by the Next.js API Route handler (`app/api/cases/search/route.ts`) when proxying requests to the CaseController API. The token is **never** sent to the browser.

### Context

In the original Vite design, `VITE_JWT_TOKEN` was inlined into the client-side bundle at build time (all `VITE_*` variables are). This meant any user who opened DevTools could read the JWT. With Next.js, variables without the `NEXT_PUBLIC_` prefix are available only to server-side code, making it trivially easy to keep the JWT server-side.

### Rationale

- **Token never leaves the server.** `process.env.JWT_TOKEN` is only accessible in `app/api/cases/search/route.ts` (a server-side file). The browser JavaScript bundle never contains the token.
- **No XSS exposure.** A malicious script injected into the host page cannot extract the JWT because it was never sent to the browser.
- **Same rotation workflow.** A developer still updates `.env` when the token expires and restarts the server — the user-facing rotation process is unchanged.
- **Legal data protection.** For a legal case management platform, reducing credential exposure is a meaningful compliance improvement.

### Alternatives rejected

| Alternative | Reason rejected |
|---|---|
| **`NEXT_PUBLIC_JWT_TOKEN` (client-side)** | Identical to the Vite approach — token visible in browser. Worse security posture with no benefit. |
| **Full OAuth2 PKCE flow** | Correct long-term solution but requires auth server integration, redirect handling, and secure token storage — multiple sprints of work that delays validation of the widget UX. Post-MVP. |

### Environment variables — complete set

| Variable | Prefix | Exposed to browser | Description |
|---|---|---|---|
| `JWT_TOKEN` | none | **No** | Bearer token for CaseController API. Server-side only. |
| `API_BASE_URL` | none | **No** | CaseController API base URL. Server-side only. |
| `NEXT_PUBLIC_APP_BASE_URL` | `NEXT_PUBLIC_` | Yes | Aeliuscase host app URL for constructing case deep-link URLs. |

### Consequences

- Positive: JWT never exposed in browser DevTools, network tab, or client JS bundle.
- Positive: CORS not required on the CaseController API — requests go server-to-server.
- Positive: Rotation (update `.env` + restart) is the same developer workflow as before.
- Negative: Widget requires a running Next.js server — cannot be served as a static file with this security model.
- Post-MVP obligation: Replace with OAuth2 / host-app session token before multi-user production deployment.

---

## Decision 4: Tailwind CSS v3 over CSS Modules

### Decision

Use **Tailwind CSS v3** (utility-first) for all widget styling. Do not use CSS Modules, plain CSS, or a component library such as MUI or Chakra UI.

### Rationale

- Speed of development for a small component surface (fewer than 12 components).
- JIT compilation keeps the CSS bundle minimal.
- No risk of style collisions with the host Aeliuscase page when a CSS prefix is configured.
- `create-next-app` sets up Tailwind v3 automatically.

### Consequences

- Positive: Rapid UI iteration.
- Positive: Small CSS bundle after JIT compilation.
- Negative: Verbose conditional class strings on complex components; mitigated by `cn()` utility (clsx + tailwind-merge).

---

## Decision 5: Next.js API Route as CaseController Proxy

### Decision

Add a thin server-side API route at `app/api/cases/search/route.ts` that:
1. Receives the browser's search request (`searchText`, `searchType`, `page`, `pageSize`)
2. Reads `process.env.JWT_TOKEN` and `process.env.API_BASE_URL` server-side
3. Forwards the request to `GET ${API_BASE_URL}/api/Case/Search` with the JWT Bearer header
4. Returns the `PagedApiResponse<CaseSearchItem>` JSON to the browser

The widget's client-side code calls `/api/cases/search` (local Next.js route) — it never directly calls the CaseController UAT URL.

### Rationale

This is the key architectural advantage of choosing Next.js over plain React+Vite. The proxy adds one network hop (browser → Next.js server → CaseController) but provides:
- JWT stays server-side (see Decision 3)
- CORS solved automatically
- Future extensibility: rate limiting, caching, logging, auth middleware can be added at the proxy layer without touching the client

### Consequences

- Positive: All benefits of Decision 3.
- Positive: CORS not a blocker.
- Negative: One extra network hop. Latency impact is negligible on a LAN or same-datacenter deployment.
