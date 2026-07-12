import { selectToolsForIntents } from '@/lib/tools/selector';
import type { DomainContext, DomainModule, DomainToolSelection } from './types';

/**
 * The Cases domain — case search, filters, staff, and parties. This is the
 * original (Phase 1) behaviour, now wrapped behind the DomainModule interface so
 * future resource domains (Tasks, Events, Documents, …) slot in alongside it
 * without touching this code or each other.
 *
 * Cases is also the DEFAULT domain: detectDomains() falls back to it when nothing
 * else matches, so `match` only needs to catch obviously case-related wording —
 * anything it misses still lands here via the fallback.
 */
export const casesDomain: DomainModule = {
  key: 'cases',
  label: 'Cases',
  match: new RegExp(
    String.raw`\b(case|cases|client|applicant|claimant|attorney|paralegal|coordinator` +
      String.raw`|staff|venue|status|type|body\s*part|injur\w*|sol|statute|expir\w*` +
      String.raw`|parties|party|contacts?|documents?|find|show|search|list|open|closed)\b`,
    'i',
  ),
  selectTools(ctx: DomainContext): DomainToolSelection {
    // Stage-2 for Cases is the existing intent→tool selection, unchanged.
    return selectToolsForIntents(ctx.intents, ctx.registry, ctx.selectorOpts);
  },
};
