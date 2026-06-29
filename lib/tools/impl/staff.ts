import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { FilterToolOutput } from '@/types/caseFilters';
import { fetchStaffSearch, fetchByStaffId } from '@/lib/caseFilters';
import { resolveRoleSlot, hearingRepUnsupportedMessage } from '@/lib/roleSlots';

export interface StaffDeps {
  apiBaseUrl: string;
  jwtToken: string;
}

/**
 * One tool, two server-side steps (kept out of the LLM loop on purpose):
 *   1. Staff/Search by name  →  resolve to a single staffId
 *   2. GetCaseListByStaffId  →  the person's cases
 *
 * Ambiguity is handled here: 0 matches → friendly error; >1 → return the
 * candidate list as an error so the model can ask the user to disambiguate.
 */
export function makeGetByStaffTool(deps: StaffDeps) {
  return tool({
    description:
      'Get cases for a staff member, looked up by NAME, optionally filtered to a CASE ROLE/SLOT. Call when the user asks for cases by a person\'s name — e.g. "cases handled by Maria", "show John\'s cases", "Raj\'s cases as paralegal", "Angels Valero\'s attorney cases". Provide the name. Pass jobRole with the EXACT role the user named when they specify a slot: Attorney, Supervisor Attorney (a.k.a. "Sup Attorney"), Paralegal, Coordinator, Other Attorney, Other Staff, or Hearing Rep. This returns only cases where the person holds THAT role. Omit jobRole when no role is named (returns all their cases).',
    inputSchema: zodSchema(
      z.object({
        name: z.string().min(1).describe('The staff member\'s name or partial name (e.g. "Angels Valero", "Maria").'),
        jobRole: z.string().optional().describe('Optional case role/slot the user named (Attorney, Supervisor Attorney, Paralegal, Coordinator, Other Attorney, Other Staff, Hearing Rep). Filters to cases where the person holds that slot.'),
        page: z.number().int().min(1).default(1),
      }),
    ),
    execute: async (input): Promise<FilterToolOutput> => {
      const { name, jobRole, page } = input as { name: string; jobRole?: string; page: number };

      const fail = (error: string): FilterToolOutput => ({
        success: false, filterType: 'staffId', filterLabel: `Staff "${name}"`, filterValue: '',
        cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
      });

      // Resolve the named role to a VERIFIED slot string (never send a raw string —
      // an unrecognised one makes the API silently return ALL cases). Hearing Rep
      // is a known slot whose API code is not yet confirmed → tell the user.
      const slot = resolveRoleSlot(jobRole);
      if (slot?.kind === 'unsupported') return fail(hearingRepUnsupportedMessage(name));
      const roleString = slot?.kind === 'slot' ? slot.jobRole : undefined;

      // Step 1 — resolve the name. Search by NAME only: the role word a user gives
      // describes the CASE slot, not the person's HR title, so it must not filter
      // the person lookup. If several people match, ask — don't guess.
      const lookup = await fetchStaffSearch({ ...deps, searchText: name });
      if (!lookup.success) return fail(lookup.error ?? 'Staff lookup failed.');

      if (lookup.staff.length === 0) {
        return fail(`No staff member found matching "${name}". Please check the name.`);
      }

      if (lookup.staff.length > 1) {
        const list = lookup.staff
          .slice(0, 8)
          .map((s) => `${s.name}${s.jobRole ? ` (${s.jobRole})` : ''}${s.status && s.status !== 'Active' ? ` [${s.status}]` : ''}`)
          .join('; ');
        return fail(`Multiple staff match "${name}": ${list}. Ask the user which person they mean (a fuller name).`);
      }

      // Step 2 — fetch that person's cases, filtered to the slot if one was named.
      const person = lookup.staff[0];
      return fetchByStaffId({
        ...deps,
        staffId: person.id,
        staffName: person.name,
        jobRole: roleString,
        page: page || 1,
      });
    },
  });
}
