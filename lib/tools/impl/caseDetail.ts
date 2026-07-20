import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { CaseAccountingToolOutput, CaseActivitiesToolOutput, CaseDocumentsToolOutput, CaseEventsToolOutput, CaseFullDetailToolOutput, CaseNotesToolOutput, CaseTasksToolOutput } from '@/types/caseFullDetail';
import { fetchCaseFullDetail } from '@/lib/caseFullDetail';

export interface CaseDetailDeps {
  apiBaseUrl: string;
  jwtToken: string;
}

const caseRefSchema = z
  .object({
    caseNumber: z.string().optional().describe('Case number string, e.g. "RP003583". Prefer this over caseId/caseName.'),
    caseId: z.number().int().optional().describe('Numeric case ID. Use only when caseNumber is not known.'),
    caseName: z.string().optional().describe('Dashboard-style case name, e.g. "Elgin Perdomo vs Allied Universal". May match more than one case.'),
  })
  .refine((d) => d.caseNumber !== undefined || d.caseId !== undefined || d.caseName !== undefined, {
    message: 'Provide caseNumber, caseId, or caseName.',
  });

export function makeGetCaseFullDetailTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch full detail for ONE specific AeliusCase case — venue, injury/body parts, statute of limitations (SOL), date of injury (DOI), ADJ number, applicant/employer/insurance-carrier demographics, and case-level staff names. Call this for a single case identified by case number, case ID, or case name. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseFullDetailToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      return fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
    },
  });
}

export function makeGetCaseTasksTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the tasks/to-dos for ONE specific AeliusCase case — title, description, category, assigned staff, due date, status, priority. Call this for questions about what tasks are due, overdue, or assigned on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseTasksToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        tasks: result.data?.tasks ?? [],
      };
    },
  });
}

export function makeGetCaseEventsTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the calendar events/hearings for ONE specific AeliusCase case — title, type, date/time, location, status, notes. Call this for questions about upcoming or past hearings/events on a specific case (e.g. "when is the next hearing on RP003583"). If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseEventsToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        events: result.data?.events ?? [],
      };
    },
  });
}

export function makeGetCaseDocumentsTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the uploaded documents for ONE specific AeliusCase case — name, category, uploader, upload date, file link. Call this for questions about whether a document has been uploaded, who uploaded it, or to list documents on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseDocumentsToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        documents: result.data?.documents ?? [],
      };
    },
  });
}

export function makeGetCaseNotesTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the notes for ONE specific AeliusCase case — subject, text, category, author, date. Call this for questions like "give me all settlement notes" or "what notes mention Matrix" on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseNotesToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        notes: result.data?.notes ?? [],
      };
    },
  });
}

export function makeGetCaseActivitiesTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the activity/audit history for ONE specific AeliusCase case — description, type, who performed it, timestamp, and the related note/task/event. Call this for questions like "5 most recent activities" or "when was X sent" on a specific case. Sorted most-recent-first. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseActivitiesToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        activities: result.data?.activities ?? [],
      };
    },
  });
}

export function makeGetCaseAccountingTool(deps: CaseDetailDeps) {
  const { apiBaseUrl, jwtToken } = deps;
  return tool({
    description:
      'Fetch the financial summary for ONE specific AeliusCase case — cheque requests, payments, client costs paid, settlement fees. Call this for questions like "what cheque requests exist" or "what is the current balance" on a specific case. If the result has ambiguous:true, the caseName matched more than one case — list the candidates and ask the user which one they mean.',
    inputSchema: zodSchema(caseRefSchema),
    execute: async (input): Promise<CaseAccountingToolOutput> => {
      const { caseNumber, caseId, caseName } = input as { caseNumber?: string; caseId?: number; caseName?: string };
      const result = await fetchCaseFullDetail({ apiBaseUrl, jwtToken, caseNumber, caseId, caseName });
      if (!result.success) {
        return { success: false, ambiguous: result.ambiguous, candidates: result.candidates, error: result.error };
      }
      return {
        success: true,
        caseNumber: result.data?.caseNumber,
        caseName: result.data?.caseName,
        accounting: result.data?.accounting,
      };
    },
  });
}
