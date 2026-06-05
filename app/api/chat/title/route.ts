import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ title: null }, { status: 500 });
  }

  const { userMessage, aiResponse } = (await req.json()) as {
    userMessage: string;
    aiResponse: string;
  };

  if (!userMessage?.trim()) {
    return Response.json({ title: null });
  }

  try {
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: `Generate a short title (3–6 words) for this legal case search chat session.

User: "${userMessage.slice(0, 200)}"
AI: "${aiResponse.slice(0, 300)}"

Rules:
- 3 to 6 words maximum
- No quotes or trailing punctuation
- Be specific and descriptive about the search topic
- Examples: Search John Smith Cases, Open Cases June 2024, Find RP003782 Status

Title:`,
    });
    return Response.json({
      title: text.trim().replace(/^["']|["']$/g, '').replace(/[.!?:]$/, ''),
    });
  } catch {
    return Response.json({ title: null });
  }
}
