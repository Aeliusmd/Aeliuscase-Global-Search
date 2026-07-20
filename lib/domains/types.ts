import type { AiTool, ToolEntry } from '@/lib/tools/registry';
import type { IntentKey } from '@/lib/tools/intentRouter';

/**
 * Domain-Module routing (see docs/architecture/domain-routing-plan.md).
 *
 * Each resource domain (Cases, and later Tasks/Events/Documents/…) is one
 * self-describing module: it knows how to DETECT that a message belongs to it
 * (Stage 1) and which small set of tools to EXPOSE for it (Stage 2). The route
 * runs the cheap Stage-1 detector, then only the active domain's tools reach the
 * LLM — so tool count per turn stays small no matter how many domains exist.
 */

/** What a domain exposes to the model this turn — same shape the route already consumes. */
export interface DomainToolSelection {
  tools: Record<string, AiTool>;
  activeTools: string[];
  /** combinedSearch was FORCED (multi-criteria) — the model must call it, not narrate. */
  forcedCombined: boolean;
  /** Some concrete tool call is required on step 0 (a filter intent fired). */
  requireTool: boolean;
}

/**
 * Everything a domain needs to pick its tools this turn.
 *
 * NOTE (Phase A): `intents` and `selectorOpts` are Cases-specific and are still
 * precomputed by the route (date-range augmentation, person/status signals). A
 * later step can let each domain own that classification itself; for now the
 * route hands them in so behaviour is byte-for-byte unchanged.
 */
export interface DomainContext {
  message: string;
  registry: Map<string, ToolEntry>;
  intents: IntentKey[];
  selectorOpts: { explicitStatus?: boolean; hasPerson?: boolean; hasResolvedDate?: boolean; forceContinuation?: boolean };
}

export interface DomainModule {
  key: string;
  label: string;
  /** Stage-1 detector — does this message belong to this domain? */
  match: RegExp;
  /**
   * One-line plain-English description of what this domain covers, used ONLY
   * by the Stage-1.5 LLM fallback classifier (lib/domains/llmClassifier.ts) to
   * build its prompt — never shown to the end user, never affects Stage-1
   * regex matching. Falls back to `label` if omitted, so existing domains
   * work unchanged; fill in for better LLM classification accuracy.
   */
  llmHint?: string;
  /** Stage-2 — the tools (+ flags) to expose for this domain this turn. */
  selectTools(ctx: DomainContext): DomainToolSelection;
}
