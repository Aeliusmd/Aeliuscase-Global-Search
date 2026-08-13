import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { isVerificationFollowUp, lastPhase2ToolContext } from '@/lib/phase2FollowUp';

describe('Phase-2 verification follow-ups', () => {
  it('recovers the document tool and case for an "Are you sure?" turn', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'How many documents are on case AE00224?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-getCaseDocuments',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { caseNumber: 'AE00224' },
            output: { success: true, caseNumber: 'AE00224', documents: [], documentsTotal: 82 },
          },
          { type: 'text', text: 'There are 82 documents on case AE00224.' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Are you sure?' }] },
    ] as UIMessage[];

    expect(isVerificationFollowUp('Are you sure?')).toBe(true);
    expect(lastPhase2ToolContext(messages)).toEqual({
      toolName: 'getCaseDocuments',
      caseRef: 'AE00224',
    });
  });

  it('does not treat a new substantive question as a verification follow-up', () => {
    expect(isVerificationFollowUp('Are you sure which cases are open?')).toBe(false);
  });
});
