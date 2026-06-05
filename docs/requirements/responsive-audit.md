# Responsive UI Audit — Aeliuscase Global Search
**Date:** 2026-06-05  
**Author:** Analyst (APEX team)  
**Goal:** Inventory every frontend file that needs responsive fixes to support 320px → 1440px.

---

## Project UI Architecture

Two parallel component trees exist:

| Tree | Path | Purpose |
|---|---|---|
| **Main App** | `app/page.tsx` + `components/home/` | Full-page chat interface with sidebar |
| **Chat Widget** | `src/components/` (ChatWidget, ChatPanel, FloatingButton) | Floating overlay widget embedded in other pages |

Both trees render `CaseResultList`, `CaseCard`, and `SearchTypeFilter` (duplicated with slight style differences).

---

## Audit Findings by Priority

### CRITICAL — Blocks core usage on mobile

| # | File | Issue | Breakpoint Impact |
|---|---|---|---|
| C1 | `app/page.tsx` | Root layout is `flex h-screen` with sidebar always visible — no mobile drawer/toggle exists. At <768px, the `w-64` sidebar consumes most of the screen, leaving ChatArea with ~50px width. | <768px broken |
| C2 | `components/home/Sidebar.tsx` | `w-64 flex-shrink-0` — never collapses. No `hidden md:flex` guard. No mobile close button. No hamburger trigger. | <768px broken |
| C3 | `src/components/ChatPanel.tsx` | `fixed bottom-24 right-6 w-96` — 384px panel overflows viewport on phones <400px. Panel clips off-screen. | <400px broken |

---

### HIGH — Significant UX degradation

| # | File | Issue | Breakpoint Impact |
|---|---|---|---|
| H1 | `components/home/ChatArea.tsx` | No hamburger/menu button in the header to open the sidebar on mobile (needed once C1/C2 are fixed). | <768px |
| H2 | `components/home/ChatArea.tsx` | Message list uses `px-6` (24px each side) — on 320px this leaves only 272px for content. Should be `px-3 sm:px-6`. | <640px |
| H3 | `components/home/CaseResultList.tsx` | Full data table with `overflow-x-auto` is the only layout — no card-stack fallback. At 320px inside a narrow ChatArea, the horizontal scroll is the entire interaction. | <640px |
| H4 | `components/home/MessageBubble.tsx` | User bubble: `max-w-[72%]` is a fixed percentage. At 320px with `gap-3` + avatar (w-8=32px), effective bubble width ≈ 178px. Very narrow for readable text. | <480px |

---

### MEDIUM — Noticeable issues, workaround exists

| # | File | Issue | Breakpoint Impact |
|---|---|---|---|
| M1 | `src/components/UserMessage.tsx` | `max-w-xs` (320px) at mobile fills nearly the full panel width with no breathing room. Should scale with panel. | <400px |
| M2 | `src/components/BotMessage.tsx` | Same `max-w-xs lg:max-w-md` — missing `sm:` step. | <640px |
| M3 | `components/home/CaseResultList.tsx` | Table header: `max-w-[160px]` query label truncation is aggressive inside the gradient header at 320px. | <400px |
| M4 | `components/home/ChatArea.tsx` | Empty-state suggestion chips: `flex-wrap justify-center` is correct but chips have `whitespace-nowrap` and use `px-3.5 py-2` — 4 chips will wrap correctly but may be cramped at 320px. | <400px |
| M5 | `app/globals.css` | No `touch-action: manipulation` on interactive elements — causes 300ms tap delay on mobile browsers (Safari/Chrome-Android). | All mobile |
| M6 | `app/globals.css` | No `viewport` meta — layout.tsx doesn't set it either. Next.js injects a default, but explicit `width=device-width, initial-scale=1` should be confirmed. | All mobile |
| M7 | `tailwind.config.ts` | No `xs` breakpoint for 320–475px targeting. Tailwind `sm:` starts at 640px — there is a 320px dead zone where only un-prefixed classes apply. | 320–639px |

---

### LOW — Minor polish / edge-case-only

