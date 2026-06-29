import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { FilterToolOutput } from '@/types/caseFilters';
import { fetchStaffSearch } from '@/lib/caseFilters';
import { combinedSearch, type CombinedFilters } from '@/lib/combinedFilter';
import { resolveRoleSlot, hearingRepUnsupportedMessage } from '@/lib/roleSlots';

export interface CombinedDeps {
  apiBaseUrl: string;
  jwtToken: string;
  /**
   * Whether the user's words identify the person as STAFF (a role word / "handled
   * by") or an APPLICANT/CLIENT, or give NO signal. Computed deterministically in
   * the route from the message — it governs name routing so a bare name can never
   * be silently assumed to be staff.
   */
  personSignal: 'staff' | 'applicant' | 'none';
}

/**
 * Combined (AND) filtering across multiple criteria in one query — the chatbot
 * equivalent of the full "Search Kases" form. Any subset of fields may be set;
 * a case is returned only if it matches ALL supplied filters. If a staff NAME
 * is given it is resolved to a staffId first (with disambiguation).
 */
export function makeCombinedSearchTool(deps: CombinedDeps) {
  return tool({
    description:
      'Search cases by MULTIPLE filters combined together (AND) in one request — e.g. "Open WCAB cases for Attorney Raj in Venue 5", "Personal Injury cases opened in 2024 with last name D", "WCAB cases for client John Smith". Use this whenever the user gives two or more filter criteria at once, OR a single filter together with a person\'s name. Map type names to IDs (1=WCAB,2=DUI,3=Personal Injury,4=WCAB Defense,5=Class Action,6=Civil,7=Employment,8=Immigration,9=Social Security). For a person: use staffName if they are a STAFF member (attorney/paralegal/coordinator/"handled by"/"assigned to"), or applicantName if they are the APPLICANT/CLIENT (injured worker). Never set both for the same person.',
    inputSchema: zodSchema(
      z.object({
        caseTypeId: z.number().int().optional().describe('Main case type ID.'),
        venueId: z.number().int().optional(),
        staffName: z.string().optional().describe('Attorney/STAFF member name to filter by (resolved to an ID). Use for attorney/paralegal/coordinator/"handled by"/"assigned to".'),
        applicantName: z.string().optional().describe('APPLICANT/CLIENT (injured worker) name to filter by. Use when the person is the client the case is about, not a staff member.'),
        jobRole: z.string().optional().describe('Role the user named, used to disambiguate staff lookup.'),
        status: z.number().int().min(1).max(4).optional().describe('1=All, 2=Open, 3=Closed, 4=Sub-Out.'),
        lastNameInitial: z.string().optional().describe('Single A–Z letter (applicant last name).'),
        bodyPartIds: z.array(z.number().int()).optional(),
        solFromDate: z.string().optional(),
        solToDate: z.string().optional(),
        caseFromDate: z.string().optional().describe('Case (open) date range start, ISO 8601.'),
        caseToDate: z.string().optional(),
        specialInstructions: z.string().optional(),
        caseSubTypeId: z.number().int().optional(),
        caseSubStatusId: z.number().int().optional(),
        caseSubStatusId2: z.number().int().optional(),
        subOutFilter: z.string().optional().describe('"include" (default) | "exclude" | "only".'),
        page: z.number().int().min(1).default(1),
      }),
    ),
    execute: async (input): Promise<FilterToolOutput> => {
      const i = input as Record<string, unknown>;
      console.log('[combinedSearch tool] input:', JSON.stringify(i));
      const page = (i.page as number) || 1;
      const staffName = i.staffName as string | undefined;
      const jobRole = i.jobRole as string | undefined;
      const applicantName = (typeof i.applicantName === 'string' && i.applicantName.trim() !== '')
        ? (i.applicantName as string).trim()
        : undefined;

      // The model often fills unused optional fields with 0 / "" instead of
      // omitting them — treat those as "not provided" so they don't create bogus
      // (zero-result) filter specs that wipe out the intersection.
      const num = (v: unknown): number | undefined =>
        typeof v === 'number' && v > 0 ? v : undefined;
      const str = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
      const arr = (v: unknown): number[] | undefined =>
        Array.isArray(v) && v.length > 0 ? (v as number[]) : undefined;

      const filters: CombinedFilters = {
        caseTypeId: num(i.caseTypeId),
        venueId: num(i.venueId),
        status: num(i.status),
        lastNameInitial: str(i.lastNameInitial),
        bodyPartIds: arr(i.bodyPartIds),
        solFromDate: str(i.solFromDate),
        solToDate: str(i.solToDate),
        caseFromDate: str(i.caseFromDate),
        caseToDate: str(i.caseToDate),
        specialInstructions: str(i.specialInstructions),
        caseSubTypeId: num(i.caseSubTypeId),
        caseSubStatusId: num(i.caseSubStatusId),
        caseSubStatusId2: num(i.caseSubStatusId2),
        subOutFilter: str(i.subOutFilter),
      };

      const fail = (error: string, label = 'Combined search'): FilterToolOutput => ({
        success: false, filterType: 'combined', filterLabel: label, filterValue: '',
        cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
      });

      // ── Person routing (deterministic) ──────────────────────────────────────
      // The model may put the name in either field; the user's WORDS decide what
      // it actually is. This guarantees a bare name is never silently treated as
      // staff — the cause of "Maria → which Maria?" skipping the staff/client ask.
      const personName = staffName ?? applicantName;
      if (personName) {
        if (deps.personSignal === 'none') {
          // No staff/client signal in the user's words → ASK first, search nothing.
          return fail(
            `Is "${personName}" a staff member (e.g. attorney, paralegal) or an applicant/client? Let me know and I'll search the right way.`,
            `Person "${personName}"`,
          );
        }

        if (deps.personSignal === 'applicant') {
          filters.applicantName = personName;
        } else {
          // Staff — a named role here is the CASE SLOT to filter by (Attorney/
          // Paralegal/…), NOT an HR-title tie-break. Resolve it to a VERIFIED slot
          // string; an unrecognised string would make the API silently return all.
          const slot = resolveRoleSlot(jobRole);
          if (slot?.kind === 'unsupported') return fail(hearingRepUnsupportedMessage(personName), `Staff "${personName}"`);
          if (slot?.kind === 'slot') filters.staffJobRole = slot.jobRole;

          // Resolve name → staffId by NAME only. If several people match, ask.
          const lookup = await fetchStaffSearch({ apiBaseUrl: deps.apiBaseUrl, jwtToken: deps.jwtToken, searchText: personName });
          if (!lookup.success) return fail(lookup.error ?? 'Staff lookup failed.', `Staff "${personName}"`);
          if (lookup.staff.length === 0) return fail(`No staff member found matching "${personName}".`, `Staff "${personName}"`);
          if (lookup.staff.length > 1) {
            const list = lookup.staff.slice(0, 8)
              .map((s) => `${s.name}${s.jobRole ? ` (${s.jobRole})` : ''}`)
              .join('; ');
            return fail(`Multiple staff match "${personName}": ${list}. Ask the user which person they mean.`, `Staff "${personName}"`);
          }
          filters.staffId = lookup.staff[0].id;
          filters.staffName = lookup.staff[0].name;
        }
      }

      return combinedSearch(deps, filters, page);
    },
  });
}
