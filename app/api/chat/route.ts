import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText, tool, zodSchema } from 'ai';
import type { UIMessage } from 'ai';
import { z } from 'zod';
import type { SearchToolOutput } from '@/types/case';
import { searchCasesPaginated } from '@/lib/caseSearch';

export const maxDuration = 30;

const SEARCH_TYPE_LABELS: Record<number, string> = {
  1: 'All Cases',
  2: 'Open Cases',
  3: 'Closed Cases',
  4: 'Sub-Out Cases',
};

/**
 * Detect the intended searchType from the latest user message text.
 * Runs server-side and overrides whatever the AI chooses in the tool call.
 */
function detectSearchType(messages: UIMessage[]): number {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return 1;

  const text = (
    (lastUser.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
      ?.text ?? ''
  ).toLowerCase();

  if (/\b(open|active|current|pending|not closed)\b/.test(text)) return 2;
  if (/\b(clos(e|ed|es|ing)?|resolv(e|ed)?|settl(e|ed)?|complet(e|ed)?|done|finish(ed)?)\b/.test(text)) return 3;
  if (/\bsub[\s-]?out\b/.test(text)) return 4;
  return 1;
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

  // Detect the correct searchType from the user's latest message
  const enforcedSearchType = detectSearchType(messages);
  const enforcedLabel = SEARCH_TYPE_LABELS[enforcedSearchType];

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: `You are a smart legal case search assistant for Aeliuscase, a law firm case management platform.

You help legal staff find cases quickly and accurately.

CURRENT REQUEST FILTER (enforced server-side): ${enforcedLabel} (searchType=${enforcedSearchType})
The system has already detected the user wants ${enforcedLabel}. When calling searchCases, use searchType=${enforcedSearchType}.

searchType values for reference:
- 1 = All Cases
- 2 = Open Cases only
- 3 = Closed Cases only
- 4 = Sub-Out Cases only

RULES:
1. Greetings, thanks, or general questions → respond warmly in 1-2 sentences. Do NOT call any tool.
2. Any request to find, search, show, or look up a case → ALWAYS call searchCases immediately.
3. Use a short, relevant searchText (name, case number, or keyword). Do NOT put status words like "open" or "closed" in searchText.
4. After a tool result: give a brief 1-line summary (e.g. "Found 42 open cases.").
5. Zero results: suggest alternative search terms.
6. Keep all responses short and professional.`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      searchCases: tool({
        description:
          'Search for legal cases in the Aeliuscase system. Use for any request to find, show, or look up cases.',
        inputSchema: zodSchema(
          z.object({
            searchText: z
              .string()
              .describe('Search term: case number (e.g. RP003782), applicant name, company, or keyword. Do NOT include status words here.'),
            searchType: z
              .number()
              .int()
              .min(1)
              .max(4)
              .default(enforcedSearchType)
              .describe(`Filter: 1=All, 2=Open, 3=Closed, 4=Sub-Out. Current request requires searchType=${enforcedSearchType} (${enforcedLabel}).`),
            page: z.number().int().min(1).default(1).describe('Page number (starts at 1)'),
          }),
        ),
        execute: async (input): Promise<SearchToolOutput> => {
          const { searchText, page } = input as {
            searchText: string;
            searchType: number;
            page: number;
          };

          // Always use the server-detected type — never trust the AI's choice alone
          const searchType = enforcedSearchType;

          try {
            // Fetch the full matching set, filter by status, and return the first
            // page with exact totals so the UI shows the real count and can
            // paginate cleanly (the upstream's own paging metadata is unreliable).
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
