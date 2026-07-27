import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/domains/llmClassifier', () => ({
  classifyDomainsLLM: vi.fn(),
}));

import { classifyDomainsLLM } from '@/lib/domains/llmClassifier';
import { resolveDomains, DOMAINS } from '@/lib/domains';

beforeEach(() => {
  vi.mocked(classifyDomainsLLM).mockReset();
});

describe('resolveDomains — regex short-circuit (zero LLM cost for the common case)', () => {
  it('does NOT call the LLM classifier when a short, simple message matches a specific domain via regex', async () => {
    const domains = await resolveDomains('what tasks are due on case RP003583');
    expect(domains.some((d) => d.key === 'tasks')).toBe(true);
    expect(classifyDomainsLLM).not.toHaveBeenCalled();
  });

  it('does NOT call the LLM classifier for a short, plain Cases query with no case reference', async () => {
    const domains = await resolveDomains('find cases for Maria');
    expect(domains.some((d) => d.key === 'cases')).toBe(true);
    expect(classifyDomainsLLM).not.toHaveBeenCalled();
  });

  it('does NOT call the LLM classifier for a short single-topic domain query', async () => {
    await resolveDomains('show me the notes on RP003583');
    expect(classifyDomainsLLM).not.toHaveBeenCalled();
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

describe('resolveDomains — looksComplex double-check when a Phase-2 domain already matched (merge, never replace)', () => {
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

  it('double-checks a short message with multiple case-reference tokens even without a conjunction', async () => {
    vi.mocked(classifyDomainsLLM).mockResolvedValueOnce([]);
    await resolveDomains('compare tasks on RP003583 RP2134');
    expect(classifyDomainsLLM).toHaveBeenCalled();
  });
});
