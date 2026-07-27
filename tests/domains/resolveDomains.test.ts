import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/domains/llmClassifier', () => ({
  classifyDomainsLLM: vi.fn(),
}));

import { classifyDomainsLLM } from '@/lib/domains/llmClassifier';
import { resolveDomains, DOMAINS } from '@/lib/domains';

beforeEach(() => {
  vi.mocked(classifyDomainsLLM).mockReset();
});

describe('resolveDomains — always double-checks via the LLM classifier', () => {
  // Changed 2026-07-27: the old "only call the LLM when a heuristic guesses a
  // gap exists" design meant every regex miss this session ALSO had to be a
  // heuristic miss to ever get noticed (e.g. "demographics sent" matched
  // casesDomain via the bare word "case", so even the zero-hits gate never
  // considered double-checking it). Calling the classifier unconditionally
  // removes that whole failure mode — merge-only semantics (see resolveDomains'
  // doc comment) make it safe to always ask.
  beforeEach(() => {
    vi.mocked(classifyDomainsLLM).mockResolvedValue([]);
  });

  it('calls the LLM classifier even when a short, simple message matches a specific domain via regex', async () => {
    const domains = await resolveDomains('what tasks are due on case RP003583');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(classifyDomainsLLM).toHaveBeenCalledWith('what tasks are due on case RP003583', DOMAINS);
  });

  it('calls the LLM classifier for a short, plain Cases query with no case reference', async () => {
    const domains = await resolveDomains('find cases for Maria');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });

  it('calls the LLM classifier for a short single-topic domain query', async () => {
    await resolveDomains('show me the notes on RP003583');
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });

  it('still merges in whatever the LLM finds even when regex already matched cleanly', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce(['activities']);
    const domains = await resolveDomains('what tasks are due on case RP003583');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(domains.some((d) => d.key === 'activities')).toBe(true);
  });
});

describe('resolveDomains — no Phase-2 domain matched but message references a case', () => {
  // NOTE: the ORIGINAL Section 6 example ("when was the demographics sent on
  // case RP003668") turned out, while writing this test, to match
  // caseDetailDomain directly via its own "demographics?" trigger word — a
  // WRONG-domain-match case, not a no-match case. That specific collision has
  // since been FIXED directly (activitiesDomain now also triggers on
  // "demographics"/"sent" — see lib/domains/activities.ts and
  // tests/domains/phase2-routing.test.ts's regression test for it). This test
  // uses a message with genuinely zero Phase-2 domain matches instead, to
  // verify the missed-domain LLM-recovery path this feature covers.
  const msg = 'who touched this case most recently';

  it('recovers via the LLM path when only casesDomain matched (bare "case" word) but a Phase-2 topic was meant', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce(['activities']);
    const domains = await resolveDomains(msg);
    expect(domains.some((d) => d.key === 'activities')).toBe(true);
    expect(classifyDomainsLLM).toHaveBeenCalledWith(msg, DOMAINS);
  });

  it('keeps casesDomain\'s own match too if the LLM does not find anything to add', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce([]);
    const domains = await resolveDomains(msg);
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
  });
});

describe('resolveDomains — zero regex hits at all (not even casesDomain)', () => {
  it('falls back to [casesDomain] when the LLM also finds nothing', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce([]);
    const domains = await resolveDomains('xyzzy plugh qwerty');
    expect(domains).toEqual([expect.objectContaining({ key: 'cases' })]);
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });

  it('falls back to [casesDomain] when the LLM call itself rejects (defensive — should never throw)', async () => {
    vi.mocked(classifyDomainsLLM).mockRejectedValueOnce(new Error('boom'));
    const domains = await resolveDomains('xyzzy plugh qwerty');
    expect(domains).toEqual([expect.objectContaining({ key: 'cases' })]);
  });
});

describe('resolveDomains — multi-topic messages merge, never replace, when a Phase-2 domain already matched', () => {
  // "who touched this case" deliberately does NOT contain any Phase-2
  // domain's own trigger words (not "activity"/"audit"/"history"/"sent") — a
  // genuine regex miss for the second topic. (An earlier version of this test
  // used "sent to the adjuster", but activitiesDomain's regex was extended to
  // include "sent" directly — see lib/domains/activities.ts — so that phrase
  // now matches via regex alone and no longer exercises the LLM merge path.)
  const complexMsg = 'what tasks are due and who touched this case most recently, on RP003583, and are there other things I should know';

  it('merges a domain the LLM found into the existing regex hit for a long/complex message', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce(['activities']);
    const domains = await resolveDomains(complexMsg);
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(domains.some((d) => d.key === 'activities')).toBe(true);
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });

  it('does not drop the regex hit if the LLM double-check rejects', async () => {
    vi.mocked(classifyDomainsLLM).mockRejectedValueOnce(new Error('boom'));
    const domains = await resolveDomains(complexMsg);
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
  });

  it('double-checks a short message with multiple case-reference tokens', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce([]);
    await resolveDomains('compare tasks on RP003583 RP2134');
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });
});