| # | File | Issue | Breakpoint Impact |
|---|---|---|---|
| L1 | `components/home/Sidebar.tsx` | Footer user panel: `w-full hover:bg-white/8` — `/8` is not a valid Tailwind opacity suffix; should be `/[0.08]` or `hover:bg-white/5`. Not a responsive issue but a CSS bug. | All |
| L2 | `components/home/InputBar.tsx` | Suggestion chips row: `flex items-center gap-2 flex-wrap` — already wraps. OK. No fix needed unless wrap creates 3-row display at 320px. | 320px (low risk) |
| L3 | `components/home/CaseCard.tsx` | `flex items-start justify-between gap-2` with case number + status badge — tight at <200px card width but `gap-2` mitigates. | <320px (rare) |
| L4 | `components/home/SearchTypeFilter.tsx` | `overflow-x-auto` already applied — chips scroll horizontally. Pattern is correct. | ✓ Already OK |
| L5 | `src/components/SearchTypeFilter.tsx` | Same as L4 — `overflow-x-auto flex-shrink-0` in place. | ✓ Already OK |
| L6 | `src/components/FloatingButton.tsx` | `fixed bottom-6 right-6 w-14 h-14` — 56px tap target, correct. No issues. | ✓ Already OK |
| L7 | `src/components/ChatInput.tsx` | `px-3 py-3` input row — fine on all sizes. | ✓ Already OK |
| L8 | `src/components/CaseResultList.tsx` | `w-full max-w-sm` within the chat panel — scales correctly inside the panel width. | ✓ Already OK |

---

## Files Requiring Changes (Summary)

| Priority | File | Change Type |
|---|---|---|
| CRITICAL | `app/page.tsx` | Add mobile sidebar state + overlay backdrop |
| CRITICAL | `components/home/Sidebar.tsx` | Add `hidden md:flex` + mobile drawer + close button |
| CRITICAL | `src/components/ChatPanel.tsx` | Fix `w-96` → `w-[calc(100vw-2rem)] sm:w-96 max-w-[24rem]` |
| HIGH | `components/home/ChatArea.tsx` | Add hamburger button; fix `px-6` → `px-3 sm:px-6`; empty-state adjustments |
| HIGH | `components/home/CaseResultList.tsx` | Add mobile card-stack view (≤ sm); keep table for md+ |
| HIGH | `components/home/MessageBubble.tsx` | User bubble max-width fluid |
| MEDIUM | `src/components/UserMessage.tsx` | Adjust max-width for panel size |
| MEDIUM | `src/components/BotMessage.tsx` | Add `sm:` step for max-width |
| MEDIUM | `app/globals.css` | Add `touch-action: manipulation`; verify viewport |
| LOW | `tailwind.config.ts` | Add `xs: '475px'` breakpoint |
| LOW | `components/home/Sidebar.tsx` | Fix CSS bug `hover:bg-white/8` |

---

## Files Confirmed OK (No Changes Needed)

- `app/layout.tsx` — minimal shell, no layout issues
- `src/components/FloatingButton.tsx` — correct tap target, fixed position
- `src/components/ChatWidget.tsx` — orchestration only, no layout
- `src/components/ChatInput.tsx` — compact and fluid
- `src/components/CaseResultList.tsx` — `w-full max-w-sm` correct for panel
- `components/home/SearchTypeFilter.tsx` — overflow-x-auto in place
- `src/components/SearchTypeFilter.tsx` — overflow-x-auto in place

---

## Breakpoint Test Matrix

Frontend agent should verify at the following widths:

| Width | Device Class | Key Things to Check |
|---|---|---|
| 320px | iPhone SE (smallest) | Sidebar hidden, ChatPanel full-width, no overflow |
| 375px | iPhone 14 mini | ChatPanel fits, bubbles readable |
| 430px | iPhone 14 Pro Max | All overlays fit |
| 768px | iPad portrait | Sidebar visible or toggle-able |
| 1024px | iPad landscape / small laptop | Full two-column layout |
| 1280px | Desktop | Default layout baseline |
| 1440px | Wide desktop | No over-stretch |

---

## Acceptance Criteria (for Tester task #10)

1. At 320px: no horizontal page scroll; sidebar is hidden; ChatPanel fits within viewport.
2. At 768px: sidebar is visible; ChatArea fills remaining space.
3. Suggestion chips never cause horizontal body overflow.
4. CaseResultList table is horizontally scrollable (not page-scrollable) or shows card layout on mobile.
5. All tap targets ≥ 44px (W3C touch guideline).
6. FloatingButton and ChatPanel do not overlap or clip at any tested breakpoint.
7. `touch-action: manipulation` applied to all interactive elements.
