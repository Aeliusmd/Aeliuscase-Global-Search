import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { DomainModule } from './types';

/**
 * Stage-1.5 LLM fallback for domain detection — same shape as the existing
 * isRefinement/isRefinementLLM pair in app/api/chat/route.ts (regex fast path
 * first, LLM only when regex didn't fully decide). This ONLY classifies which
 * domain(s) a message belongs to — it never calls a tool itself and never
 * touches streamText's actual function-calling. The primary gpt-4o-mini chat
 * call still makes 100% of the real tool-selection/argument-extraction
 * decisions; this only decides which tool MENU reaches that call. See
 * lib/domains/index.ts's resolveDomains() doc comment for when this fires.
 *
 * `domains` is passed in (not imported from ./index) to avoid a circular
 * import — index.ts imports this module, so this module cannot import back.
 */
export async function classifyDomainsLLM(message: string, domains: DomainModule[]): Promise<string[]> {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      system: `You classify ONE chat message sent to a legal case-management chatbot into zero or more of these categories:
${domains.map((d) => `- ${d.key}: ${d.llmHint ?? d.label}`).join('\n')}
Reply with a comma-separated list of matching category keys (e.g. "tasks,events"), or exactly NONE if it's a general case search that fits none of these. No explanation, no other text.`,
      prompt: message,
      temperature: 0,
      maxOutputTokens: 32,
    });
    // Never trust the LLM's output blindly — filter to real keys, same
    // discipline as isRefinementLLM's permissive-regex parse of its reply.
    return text.split(',').map((s) => s.trim()).filter((k) => domains.some((d) => d.key === k));
  } catch (err) {
    console.error('[domains] classifyDomainsLLM failed, defaulting to no matches:', err);
    return [];
  }
}
