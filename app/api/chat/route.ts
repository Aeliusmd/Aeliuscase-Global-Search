import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText, tool, zodSchema } from 'ai';
import type { UIMessage } from 'ai';
import { z } from 'zod';
import OpenAI from 'openai';
import type { SearchToolOutput } from '@/types/case';
import { searchCasesPaginated } from '@/lib/caseSearch';

export const maxDuration = 30;

// How many recent turns the AI sees. Each "turn" = one UIMessage (user or assistant).
// Keeping this small reduces token cost while still giving the model enough context
// to stack filters (e.g. open → open+Maria → open+Maria+2024).
const CONTEXT_WINDOW = 4;

const SEARCH_TYPE_LABELS: Record<number, string> = {
  1: 'All Cases',
  2: 'Open Cases',
  3: 'Closed Cases',
  4: 'Sub-Out Cases',
};

type ToolPart = {
  type: string;
  output?: { searchType?: number; searchText?: string; totalRecords?: number };
};

/**
 * Detect the intended searchType.
 *
 * Priority:
 * 1. Explicit status keyword in the CURRENT user message (always wins).
 * 2. searchType carried forward from the most recent tool result in history
 *    — so "Maria ge cases ewanna" after "open cases" stays as Open.
 * 3. Default: 1 (All Cases).
 */
function detectSearchType(messages: UIMessage[]): number {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return 1;

  const text = (
    (lastUser.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
      ?.text ?? ''
  ).toLowerCase();

  // 1 — explicit override in the current message
  if (/\b(open|active|current|pending|not closed)\b/.test(text)) return 2;
  if (/\b(clos(e|ed|es|ing)?|resolv(e|ed)?|settl(e|ed)?|complet(e|ed)?|done|finish(ed)?)\b/.test(text)) return 3;
  if (/\bsub[\s-]?out\b|\bsub[\s-]?d[\s-]?in\b|\bsubbed[\s-]?in\b|\bsub'd\s?in\b/.test(text)) return 4;

  // 2 — carry forward the most recent tool result's searchType
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as ToolPart[]) {
      if (part.type === 'tool-searchCases' && part.output?.searchType) {
        const t = part.output.searchType;
        if (t >= 1 && t <= 4) return t;
      }
    }
  }

  return 1;
}

/**
 * Extract the most recent successful search context from message history so we
 * can inject it into the system prompt. Gives the AI explicit knowledge of what
 * was last searched even when history is trimmed to CONTEXT_WINDOW messages.
 */
function getLastSearchContext(messages: UIMessage[]): string {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of (msg.parts ?? []) as ToolPart[]) {
      if (part.type === 'tool-searchCases' && part.output?.searchType) {
        const { searchType, searchText, totalRecords } = part.output;
        const label = SEARCH_TYPE_LABELS[searchType ?? 1] ?? 'All Cases';
        const term = searchText ? ` | keyword: "${searchText}"` : ' | keyword: (none — all)';
        const count = totalRecords !== undefined ? ` | found: ${totalRecords}` : '';
        return `${label}${term}${count}`;
      }
    }
  }
  return 'none';
}

/**
 * Search the OpenAI Vector Store for User Guide chunks relevant to the user's message.
 * Returns the top chunks joined as plain text, or an empty string if unavailable.
 */
async function fetchGuideContext(userMessage: string): Promise<string> {
  const vsId = process.env.OPENAI_VECTOR_STORE_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!vsId || !apiKey || !userMessage.trim()) return '';

  try {
    const client = new OpenAI({ apiKey });
    const page = await client.vectorStores.search(vsId, {
      query: userMessage,
      max_num_results: 5,
    });

    const chunks = page.data
      .filter((r) => r.score > 0.25)
      .flatMap((r) => r.content)
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n');

    return chunks;
  } catch {
    return '';
  }
}

