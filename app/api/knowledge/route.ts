import OpenAI from 'openai';
import type { FileSearchTool } from 'openai/resources/responses/responses';

export const maxDuration = 30;

const SYSTEM_INSTRUCTIONS = `You are a helpful assistant for AeliusCase, a law firm case management platform.
Your sole knowledge source is the AeliusCase User Guide provided to you via file search.

STRICT RULES:
1. Only answer questions using information found in the AeliusCase User Guide.
2. If a question cannot be answered from the User Guide, respond with exactly:
   "I don't have information about that in the AeliusCase User Guide. Please consult your system administrator or refer to the full documentation."
3. Do not use any prior knowledge or make assumptions beyond what the User Guide states.
4. Keep responses clear, concise, and helpful.
5. When listing steps or procedures, use numbered lists.
6. When listing features or options, use bullet points.`;

export async function POST(req: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: 'OPENAI_API_KEY is not configured.', isConfigError: true },
      { status: 500 },
    );
  }

  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  if (!vectorStoreId) {
    return Response.json(
      {
        error:
          'Knowledge base is not set up. Run "npm run setup:kb" to initialise the vector store, then add OPENAI_VECTOR_STORE_ID to .env.local.',
        isConfigError: true,
      },
      { status: 500 },
    );
  }

  let message: string;
  try {
    const body = (await req.json()) as { message?: unknown };
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return Response.json({ error: 'message must be a non-empty string.' }, { status: 400 });
    }
    message = body.message;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const fileSearchTool: FileSearchTool = {
    type: 'file_search',
    vector_store_ids: [vectorStoreId],
  };

  const stream = openai.responses.stream({
    model: 'gpt-4o-mini',
    instructions: SYSTEM_INSTRUCTIONS,
    tools: [fileSearchTool],
    input: message,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            const chunk = JSON.stringify({ text: event.delta });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
