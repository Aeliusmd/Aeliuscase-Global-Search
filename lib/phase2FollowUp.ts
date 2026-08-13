import type { UIMessage } from 'ai';

const PHASE2_TOOL_TYPES = new Set([
  'tool-getCaseFullDetail', 'tool-getCaseTasks', 'tool-getCaseEvents',
  'tool-getCaseDocuments', 'tool-getCaseNotes', 'tool-getCaseActivities', 'tool-getCaseAccounting',
]);

export type Phase2ToolName = 'getCaseFullDetail' | 'getCaseTasks' | 'getCaseEvents'
  | 'getCaseDocuments' | 'getCaseNotes' | 'getCaseActivities' | 'getCaseAccounting';

export function isVerificationFollowUp(text: string): boolean {
  return /^\s*(?:are\s+you\s+sure|you\s+sure|can\s+you\s+(?:confirm|verify)(?:\s+that)?|(?:please\s+)?(?:confirm|verify)(?:\s+that)?)\s*[?.!]*\s*$/i.test(text);
}

/** Recover both halves of the most recent Phase-2 lookup. Confirmation turns
 * such as "Are you sure?" name neither the domain nor the case, so recovering
 * only the case reference is insufficient to re-run the authoritative tool. */
export function lastPhase2ToolContext(messages: UIMessage[]): { toolName: Phase2ToolName; caseRef: string } | null {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;
    for (const part of [...(msg.parts ?? [])].reverse() as {
      type: string;
      input?: { caseNumber?: string; caseName?: string };
      output?: { caseNumber?: string; caseName?: string; data?: { caseNumber?: string; caseName?: string } };
    }[]) {
      if (!PHASE2_TOOL_TYPES.has(part.type)) continue;
      const caseRef = part.output?.data?.caseNumber ?? part.output?.data?.caseName
        ?? part.output?.caseNumber ?? part.output?.caseName
        ?? part.input?.caseNumber ?? part.input?.caseName;
      if (caseRef) return { toolName: part.type.slice(5) as Phase2ToolName, caseRef };
    }
  }
  return null;
}
