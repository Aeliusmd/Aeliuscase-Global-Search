# C4 Level 1 - System Context Diagram

## Aeliuscase Global Search Chatbot Widget

This diagram shows how the chatbot widget fits into the broader ecosystem: who uses it, what external systems it depends on, and what it does not own.

```mermaid
C4Context
    title System Context — Aeliuscase Global Search Chatbot Widget

    Person(user, "Legal Staff / Case Worker", "A staff member using the Aeliuscase platform to search and manage legal cases.")

    System(widget, "Aeliuscase Chatbot Widget", "Standalone React frontend widget. Accepts natural-language case queries and displays matching case cards with links back into the core application.")

    System_Ext(caseApi, "CaseController REST API", "Existing production REST API. Exposes case search and filter endpoints. Returns JSON case objects. Owned by the Aeliuscase backend team.")

    System_Ext(aeliusApp, "Aeliuscase Web Application", "Existing production legal case management platform. The chatbot widget is embedded within or alongside this application. Case detail pages live here.")

    Rel(user, widget, "Types natural-language queries", "Browser / HTTPS")
    Rel(widget, caseApi, "Searches and filters cases", "HTTPS / REST / JWT Bearer")
    Rel(widget, aeliusApp, "Opens case detail pages via deep-link URL", "Browser navigation / new tab")
    Rel(user, aeliusApp, "Manages cases (existing workflow)", "Browser / HTTPS")
```

## Boundary notes

| Element | Owned by this project | Notes |
|---|---|---|
| Aeliuscase Chatbot Widget | YES | The system being built. Pure frontend, no new backend. |
| CaseController REST API | NO | Provided by the backend dev team. No changes required. |
| Aeliuscase Web Application | NO | Existing platform. The widget links into it; it does not modify it. |
| Legal Staff / Case Worker | N/A | Primary user persona. Authenticated via an existing session that produces the JWT. |

## Key design constraint

The widget is a **read-only consumer** of the CaseController API. It does not write, create, or mutate case records. All mutation workflows remain inside the Aeliuscase Web Application.