export async function POST(req: Request) {
  const jwtToken = process.env.JWT_TOKEN;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!jwtToken || !apiBaseUrl) {
    return Response.json(
      { error: 'Server configuration error: JWT_TOKEN or API_BASE_URL is not set.' },
      { status: 500 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: 'OPENAI_API_KEY is not configured.', isConfigError: true },
      { status: 500 },
    );
  }

  const { messages } = (await req.json()) as { messages: UIMessage[] };

  // Detect searchType scanning the FULL history (so carry-forward works even
  // when older messages are outside the context window).
  const enforcedSearchType = detectSearchType(messages);
  const enforcedLabel = SEARCH_TYPE_LABELS[enforcedSearchType];

  // Last search context injected into the system prompt so the AI knows the
  // active filter even if that tool result is outside the trimmed window.
  const lastSearchContext = getLastSearchContext(messages);

  // Only send the last CONTEXT_WINDOW messages to the model — trims token cost
  // while preserving enough turns for multi-step filter refinement.
  const contextMessages = messages.slice(-CONTEXT_WINDOW);

  // Fetch User Guide context in parallel with message preparation.
  const lastUserText = (
    [...messages].reverse().find((m) => m.role === 'user')?.parts
      ?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined
  )?.text ?? '';

  const [guideContext, modelMessages] = await Promise.all([
    fetchGuideContext(lastUserText),
    convertToModelMessages(contextMessages),
  ]);

  const guideSection = guideContext
    ? `━━━ AELIUSCASE USER GUIDE — RELEVANT EXCERPTS ━━━
Use the following excerpts to answer questions about AeliusCase features, procedures, and usage.

${guideContext}
━━━ END OF GUIDE EXCERPTS ━━━`
    : '';

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: `You are a smart assistant for Aeliuscase, a law firm case management platform.
You help with two things only:
  A) Searching cases in the database → use the searchCases tool.
  B) Answering questions about AeliusCase features and usage → use the User Guide excerpts below.

${guideSection}

━━━ HOW TO RESPOND ━━━
• Case search (find/show/look up cases) → call searchCases immediately. Never skip this.
• "What is AeliusCase", "how do I…", "what does X do", feature questions → answer from the User Guide excerpts above. Be helpful and specific. If the exact detail isn't in the excerpts, say you don't have that specific information from the guide.
• Greetings → reply warmly in 1-2 sentences.
• Questions completely unrelated to AeliusCase (world events, cooking, etc.) → reply: "I can only help with AeliusCase case searches and User Guide questions."
• After a tool result → ONE short sentence only (e.g. "Found 12 open cases for Maria.").
  NEVER list case numbers, names, employers, or any case details in text — the UI renders them automatically.
  Do NOT repeat or describe what is already shown in the result cards.
• Zero results → one sentence: suggest a broader or alternative search term.

Do NOT answer general knowledge questions about the world, technology trends, or anything outside AeliusCase.

LAST SEARCH IN THIS SESSION: ${lastSearchContext}
CURRENT ENFORCED FILTER (server-side): ${enforcedLabel} (searchType=${enforcedSearchType})

━━━ HOW TO BUILD SEARCH QUERIES ━━━
Always look at the conversation history AND the LAST SEARCH context above to build
the most specific searchText possible. Stack filters progressively:

  Step 1 — User asks for open cases
           → searchType=2, searchText="" (all open)

  Step 2 — User says "show Maria's cases"
           → searchType=2 (still open, carried forward), searchText="Maria"

  Step 3 — User says "cases in 2024"
           → searchType=2 (still open), searchText="Maria 2024"

  Step 4 — User says "now show closed" / "filter only open" / "sub-d in cases"
           → ONLY the searchType changes. searchText="Maria 2024" carries forward unchanged.
           → This is a STATUS-ONLY filter. Do NOT clear or change searchText.

  Step 5 — User says "based on above cases only send me RP0036 cases"
    (or: "from the above", "from those results", "from what you showed", "filter from these",
         "within those", "of those cases", "narrow down to", "from those")
           → ALWAYS additive. APPEND new keyword to existing searchText.
           → searchType=2 (unchanged), searchText="Maria RP0036"
           → NEVER reset to just "RP0036" alone when a back-reference phrase is used.

Rules for searchText:
- When the user ONLY changes the status filter (open/closed/sub-out/sub-d in/all),
  keep the EXACT same searchText from the last search — do not add or remove anything.
- COMBINE the keyword from the last search with any NEW name/number/keyword the user adds.
- ADDITIVE TRIGGER PHRASES — if the user message contains any of these, ALWAYS append
  the new keyword to the existing searchText, NEVER replace it:
  "based on above", "from the above", "from those results", "from what you showed",
  "filter from", "from those cases", "narrow down", "within those", "of those", "from above".
- Topic replacement ONLY when the user starts a completely new search with NO back-reference
  phrase (e.g. "actually find John Smith instead", "forget that, search RP9999").
- For date hints: append the year or month as a keyword (e.g. "Maria 2024", "RP2292 Jan").
- NEVER include status words ("open", "closed", "sub-out") in searchText — status is in searchType.
- Keep searchText SHORT — name, case number, or keyword only.

searchType values:
- 1 = All Cases  2 = Open only  3 = Closed only  4 = Sub-Out only  ("Sub-d In" = Sub-Out = 4)`,
    messages: modelMessages,
    stopWhen: stepCountIs(5),
    tools: {
      searchCases: tool({
        description:
          'Search for legal cases in the Aeliuscase system. Always call this for any find/show/lookup request.',
        inputSchema: zodSchema(
          z.object({
            searchText: z
              .string()
              .describe(
                'Accumulated search term combining prior keyword + new refinement. E.g. if last search was "Maria" and user now says "2024", use "Maria 2024". No status words.',
              ),
            searchType: z
              .number()
              .int()
              .min(1)
              .max(4)
              .default(enforcedSearchType)
              .describe(
                `Status filter — server enforces ${enforcedSearchType} (${enforcedLabel}). Only change if the user explicitly switches status.`,
              ),
            page: z.number().int().min(1).default(1).describe('Page number (starts at 1)'),
          }),
        ),
        execute: async (input): Promise<SearchToolOutput> => {
          const { searchText, page } = input as {
            searchText: string;
            searchType: number;
            page: number;
          };

          // Server always enforces the detected type — model cannot override it.
          const searchType = enforcedSearchType;

          try {
            const result = await searchCasesPaginated({
              apiBaseUrl,
              jwtToken,
              searchText,
              searchType,
              page: page || 1,
            });

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Search failed',
                cases: [],
                totalRecords: 0,
                totalPages: 0,
                hasMorePages: false,
                page: 1,
                searchText,
                searchType,
              };
            }

            return {
              success: true,
              cases: result.cases,
              totalRecords: result.totalRecords,
              totalPages: result.totalPages,
              hasMorePages: result.hasMorePages,
              page: result.page,
              searchText,
              searchType,
            };
          } catch {
            return {
              success: false,
              error: 'Could not connect to case database.',
              cases: [],
              totalRecords: 0,
              totalPages: 0,
              hasMorePages: false,
              page: 1,
              searchText,
              searchType,
            };
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
