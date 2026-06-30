export interface DateRange {
  from: string;
  to: string;
  label: string;
  /**
   * Which date field this range targets:
   *  - 'sol'  → statute-of-limitations / expiry date (solFromDate/solToDate)
   *  - 'case' → case open date (caseFromDate/caseToDate)
   * Decided by SOL/expiry keywords in the phrase ("expiring next year" → 'sol').
   */
  kind: 'case' | 'sol';
}

export interface TodayContext {
  isoDate: string;
  weekday: string;
  timeZone: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_PATTERN =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function getLocalParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
    day: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Shift a local Y/M/D by ±delta calendar months, clamping the day to the target month. */
function shiftMonthsLocal(
  local: { year: number; month: number; day: number },
  delta: number,
): { year: number; month: number; day: number } {
  const total = local.year * 12 + (local.month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { year: y, month: m, day: Math.min(local.day, daysInMonth(y, m)) };
}

function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: formatIsoDate(year, month, 1),
    to: formatIsoDate(year, month, daysInMonth(year, month)),
  };
}

function addDaysLocal(
  anchor: Date,
  timeZone: string,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const { year, month, day } = getLocalParts(anchor, timeZone);
  const utc = Date.UTC(year, month - 1, day + deltaDays);
  return getLocalParts(new Date(utc), timeZone);
}

function monthLabel(year: number, month: number): string {
  const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return `${name} ${year}`;
}

function parseMonthToken(token: string): number | null {
  return MONTHS[token.toLowerCase()] ?? null;
}

function resolveYear(explicit: number | undefined, anchorYear: number): number {
  return explicit ?? anchorYear;
}

