# US-007: AI-Mediated Case Search Chat
**Epic:** Chatbot Widget — AI Chat Layer
**Version:** 1.0
**Date:** 2026-06-05
**Status:** Implemented (beyond original MVP spec) — pending product sign-off (see QUESTIONS.md AI-14)

---

## User Story

**As a** legal staff member,
**I want to** type a natural language message and receive a conversational response alongside case results,
**So that** the widget understands intent (not just keywords) and handles non-search messages gracefully without breaking.

---

## Background and Context

The original MVP spec (US-002) described direct forwarding of the user's query to `GET /api/Case/Search`. In the implemented architecture, every user message is instead sent to `/api/chat` (a Next.js POST route) where an LLM processes it.

The LLM:
1. Receives the user's message and any prior chat history
2. Decides whether to call the `searchCases` tool (for search requests) or respond conversationally (for greetings, follow-up questions, etc.)
3. When `searchCases` is called, it calls `GET /api/Case/Search` server-to-server with the JWT token and returns structured results
4. Streams both the LLM text response and the structured tool results back to the frontend via the AI SDK `UIMessage` stream

The user sees case cards rendered from the tool output, plus an optional short LLM summary sentence.

---

## Acceptance Criteria

### AC1 — Case search request triggers tool call
Given the chat widget is open and I type "show me open cases for John Smith",
When the message is submitted,
Then the LLM calls the `searchCases` tool with `searchText="John Smith"` (or similar) and `searchType` matching the active filter,
And the case results are displayed as `<CaseCard>` components.

### AC2 — Non-search message gets conversational response
Given the chat widget is open and I type "hello" or "thank you",
When the message is submitted,
Then the LLM responds with a short conversational message,
And no `searchCases` tool call is made,
And no case cards are rendered for that message.

### AC3 — Active filter is respected
Given I have selected "Open Cases" in the SearchTypeFilter,
When I submit a case search query,
Then the LLM passes `searchType=2` (OpenCases) to the `searchCases` tool,
And the results are filtered to open cases only.

### AC4 — LLM summary accompanies results
Given a search returns one or more cases,
When results are displayed,
Then the bot also shows a short summary text (e.g. "Found 12 cases matching 'John Smith'."),
And the summary is rendered via `<BotMessage>` above or alongside the case cards.

### AC5 — JWT token is never sent to the browser
Given I inspect the browser Network tab while submitting a search,
When I examine all outgoing requests,
Then no request to `uatapi.aeliuscase.com` is visible,
And no `Authorization: Bearer` header is present in any browser-initiated request.

### AC6 — LLM provider is configurable
Given the AI provider key is set in `.env.local` (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`),
When the chat route is called,
Then the correct provider SDK is used,
And changing the key and model identifier in `app/api/chat/route.ts` requires no other code changes.

### AC7 — Missing AI API key returns a clear error
Given `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) is not set in `.env.local`,
When a message is submitted,
Then the widget displays an error: "AI configuration error. Please contact your administrator.",
And the input field is re-enabled.

### AC8 — Streaming response is progressive
Given a search query is submitted,
When the LLM begins responding,
Then the typing indicator (animated dots) is shown while the response streams,
And content appears progressively rather than all at once.

### AC9 — Maximum step limit prevents runaway loops
Given the LLM is processing a message,
When the number of agentic steps (tool calls + responses) reaches 5,
Then the response is stopped and the current output is returned,
And no infinite tool-call loops occur.

---

## Out-of-Scope for This Story

- Changing the underlying AI model (AC6 covers provider-level configurability; model selection is a developer config)
- Multi-turn reasoning over multiple search rounds within one message — one tool call per message is the MVP pattern
- AI response caching — post-MVP
- Cost monitoring or quota alerts — post-MVP

---

## AI Provider Decision (open)

See QUESTIONS.md AI-13. The current implementation uses `openai('gpt-4o-mini')`. The recommended change is:

```typescript
// Current (OpenAI)
import { openai } from '@ai-sdk/openai';
const model = openai('gpt-4o-mini');

// Recommended (Claude — project standard)
import { anthropic } from '@ai-sdk/anthropic';
const model = anthropic('claude-haiku-4-5-20251001');  // fast + cheap
// or:
const model = anthropic('claude-sonnet-4-6');          // higher quality
```

Required env var change: remove `OPENAI_API_KEY`, add `ANTHROPIC_API_KEY`.

---

## Definition of Done

- [ ] Product Owner has signed off on AI layer being in MVP scope (QUESTIONS.md AI-14)
- [ ] AI provider decision resolved (QUESTIONS.md AI-13)
- [ ] AC1–AC9 manually verified against UAT environment
- [ ] No `Authorization` header visible in browser Network tab for any case search
- [ ] `npm run build` exits 0 with no errors
- [ ] `.env.example` updated to reflect the chosen AI provider key name
