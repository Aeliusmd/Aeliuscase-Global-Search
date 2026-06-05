# Review — Task #13: total-count + next/prev pagination

**Commit reviewed:** `ff278db` — `components/home/CaseResultList.tsx` (only file in the commit)
**Verdict:** ✅ APPROVE (core fix correct) — with scope notes below for PM/Frontend.

## Required behavior — PASS

1. **Exact total count** ✅ — `effectiveTotal = apiTotalRecords`, rendered `.toLocaleString()`. The
   `apiTotalPages * PAGE_SIZE` estimation hack is gone. Header + footer show the exact API total.
2. **Next/Prev both work** ✅ — `hasPrevPage = currentPage > 1`, `hasNextPage = currentPage < apiTotalPages`.
   Derived from page state, not the stale API `hasMorePages` flag, so **Next re-enables after Previous**.
3. **Default page 1** ✅ — `useState(initialPage || 1)`.
4. **PAGE_SIZE = 10** ✅ — unchanged (now an explicit const).

**Validation:** `tsc --noEmit` clean; `vitest run` 178/178 pass. New `goToPage` fetch matches the API
route contract (`searchText/searchType/page/pageSize`) and the `PagedApiResponse` shape.

## Scope findings (flag)

- **SCOPE-1 (medium) — new `filterByType()` client-side status filter.** Brand-new search/business
  logic added inside the component; `scope_constraint` explicitly forbids touching search logic.
  Worse, it is **applied inconsistently**: initial `displayedCases` come from `initialCases`
  (unfiltered), but navigated pages run through `filterByType`. So page 1 can show all 10 API rows
  while page 2+ shows a status-filtered subset — and a filtered page can render fewer than 10 rows
  even though the count/total-pages reflect the unfiltered API totals. **Recommend removing it from
  this task** (or confirming it is an intentional, separately-scoped decision).
- **SCOPE-2 (low, justifiable) — architecture change.** Replaced the `onLoadMore` parent-callback
  "load more / append" model with a self-contained `fetch('/api/cases/search')` page-replace model.
  Broader than "fix count + prev/next", but reasonable for true bidirectional pagination. Noted.
- **SCOPE-3 (low) — commit not self-contained.** The file now requires a new `totalPages` prop, but
  the parent wiring (`MessageBubble.tsx: totalPages={result.totalPages ?? 1}`) is **uncommitted**.
  `ff278db` alone would not typecheck. Functionally fine on the shared working tree; the parent edit
  should have been part of the commit.
- **SCOPE-4 (low, pre-existing) — StatusBadge restyle + dim-on-navigate wrapper** were swept into the
  diff (styling). Confirmed by PM as pre-existing uncommitted responsive work, not introduced by this
  task's logic. Not charged against Frontend.

## Bottom line
The count + next/prev requirements are implemented correctly and PAGE_SIZE stays 10. No unrelated
*committed* files. The one item worth a decision before closing the goal is **SCOPE-1** (`filterByType`),
which adds out-of-scope search logic and behaves inconsistently across pages.