/** Build TODAY context for the system prompt. */
export function formatTodayContext(anchor: Date, timeZone: string): TodayContext {
  const { year, month, day } = getLocalParts(anchor, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(anchor);
  return { isoDate: formatIsoDate(year, month, day), weekday, timeZone };
}

/**
 * Parse natural-language date phrases into an inclusive ISO date range.
 * Returns null when no case-date phrase is detected or when the phrase is SOL-related.
 */
export function parseDateRange(
  text: string,
  anchor: Date,
  timeZone: string,
): DateRange | null {
  const t = text.toLowerCase();

  // SOL / expiry phrases target the statute-of-limitations date, NOT the case
  // open date — e.g. "cases expiring next year". Everything else is a case date.
  const kind: 'case' | 'sol' =
    /\bsol\b|\bstatute\s+of\s+lim|\bexpir(?:e|es|ed|ing|ation|y)?\b/.test(t) ? 'sol' : 'case';

  const local = getLocalParts(anchor, timeZone);
  const today = formatIsoDate(local.year, local.month, local.day);

  // Relative trailing window with an explicit count: "last 3 months", "past 30
  // days", "last 2 years", "last 6 weeks" → from (today − N units) … today.
  const relNum = t.match(/\b(?:last|past|previous)\s+(\d+)\s*(day|week|month|year)s?\b/);
  if (relNum) {
    const n = Number(relNum[1]);
    const unit = relNum[2];
    let from: string;
    if (unit === 'day') {
      const f = addDaysLocal(anchor, timeZone, -n);
      from = formatIsoDate(f.year, f.month, f.day);
    } else if (unit === 'week') {
      const f = addDaysLocal(anchor, timeZone, -n * 7);
      from = formatIsoDate(f.year, f.month, f.day);
    } else {
      const f = shiftMonthsLocal(local, unit === 'year' ? -n * 12 : -n);
      from = formatIsoDate(f.year, f.month, f.day);
    }
    return { from, to: today, label: `last ${n} ${unit}${n > 1 ? 's' : ''}`, kind };
  }

  // Future trailing window with an explicit count: "next 3 months", "next 30
  // days", "next 2 years" → from today … (today + N units). Natural for SOL/expiry.
  const relFut = t.match(/\bnext\s+(\d+)\s*(day|week|month|year)s?\b/);
  if (relFut) {
    const n = Number(relFut[1]);
    const unit = relFut[2];
    let to: string;
    if (unit === 'day') {
      const f = addDaysLocal(anchor, timeZone, n);
      to = formatIsoDate(f.year, f.month, f.day);
    } else if (unit === 'week') {
      const f = addDaysLocal(anchor, timeZone, n * 7);
      to = formatIsoDate(f.year, f.month, f.day);
    } else {
      const f = shiftMonthsLocal(local, unit === 'year' ? n * 12 : n);
      to = formatIsoDate(f.year, f.month, f.day);
    }
    return { from: today, to, label: `next ${n} ${unit}${n > 1 ? 's' : ''}`, kind };
  }

  // Bare relative (no number). "last year"/"next year" → that whole CALENDAR year;
  // "this year" → current year; "last/next week" → ±7 days; "next month" → next
  // calendar month. ("last month" / "this month" keep their own blocks below.)
  if (/\b(?:last|past|previous)\s+year\b/.test(t)) {
    const y = local.year - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), kind };
  }
  if (/\bnext\s+year\b/.test(t)) {
    const y = local.year + 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), kind };
  }
  if (/\bthis\s+year\b/.test(t)) {
    const y = local.year;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), kind };
  }
  if (/\b(?:last|past|previous)\s+week\b/.test(t)) {
    const f = addDaysLocal(anchor, timeZone, -7);
    return { from: formatIsoDate(f.year, f.month, f.day), to: today, label: 'last week', kind };
  }
  if (/\bnext\s+week\b/.test(t)) {
    const f = addDaysLocal(anchor, timeZone, 7);
    return { from: today, to: formatIsoDate(f.year, f.month, f.day), label: 'next week', kind };
  }
  if (/\bnext\s+month\b/.test(t)) {
    const f = shiftMonthsLocal(local, 1);
    const range = monthRange(f.year, f.month);
    return { ...range, label: monthLabel(f.year, f.month), kind };
  }

  if (/\blast\s+month\b/.test(t)) {
    let y = local.year;
    let m = local.month - 1;
    if (m < 1) { m = 12; y -= 1; }
    const range = monthRange(y, m);
    return { ...range, label: monthLabel(y, m), kind };
  }

  if (/\bthis\s+month\b/.test(t)) {
    const range = monthRange(local.year, local.month);
    return { ...range, label: monthLabel(local.year, local.month), kind };
  }

  if (/\btoday\b/.test(t)) {
    const d = formatIsoDate(local.year, local.month, local.day);
    return { from: d, to: d, label: 'today', kind };
  }

  if (/\byesterday\b/.test(t)) {
    const yd = addDaysLocal(anchor, timeZone, -1);
    const d = formatIsoDate(yd.year, yd.month, yd.day);
    return { from: d, to: d, label: 'yesterday', kind };
  }

  const rangeRe = new RegExp(
    `\\b(${MONTH_PATTERN})\\s+(?:to|through|until|-)\\s+(${MONTH_PATTERN})(?:\\s+(?:of\\s+)?(\\d{4}))?\\b`,
    'i',
  );
  const rangeMatch = t.match(rangeRe);
  if (rangeMatch) {
    const m1 = parseMonthToken(rangeMatch[1]);
    const m2 = parseMonthToken(rangeMatch[2]);
    const y = resolveYear(rangeMatch[3] ? Number(rangeMatch[3]) : undefined, local.year);
    if (m1 && m2) {
      const fromMonth = Math.min(m1, m2);
      const toMonth = Math.max(m1, m2);
      return {
        from: formatIsoDate(y, fromMonth, 1),
        to: formatIsoDate(y, toMonth, daysInMonth(y, toMonth)),
        label: `${monthLabel(y, fromMonth).split(' ')[0]}–${monthLabel(y, toMonth).split(' ')[0]} ${y}`,
        kind,
      };
    }
  }

  const monthYearRe = new RegExp(
    `\\b(${MONTH_PATTERN})(?:\\s+month)?(?:\\s+(?:of\\s+)?(\\d{4}))?\\b`,
    'i',
  );
  const monthMatch = t.match(monthYearRe);
  if (monthMatch) {
    const m = parseMonthToken(monthMatch[1]);
    if (m) {
      const y = resolveYear(monthMatch[2] ? Number(monthMatch[2]) : undefined, local.year);
      const range = monthRange(y, m);
      return { ...range, label: monthLabel(y, m), kind };
    }
  }

  const yearInContext =
    /\bcases?\s+(?:open|closed|active|pending|sub[\s-]?out\s+)?(?:in|from|during|on)\s+(20\d{2}|19\d{2})\b/i.exec(t)
    ?? /\b(?:in|from|during|on)\s+(20\d{2}|19\d{2})\s+cases?\b/i.exec(t)
    ?? /\b(20\d{2}|19\d{2})\s+cases?\b/i.exec(t)
    ?? /\b(?:opened|created|filed)\s+(?:in|on|during)\s+(20\d{2}|19\d{2})\b/i.exec(t)
    // SOL/expiry or a date connector immediately before a year: "SOL in 2027",
    // "expiring by 2027", "expires in 2027", "through 2027".
    ?? /\b(?:in|by|during|on|through|to|for)\s+(20\d{2}|19\d{2})\b/i.exec(t);

  if (yearInContext) {
    const y = Number(yearInContext[1]);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), kind };
  }

  return null;
}
