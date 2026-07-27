import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(vi.fn((name: string) => name), { chat: vi.fn((name: string) => name) }),
}));

import { generateText } from 'ai';
import { classifyDomainsLLM } from '@/lib/domains/llmClassifier';
import type { DomainModule } from '@/lib/domains/types';

function stubDomain(key: string, llmHint?: string): DomainModule {
  return {
    key,
    label: key,
    llmHint,
    match: /never-matches-anything-xyz/,
    selectTools: () => ({ tools: {}, activeTools: [], forcedCombined: false, requireTool: false }),
  };
}

const DOMAINS = [
  stubDomain('cases', 'general case search'),
  stubDomain('tasks', 'case tasks/to-dos'),
  stubDomain('events', 'calendar events/hearings'),
  stubDomain('activities', 'activity/audit history'),
];

describe('classifyDomainsLLM', () => {
  beforeEach(() => {
    vi.mocked(generateText).mockClear();
  });

  it('returns the matching keys from a comma-separated reply', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'tasks, events' } as never);
    const keys = await classifyDomainsLLM('some message', DOMAINS);
    expect(keys).toEqual(['tasks', 'events']);
  });

  it('returns a single key from a single-word reply', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'activities' } as never);
    const keys = await classifyDomainsLLM('when was the demographics sent on case RP003668', DOMAINS);
    expect(keys).toEqual(['activities']);
  });

  it('returns an empty array for "NONE"', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'NONE' } as never);
    const keys = await classifyDomainsLLM('find cases for Maria', DOMAINS);
    expect(keys).toEqual([]);
  });

  it('filters out hallucinated/invalid keys not in the domain list', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'tasks, madeUpDomain, events' } as never);
    const keys = await classifyDomainsLLM('some message', DOMAINS);
    expect(keys).toEqual(['tasks', 'events']);
  });

  it('defaults to an empty array on LLM failure (never throws)', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('network error'));
    const keys = await classifyDomainsLLM('some message', DOMAINS);
    expect(keys).toEqual([]);
  });

  it('builds the classification prompt dynamically from the domain list (uses llmHint, falls back to label)', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'NONE' } as never);
    await classifyDomainsLLM('some message', DOMAINS);
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('tasks: case tasks/to-dos');
    expect(callArgs.system).toContain('events: calendar events/hearings');
  });

  it('falls back to label when llmHint is not set on a domain', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ text: 'NONE' } as never);
    const domainsNoHint = [stubDomain('documents')]; // no llmHint passed
    await classifyDomainsLLM('some message', domainsNoHint);
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as { system: string };
    expect(callArgs.system).toContain('documents: documents');
  });
});
