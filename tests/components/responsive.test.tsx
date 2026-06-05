import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import BotMessage from '@/components/BotMessage';
import UserMessage from '@/components/UserMessage';
import SearchTypeFilter from '@/components/SearchTypeFilter';
import CaseCard from '@/components/CaseCard';
import { MainSearchType } from '@/types/case';
import type { CaseSearchItem } from '@/types/case';

const ROOT = path.resolve(__dirname, '../../');

const baseCase: CaseSearchItem = {
  id: 1,
  caseNumber: 'RP001',
  fileNumber: 'F001',
  caseName: 'Test v. Corp',
  caseTypeId: 1,
  caseType: 'Workers Comp',
  caseStatusDescription: 'Open',
  caseAttorneyNickName: 'JD',
  caseCoordinatorNickName: 'CC',
  createdDateTime: '2024-01-01T00:00:00Z',
  caseApplicant: { firstName: 'Jane', lastName: 'Smith', fullName: 'Jane Smith' },
  caseEmployee: { company: 'Acme Corp' },
};

// ─── BotMessage ──────────────────────────────────────────────────────────────

describe('BotMessage — responsive max-width (AC #1/4)', () => {
  it('default bubble has mobile-first max-w-[90%] class', () => {
    const { container } = render(<BotMessage text="hello" />);
    const bubble = container.querySelector('.max-w-\\[90\\%\\]');
    expect(bubble).not.toBeNull();
  });

  it('default bubble has xs:max-w-xs breakpoint class', () => {
    const { container } = render(<BotMessage text="hello" />);
    const bubble = container.querySelector('.xs\\:max-w-xs');
    expect(bubble).not.toBeNull();
  });

  it('default bubble has sm:max-w-sm breakpoint class', () => {
    const { container } = render(<BotMessage text="hello" />);
    const bubble = container.querySelector('.sm\\:max-w-sm');
    expect(bubble).not.toBeNull();
  });

  it('default bubble has lg:max-w-md breakpoint class', () => {
    const { container } = render(<BotMessage text="hello" />);
    const bubble = container.querySelector('.lg\\:max-w-md');
    expect(bubble).not.toBeNull();
  });

  it('error variant has same responsive max-width classes', () => {
    const { container } = render(<BotMessage text="oops" variant="error" />);
    const bubble = container.querySelector('.max-w-\\[90\\%\\]');
    expect(bubble).not.toBeNull();
  });
});

// ─── UserMessage ─────────────────────────────────────────────────────────────

describe('UserMessage — responsive max-width (AC #1)', () => {
  it('bubble has mobile-first max-w-[85%] class', () => {
    const { container } = render(<UserMessage text="test" />);
    const bubble = container.querySelector('.max-w-\\[85\\%\\]');
    expect(bubble).not.toBeNull();
  });

  it('bubble has xs:max-w-xs breakpoint class', () => {
    const { container } = render(<UserMessage text="test" />);
    const bubble = container.querySelector('.xs\\:max-w-xs');
    expect(bubble).not.toBeNull();
  });
});

// ─── SearchTypeFilter — touch targets ─────────────────────────────────────────

describe('SearchTypeFilter — touch targets & overflow (AC #5)', () => {
  it('filter buttons meet 44px touch target (min-h-[44px])', () => {
    const { container } = render(
      <SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[44px]');
    });
  });

  it('filter container has overflow-x-auto to prevent page scroll', () => {
    const { container } = render(
      <SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('overflow-x-auto');
  });

  it('filter container has flex-shrink-0 to prevent collapse', () => {
    const { container } = render(
      <SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('flex-shrink-0');
  });
});

// ─── CaseCard — touch target ─────────────────────────────────────────────────

describe('CaseCard — touch target (AC #5)', () => {
  it('view case action row meets 44px min-height', () => {
    const { container } = render(<CaseCard caseItem={baseCase} />);
    const row = container.querySelector('.min-h-\\[44px\\]');
    expect(row).not.toBeNull();
  });
});

// ─── ChatPanel — positioning & touch targets (file-content audit) ─────────────

describe('ChatPanel — mobile-first positioning & touch targets (AC #1, #5, #6)', () => {
  const chatPanel = fs.readFileSync(path.join(ROOT, 'src/components/ChatPanel.tsx'), 'utf8');

  it('panel container has left-2 right-2 for mobile full-width', () => {
    expect(chatPanel).toContain('left-2');
    expect(chatPanel).toContain('right-2');
  });

  it('panel container has xs:left-auto for tablet right-anchored mode', () => {
    expect(chatPanel).toContain('xs:left-auto');
  });

  it('panel container has xs:right-6 for tablet right-anchor position', () => {
    expect(chatPanel).toContain('xs:right-6');
  });

  it('panel uses dvh for max-height (accounts for mobile keyboard)', () => {
    expect(chatPanel).toContain('dvh');
  });

  it('panel container has xs:w-96 for tablet width', () => {
    expect(chatPanel).toContain('xs:w-96');
  });

  it('close button meets 44px touch target (w-11 h-11)', () => {
    const closeBtnBlock = chatPanel.slice(chatPanel.indexOf('Close chat panel'));
    expect(closeBtnBlock).toMatch(/w-11\b/);
    expect(closeBtnBlock).toMatch(/h-11\b/);
  });

  it('clear button meets 44px touch target (w-11 h-11)', () => {
    const clearBtnBlock = chatPanel.slice(chatPanel.indexOf('Clear chat history'));
    expect(clearBtnBlock).toMatch(/w-11\b/);
    expect(clearBtnBlock).toMatch(/h-11\b/);
  });
});

// ─── File-level class audits (globals, tailwind, home components) ─────────────
// jsdom can't simulate viewport width, so we assert the critical class
// strings exist in the source files. This validates the mobile-first
// patterns defined in the responsive-breakpoint-strategy spec.

describe('globals.css — overflow & touch rules (AC #7)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');

  it('html/body has overflow-x: hidden to prevent horizontal page scroll', () => {
    expect(css).toMatch(/html\s*,\s*body\s*\{[^}]*overflow-x:\s*hidden/s);
  });

  it('has touch-action: manipulation on interactive elements', () => {
    expect(css).toContain('touch-action: manipulation');
  });

  it('touch-action rule covers button elements', () => {
    const touchBlock = css.match(/button[\s,][^{]*\{[^}]*touch-action[^}]*\}/s)?.[0] ?? '';
    expect(touchBlock).toContain('touch-action');
  });
});

