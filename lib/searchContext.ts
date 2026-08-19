/**
 * Phase-1 search wording treats an unqualified name after "cases for" as the
 * case-search keyword (normally an applicant/client), not as a staff lookup.
 * Staff searches remain explicit through role words or "handled by".
 */
export function defaultCaseSearchText(text: string): string | null {
  const match = text.match(
    /\bcases?\s+(?:for|of|belonging\s+to)\s+(.+?)(?=\s+(?:and\s+also|and|also)\b|[?!,;.]|$)/i,
  );
  if (!match?.[1]) return null;

  const value = match[1].trim().replace(/^(?:the|a|an)\s+/i, '');
  if (!value || value.split(/\s+/).length > 3) return null;
  if (/\d/.test(value)) return null;
  if (/\b(?:last|next|past|previous)\s+(?:day|week|month|year)s?\b/i.test(value)) return null;
  if (/\b(?:staff|attorney|paralegal|coordinator|handled\s+by|assigned\s+to)\b/i.test(value)) return null;
  return value;
}

/** Follow-up forms that refine the last search even without an anaphoric pronoun. */
export function isImplicitSearchRefinement(text: string): boolean {
  return /\bbased\s+on\s+(?:the\s+)?above\b/i.test(text)
    || /^\s*(?:show|find|list|get)?\s*(?:me\s+)?(?:the\s+)?(?:19|20)\d{2}\s+cases?\b/i.test(text)
    || /^\s*(?:now\s+)?(?:show\s+)?(?:the\s+)?(?:open|closed|active|completed|sub[\s-]?out)(?:\s+ones?|\s+cases?)?\s*(?:instead)?\s*[?.!]*$/i.test(text);
}

/** A new case-number/prefix keyword added to an existing result set. */
export function additiveCaseKeyword(text: string): string | null {
  if (!/\bbased\s+on\s+(?:the\s+)?above\b|\b(?:those|these)\b/i.test(text)) return null;
  const match = text.match(/\b([A-Za-z]{1,4}\d{3,})\b/);
  return match?.[1] ?? null;
}

/** Original Phase-1 wording for a general party lookup on one numbered case. */
export function whoIsOnCaseRef(text: string): string | null {
  const match = text.match(/\bwho\s+is\s+on\s+(?:the\s+)?case\s+([A-Za-z]{1,4}\d{2,})\b/i);
  return match?.[1] ?? null;
}

/** A list search and a specific-case party request combined in one message. */
export function isMixedCaseSearchAndPartyRequest(text: string): boolean {
  return defaultCaseSearchText(text) !== null
    && /\bpart(?:y|ies)|\bcontacts?\b/i.test(text)
    && /\b(?:case\s+)?[A-Za-z]{1,4}\d{2,}\b/i.test(text);
}
