# MVP Scope — Aeliuscase Global Search Chatbot Widget
**Version:** 1.0
**Date:** 2026-06-02
**Status:** Draft — Pending stakeholder sign-off

---

## Overview

A standalone, pure-frontend chatbot widget (React + Vite + TypeScript + Tailwind CSS) embedded on the Aeliuscase legal case management platform. The widget allows legal staff to search and filter cases using natural language queries, surfacing results as interactive case cards without leaving the current page.

---

## In Scope — MVP v1.0

### Widget Shell
- Floating chatbot icon rendered in the bottom-right corner of the host page
- Click to open / click or press Escape to close the chat window
- Chat window renders inside the host page (no modal overlay, no separate route)
- Responsive layout that does not obstruct core Aeliuscase UI

### Chat Interaction
- Single text input field accepting free-text natural language queries in English or Sinhala script
- Submit on Enter key or a Send button
- Query is forwarded as-is to the CaseController search API; no local NLP processing
- Loading / spinner state while awaiting API response

### Case Result Cards
- Results rendered as a scrollable list of case cards inside the chat window
- Each card displays: Case Number, Title, Client Name, Status badge, Opened Date
- "View" button on each card opens the case URL in a new browser tab (`target="_blank"`, `rel="noopener noreferrer"`)
- Maximum 20 results displayed per query (one page, no pagination in MVP)

### Empty State
- Friendly message when the API returns zero results
- Message includes the original query so the user can confirm what was searched

### Error State
- Distinct error message when the API call fails (network error, non-2xx response)
- Specific guidance when a 401 Unauthorized response is received (JWT likely expired)
- User can retry by submitting the same or a new query without refreshing the page

### Authentication
- JWT Bearer token loaded exclusively from the `.env` file (`VITE_API_JWT_TOKEN`)
- Token is injected into every API request header automatically
- No login UI; token management is a developer/operator responsibility in MVP

### Environment Configuration
- All API base URL and token values configurable via `.env` / `.env.local`
- No hardcoded credentials or URLs in source code

### Browser Support
- Chrome (latest stable)
- Microsoft Edge (latest stable)

---

## Out of Scope — MVP v1.0

The following items are explicitly excluded from MVP. They may be considered for future iterations.

| Item | Reason for Exclusion |
|---|---|
| Automatic JWT refresh / OAuth flow | Token rotation is a manual developer task in MVP |
| User authentication UI (login screen) | Host platform already handles auth |
| Pagination / infinite scroll for results | Complexity vs. value trade-off; 20 results covers primary use case |
| Advanced filter UI (date pickers, dropdowns) | Natural language query handles filtering via API params |
| Sinhala NLP / intent parsing | API accepts free text; no local NLP layer needed |
| Saving or bookmarking searches | Out of MVP scope |
| Chat history persistence across page reloads | Session-only memory is sufficient for MVP |
| Case creation or editing from the widget | Read-only search widget in MVP |
| Mobile / touch layout optimisation | Desktop legal workstations are the primary target |
| Firefox, Safari browser support | Prioritised for post-MVP |
| Dark mode | Out of MVP scope |
| Analytics / usage tracking | Out of MVP scope |
| Accessibility (WCAG AA) full audit | Basic keyboard navigation included; full audit post-MVP |
| Multi-language UI (non-English labels) | Query input supports Sinhala; UI labels are English only |
| Unit test coverage > 80 % | Smoke tests and manual testing sufficient for MVP |

---

## Success Criteria

MVP v1.0 is considered complete when ALL of the following are true:

1. **Functional:** A legal staff member can open the chat widget, type "show me open cases for [client name]", and receive matching case cards within 3 seconds on a standard office network.
2. **Navigation:** Clicking "View" on any result card opens the correct case in a new browser tab without navigating away from the current page.
3. **Error handling:** When the `.env` JWT token is expired or missing, the widget displays a clear, actionable error message instead of a blank state or unhandled exception.
4. **Configuration:** A developer can deploy the widget against any CaseController API endpoint by editing only the `.env` file — no source code changes required.
5. **Stability:** No unhandled JavaScript exceptions thrown during a standard search session (open widget → query → view results → close widget) in Chrome and Edge.
6. **Build:** `vite build` produces a clean production bundle with no TypeScript errors and no ESLint errors.

---

## Assumptions and Dependencies

- The CaseController REST API is available and returns a response conforming to the contract in `docs/requirements/api-contract.md`.
- JWT tokens are provided to the developer out-of-band and are valid for at least 1 hour.
- The host Aeliuscase page does not apply a Content-Security-Policy that blocks the widget's API calls.
- Case URLs returned in `caseItem.caseUrl` are fully qualified and openable in a browser tab without additional authentication steps.

---

## Open Questions

See `docs/requirements/QUESTIONS.md` for items requiring stakeholder or dev-team clarification before development begins.
