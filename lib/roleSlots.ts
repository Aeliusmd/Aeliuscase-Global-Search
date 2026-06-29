/**
 * Case staff-assignment SLOTS for the `jobRole` filter on GetCaseListByStaffId.
 *
 * A case assigns people to slots (Attorney, Supervisor Attorney, Paralegal,
 * Coordinator, Other Attorney, Other Staff, Hearing Rep). Passing `jobRole`
 * returns only the cases where the person holds THAT slot.
 *
 * ⚠️ CRITICAL: the upstream endpoint SILENTLY returns ALL of a person's cases
 * when given an UNRECOGNISED jobRole string (no error). So we must ONLY ever send
 * a string that is verified to filter. The strings below are the exact values the
 * UAT API recognises — live-verified (a recognised string correctly returns 0
 * when the person is not in that slot):
 *
 *   Attorney            → e.g. Raj 2714, Rita 0
 *   Supervisor Attorney → e.g. Raj 280,  Rita 23   (user often says "Sup Attorney")
 *   Paralegal           → e.g. Raj 4,    Rita 1
 *   Coordinator         → e.g. Raj 18,   Rita 13
 *   Other Attorney      → e.g. Raj 3,    Rita 0
 *   Other Staff         → e.g. Raj 4,    Rita 6
 *   Hearing Rep         → UNKNOWN api string — NOT yet filterable (pending backend)
 */

export type RoleSlotResolution =
  | { kind: 'slot'; jobRole: string; label: string }   // send jobRole to the API
  | { kind: 'unsupported'; label: string }             // known slot, API string unknown (Hearing Rep)
  | null;                                               // no role named / not a slot

// Ordered MOST-SPECIFIC first: "Supervisor Attorney" / "Other Attorney" must be
// tested before the plain "Attorney" fallback because they all contain "attorney".
const MATCHERS: { re: RegExp; jobRole?: string; label: string; unsupported?: boolean }[] = [
  { re: /\bother\s*attorney\b/i,                                                jobRole: 'Other Attorney',      label: 'Other Attorney' },
  { re: /\bother\s*staff\b/i,                                                   jobRole: 'Other Staff',         label: 'Other Staff' },
  { re: /\b(?:sup\.?\s*attorney|supervis(?:or|ing)\s*attorney|supervisor)\b/i,  jobRole: 'Supervisor Attorney', label: 'Supervisor Attorney' },
  { re: /\bhearing\s*rep(?:resentative)?\b/i,                                   label: 'Hearing Rep', unsupported: true },
  { re: /\b(?:case\s*)?coordinator\b/i,                                         jobRole: 'Coordinator',         label: 'Coordinator' },
  { re: /\bparalegal\b/i,                                                       jobRole: 'Paralegal',           label: 'Paralegal' },
  { re: /\b(?:main\s+|lead\s+)?attorney\b|\batty\b/i,                           jobRole: 'Attorney',            label: 'Attorney' },
];

/** The friendly labels of every slot, for help/clarification messages. */
export const ROLE_SLOT_LABELS = [
  'Attorney', 'Supervisor Attorney', 'Paralegal', 'Coordinator', 'Other Attorney', 'Other Staff',
] as const;

/**
 * Map a free-text role hint (whatever the user typed) to a VERIFIED slot string,
 * a known-but-unsupported slot (Hearing Rep), or null when no role is named.
 * Never returns an un-verified string — that would trigger the silent-all bug.
 */
export function resolveRoleSlot(text: string | undefined | null): RoleSlotResolution {
  if (!text || !text.trim()) return null;
  for (const m of MATCHERS) {
    if (m.re.test(text)) {
      return m.unsupported
        ? { kind: 'unsupported', label: m.label }
        : { kind: 'slot', jobRole: m.jobRole!, label: m.label };
    }
  }
  return null;
}

/** The message shown when a user asks for the not-yet-supported Hearing Rep slot. */
export function hearingRepUnsupportedMessage(personLabel: string): string {
  return `Filtering by the "Hearing Rep" role isn't available yet — the backend hasn't confirmed its role code. Would you like all of ${personLabel}'s cases instead, or a different role (Attorney, Supervisor Attorney, Paralegal, Coordinator, Other Attorney, Other Staff)?`;
}
