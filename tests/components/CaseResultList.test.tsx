import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CaseResultList from '../../components/home/CaseResultList';
import { MainSearchType } from '@/types/case';
import type { CaseSearchItem, PagedApiResponse } from '@/types/case';

/**
 * Focused QA for task #12: the total-count display and Next/Previous
 * pagination behaviour in components/home/CaseResultList.tsx.
 *
 * Scope is deliberately narrow — only count + pagination. No styling,
 * no unrelated assertions. The component renders each case number twice
 * (mobile card + desktop table), so case-number lookups use *AllByText.
 */

const PAGE_SIZE = 10;

function makeCase(page: number): CaseSearchItem {
  return {
    id: page,
    caseNumber: `CASE-P${page}`,
    fileNumber: `F${page}`,
    caseName: `Case on page ${page}`,
    caseTypeId: 1,
    caseType: 'Workers Comp',
    caseStatusDescription: 'Open',
    caseAttorneyNickName: 'JD',
    caseCoordinatorNickName: 'CC',
    createdDateTime: '2024-03-15T00:00:00Z',
    caseApplicant: { firstName: 'Jane', lastName: 'Smith', fullName: 'Jane Smith' },
    caseEmployee: { company: 'Acme Corp' },
  };
}

// Per-test API shape. STALE_HAS_MORE simulates the buggy upstream flag the old
// code trusted; the component must IGNORE it and derive nav from page vs totalPages.
let TOTAL_RECORDS = 27000;
let TOTAL_PAGES = 2700;
let STALE_HAS_MORE = false;

function makeResponse(page: number): PagedApiResponse<CaseSearchItem> {
  return {
    page,
    pageSize: PAGE_SIZE,
    totalPages: TOTAL_PAGES,
    totalRecords: TOTAL_RECORDS,
    isFirstPage: page === 1,
    isLastPage: page === TOTAL_PAGES,
    hasMorePages: STALE_HAS_MORE,
    status: 200,
    succeeded: true,
    message: null,
    errors: null,
    data: [makeCase(page)],
  };
}

function renderList(overrides: Partial<React.ComponentProps<typeof CaseResultList>> = {}) {
  const props: React.ComponentProps<typeof CaseResultList> = {
    msgId: 'm1',
    toolCallId: 't1',
    cases: [makeCase(1)],
    totalRecords: TOTAL_RECORDS,
    totalPages: TOTAL_PAGES,
    query: 'smith',
    searchType: MainSearchType.AllCases,
    page: 1,
    hasMorePages: STALE_HAS_MORE,
    ...overrides,
  };
  return render(<CaseResultList {...props} />);
}

beforeEach(() => {
  TOTAL_RECORDS = 27000;
  TOTAL_PAGES = 2700;
  STALE_HAS_MORE = false;

  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const page = Number(u.searchParams.get('page')) || 1;
    return {
      ok: true,
      json: async () => makeResponse(page),
    } as Response;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const nextBtn = () => screen.getByRole('button', { name: /next/i });
const prevBtn = () => screen.getByRole('button', { name: /previous/i });

describe('CaseResultList — exact total count', () => {
  it('header shows the EXACT API totalRecords (27,000), not an estimate', () => {
    renderList();
    expect(screen.getByText(/27,000 cases found/)).toBeInTheDocument();
  });

  it('does NOT apply the old totalPages*PAGE_SIZE estimation hack', () => {
    // Discriminating case: totalRecords (10) <= PAGE_SIZE while totalPages > 1.
    // Old code would have shown 10 * 5 = 50. Exact display must show 10.
    TOTAL_RECORDS = 10;
    TOTAL_PAGES = 5;
    renderList({ totalRecords: 10, totalPages: 5 });
    expect(screen.getByText(/10 cases found/)).toBeInTheDocument();
    expect(screen.queryByText(/50 cases found/)).not.toBeInTheDocument();
  });

  it('header total stays the exact API value after navigating', async () => {
    renderList();
    fireEvent.click(nextBtn());
    await screen.findAllByText('CASE-P2');
    expect(screen.getByText(/27,000 cases found/)).toBeInTheDocument();
  });
});

describe('CaseResultList — pagination defaults', () => {
  it('defaults to page 1 (Previous disabled, Next enabled)', () => {
    renderList({ page: 1 });
    expect(prevBtn()).toBeDisabled();
    expect(nextBtn()).not.toBeDisabled();
  });

  it('coerces a falsy initial page to page 1', () => {
    renderList({ page: 0 });
    // currentPage falls back to 1, so Previous is disabled.
    expect(prevBtn()).toBeDisabled();
  });
});

describe('CaseResultList — Next / Previous navigation', () => {
  it('Next advances to the following page and enables Previous', async () => {
    renderList();
    fireEvent.click(nextBtn());
    await screen.findAllByText('CASE-P2');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('page=2');
    expect(prevBtn()).not.toBeDisabled();
  });

  it('Previous goes back to the earlier page', async () => {
    renderList();
    fireEvent.click(nextBtn());
    await screen.findAllByText('CASE-P2');

    fireEvent.click(prevBtn());
    await screen.findAllByText('CASE-P1');
    expect(prevBtn()).toBeDisabled();
  });

  it('REGRESSION: you can go Next again after going Previous', async () => {
    // The core reported bug: after Previous, Next stayed disabled because it
    // was driven by the stale API hasMorePages flag (false here).
    renderList();

    fireEvent.click(nextBtn()); // -> page 2
    await screen.findAllByText('CASE-P2');

    fireEvent.click(prevBtn()); // -> back to page 1
    await screen.findAllByText('CASE-P1');

    // Next must be re-enabled (derived from currentPage < totalPages).
    expect(nextBtn()).not.toBeDisabled();

    fireEvent.click(nextBtn()); // -> forward again to page 2
    const onP2Again = await screen.findAllByText('CASE-P2');
    expect(onP2Again.length).toBeGreaterThan(0);
  });

  it('Next is disabled on the last page', async () => {
    TOTAL_PAGES = 2;
    TOTAL_RECORDS = 15;
    renderList({ totalPages: 2, totalRecords: 15 });

    fireEvent.click(nextBtn()); // -> page 2 (last)
    await screen.findAllByText('CASE-P2');

    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).not.toBeDisabled();
  });

  it('ignores the stale API hasMorePages flag for Next availability', async () => {
    // API keeps reporting hasMorePages=false, but there are clearly more pages.
    STALE_HAS_MORE = false;
    TOTAL_PAGES = 3;
    renderList({ totalPages: 3, hasMorePages: false });

    fireEvent.click(nextBtn()); // -> page 2 of 3
    await screen.findAllByText('CASE-P2');

    // currentPage(2) < totalPages(3) => Next still enabled despite stale flag.
    expect(nextBtn()).not.toBeDisabled();
  });

  it('keeps PAGE_SIZE=10 in the request', async () => {
    renderList();
    fireEvent.click(nextBtn());
    await screen.findAllByText('CASE-P2');
    const calledUrl = String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('pageSize=10');
  });
});