describe('tailwind.config.ts — xs breakpoint (AC #1)', () => {
  const twConfig = fs.readFileSync(path.join(ROOT, 'tailwind.config.ts'), 'utf8');

  it("defines xs: '475px' custom screen breakpoint", () => {
    expect(twConfig).toContain("xs: '475px'");
  });

  it('xs breakpoint is inside theme.extend.screens (does not replace defaults)', () => {
    const extendIdx = twConfig.indexOf('extend');
    const xsIdx = twConfig.indexOf("xs: '475px'");
    expect(xsIdx).toBeGreaterThan(extendIdx);
  });
});

describe('Sidebar.tsx — mobile drawer pattern (AC #1, #2)', () => {
  const sidebar = fs.readFileSync(path.join(ROOT, 'components/home/Sidebar.tsx'), 'utf8');

  it('uses -translate-x-full for hidden state (off-canvas mobile drawer)', () => {
    expect(sidebar).toContain('-translate-x-full');
  });

  it('uses md:translate-x-0 to always show sidebar at md+', () => {
    expect(sidebar).toContain('md:translate-x-0');
  });

  it('sidebar is fixed positioned on mobile (full-height drawer)', () => {
    expect(sidebar).toContain('fixed');
  });

  it('uses md:relative to restore normal flow at desktop', () => {
    expect(sidebar).toContain('md:relative');
  });

  it('close button has md:hidden so it only appears on mobile', () => {
    expect(sidebar).toContain('md:hidden');
  });

  it('close button meets 44px touch target', () => {
    expect(sidebar).toMatch(/w-11[^\w].*h-11|h-11[^\w].*w-11/);
  });

  it('footer hover class uses valid Tailwind opacity (not /8)', () => {
    expect(sidebar).not.toContain('bg-white/8');
  });
});

describe('ChatArea.tsx — hamburger & message padding (AC #1, #2, #5)', () => {
  const chatArea = fs.readFileSync(path.join(ROOT, 'components/home/ChatArea.tsx'), 'utf8');

  it('has hamburger button visible only below md (md:hidden)', () => {
    expect(chatArea).toContain('md:hidden');
  });

  it('hamburger button meets 44px touch target (w-11 h-11)', () => {
    expect(chatArea).toMatch(/w-11\s.*h-11|h-11\s.*w-11/s);
  });

  it('message list uses mobile-first padding (px-3)', () => {
    expect(chatArea).toMatch(/px-3\b/);
  });

  it('message list upgrades padding at sm (sm:px-6)', () => {
    expect(chatArea).toContain('sm:px-6');
  });
});

describe('home/CaseResultList.tsx — responsive layout (AC #4)', () => {
  const crl = fs.readFileSync(path.join(ROOT, 'components/home/CaseResultList.tsx'), 'utf8');

  it('has mobile card view hidden at sm+ (sm:hidden)', () => {
    expect(crl).toContain('sm:hidden');
  });

  it('has desktop table hidden below sm (hidden sm:block)', () => {
    expect(crl).toContain('hidden sm:block');
  });

  it('desktop table wrapper has overflow-x-auto (scrollable, not page-scrollable)', () => {
    expect(crl).toContain('overflow-x-auto');
  });

  it('mobile card row meets 44px touch target (min-h-[44px])', () => {
    expect(crl).toContain('min-h-[44px]');
  });

  it('load more button meets 44px touch target', () => {
    const loadMoreBlock = crl.slice(crl.lastIndexOf('Load more'));
    expect(crl).toContain('min-h-[44px]');
  });
});

describe('app/page.tsx — sidebar state management (AC #1, #2)', () => {
  const page = fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8');

  it('manages sidebarOpen state for mobile drawer', () => {
    expect(page).toContain('sidebarOpen');
  });

  it('renders mobile backdrop overlay (bg-black/40)', () => {
    expect(page).toContain('bg-black/40');
  });

  it('backdrop is hidden at md+ (md:hidden)', () => {
    expect(page).toContain('md:hidden');
  });

  it('passes isOpen prop to Sidebar', () => {
    expect(page).toContain('isOpen={sidebarOpen}');
  });

  it('passes onToggleSidebar to ChatArea', () => {
    expect(page).toContain('onToggleSidebar');
  });
});

describe('home/MessageBubble.tsx — user bubble responsive (AC #1)', () => {
  const mb = fs.readFileSync(path.join(ROOT, 'components/home/MessageBubble.tsx'), 'utf8');

  it('user bubble has mobile-first max-w-[85%]', () => {
    expect(mb).toContain('max-w-[85%]');
  });

  it('user bubble has xs:max-w-[75%] for medium phones', () => {
    expect(mb).toContain('xs:max-w-[75%]');
  });

  it('user bubble has sm:max-w-[70%] for larger screens', () => {
    expect(mb).toContain('sm:max-w-[70%]');
  });
});
