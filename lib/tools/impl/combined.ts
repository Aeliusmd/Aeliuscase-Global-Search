import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { FilterToolOutput } from '@/types/caseFilters';
import { fetchStaffSearch } from '@/lib/caseFilters';
import { combinedSearch, type CombinedFilters } from '@/lib/combinedFilter';
import { resolveRoleSlot, hearingRepUnsupportedMessage } from '@/lib/roleSlots';
import { BODY_PART_UNAVAILABLE } from './filters';

import type { DateRange } from '@/lib/dateRange';

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
  /**
   * The person name extracted deterministically from the user's words. Takes
   * precedence over whatever field the model used — the model tends to drop an
   * applicant name or turn it into a last-name initial.
   */
  personName?: string | null;
  /**
   * The CombinedFilters keys the user's words actually license (derived from the
   * fired intents). The model frequently invents structured filters it was never
   * asked for — e.g. caseTypeId:1 / venueId:1 for "cases with Aditi as
   * coordinator" — and a hallucinated "1" survives the >0 guard, then WIPES the
   * result via set-intersection. We only honour a structured filter when its key
   * is in this set. Undefined ⇒ permissive (honour all — backward compatible).
   * Person fields are NOT gated here; they're governed by personSignal.
   */
  allowedFilterKeys?: Set<string>;
  /** Server-computed date range — overrides model-supplied caseFromDate/caseToDate. */
  resolvedDateRange?: DateRange | null;
  /** Server-enforced open/closed filter — overrides model status when not All. */
  enforcedSearchType?: number;
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

      // Only honour a structured filter the user actually mentioned (its intent
      // fired). Blocks the model from inventing caseTypeId/venueId/etc. that then
      // wipe the result via intersection. Undefined set ⇒ permissive.
      const allow = deps.allowedFilterKeys;
      const allowed = (key: string): boolean => !allow || allow.has(key);

      // Body-part filtering is non-functional upstream (returns 0 or all, never a
      // real filter). Refuse rather than silently wipe / inflate a combined result.
      // Only when the user actually asked for a body part (else it's a hallucination).
      if (allowed('bodyPartIds') && arr(i.bodyPartIds)) {
        return {
          success: false, filterType: 'combined', filterLabel: 'Body part filter', filterValue: '',
          cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1,
          error: BODY_PART_UNAVAILABLE,
        };
      }

      // Server-computed date range overrides the model's dates. It targets EITHER
      // the SOL fields (expiry: "cases expiring next year") or the case-open fields
      // ("cases opened last month"), decided by the parser via `kind`.
      const dr = deps.resolvedDateRange;
      const drSol = dr && dr.kind === 'sol' ? dr : null;
      const drCase = dr && dr.kind !== 'sol' ? dr : null;

      const filters: CombinedFilters = {
        caseTypeId: allowed('caseTypeId') ? num(i.caseTypeId) : undefined,
        venueId: allowed('venueId') ? num(i.venueId) : undefined,
        status: deps.enforcedSearchType && deps.enforcedSearchType !== 1
          ? deps.enforcedSearchType
          : num(i.status),
        lastNameInitial: allowed('lastNameInitial') ? str(i.lastNameInitial) : undefined,
        solFromDate: allowed('solFromDate') ? (drSol?.from ?? str(i.solFromDate)) : undefined,
        solToDate: allowed('solToDate') ? (drSol?.to ?? str(i.solToDate)) : undefined,
        caseFromDate: allowed('caseFromDate') ? (drCase?.from ?? str(i.caseFromDate)) : undefined,
        caseToDate: allowed('caseToDate') ? (drCase?.to ?? str(i.caseToDate)) : undefined,
        specialInstructions: allowed('specialInstructions') ? str(i.specialInstructions) : undefined,
        caseSubTypeId: allowed('caseSubTypeId') ? num(i.caseSubTypeId) : undefined,
        caseSubStatusId: allowed('caseSubStatusId') ? num(i.caseSubStatusId) : undefined,
        caseSubStatusId2: allowed('caseSubStatusId2') ? num(i.caseSubStatusId2) : undefined,
        subOutFilter: str(i.subOutFilter),
      };

      const fail = (error: string, label = 'Combined search'): FilterToolOutput => ({
        success: false, filterType: 'combined', filterLabel: label, filterValue: '',
        cases: [], totalRecords: 0, totalPages: 0, hasMorePages: false, page: 1, error,
      });

      // ── Person routing (deterministic) ──────────────────────────────────────
      // Prefer the name extracted from the user's WORDS (deps.personName) over
      // whatever field the model used — the model drops applicant names or maps
      // them to a last-name initial. The user's words also decide staff vs client,
      // so a bare name is never silently assumed to be staff.
      const personName = (deps.personName && deps.personName.trim()) || staffName || applicantName;
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
          // The model often misroutes the applicant name to a last-name initial
          // (e.g. "applicant Smith" → lastNameInitial "S"). Drop it when it's just
          // this name's first letter so it doesn't over-narrow the result.
          if (filters.lastNameInitial &&
              filters.lastNameInitial.trim().charAt(0).toUpperCase() === personName.trim().charAt(0).toUpperCase()) {
            filters.lastNameInitial = undefined;
          }
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
