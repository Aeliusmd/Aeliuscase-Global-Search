import { describe, expect, it } from 'vitest';
import { formatIsoDate, formatTodayContext, parseDateRange } from '../lib/dateRange';

const ANCHOR = new Date('2026-06-28T12:00:00.000Z');
const TZ = 'UTC';

describe('parseDateRange', () => {
  it('resolves last month from anchor', () => {
    expect(parseDateRange('what are the cases open on last month?', ANCHOR, TZ)).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
      label: 'May 2026',
      kind: 'case',
    });
  });

  it('resolves this month from anchor', () => {
    expect(parseDateRange('cases this month', ANCHOR, TZ)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      label: 'June 2026',
      kind: 'case',
    });
  });

  it('resolves today', () => {
    expect(parseDateRange("send me today's open cases", ANCHOR, TZ)).toEqual({
      from: '2026-06-28',
      to: '2026-06-28',
      label: 'today',
      kind: 'case',
    });
  });

  it('resolves yesterday', () => {
    expect(parseDateRange("yesterday's cases", ANCHOR, TZ)).toEqual({
      from: '2026-06-27',
      to: '2026-06-27',
      label: 'yesterday',
      kind: 'case',
    });
  });

  it('resolves April 2026 month phrase', () => {
    expect(parseDateRange('what are the cases open on april month 2026', ANCHOR, TZ)).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
      label: 'April 2026',
      kind: 'case',
    });
  });

  it('resolves bare year in case context', () => {
    expect(parseDateRange('cases opened in 2024', ANCHOR, TZ)).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
      label: '2024',
      kind: 'case',
    });
  });

  it('resolves month range January to June 2025', () => {
    expect(parseDateRange('cases from January to June 2025', ANCHOR, TZ)).toEqual({
      from: '2025-01-01',
      to: '2025-06-30',
      label: 'January–June 2025',
      kind: 'case',
    });
  });

  it('resolves "last 3 months" as a trailing window', () => {
    expect(parseDateRange('cases open on last 3 months', ANCHOR, TZ)).toEqual({
      from: '2026-03-28',
      to: '2026-06-28',
      label: 'last 3 months',
      kind: 'case',
    });
  });

  it('resolves "last year" as the previous calendar year', () => {
    expect(parseDateRange('cases open on last year', ANCHOR, TZ)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      label: '2025',
      kind: 'case',
    });
  });

  it('routes "expiring next year" to the SOL date (next calendar year)', () => {
    expect(parseDateRange('what are cases expiring on next year?', ANCHOR, TZ)).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
      label: '2027',
      kind: 'sol',
    });
  });

  it('tags explicit SOL phrases as kind "sol"', () => {
    expect(parseDateRange('cases with SOL in 2027', ANCHOR, TZ)).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
      label: '2027',
      kind: 'sol',
    });
  });

  it('resolves "2027 to 2028" as a SOL year range', () => {
    expect(parseDateRange('cases expiring in yeah 2027 to 2028', ANCHOR, TZ)).toEqual({
      from: '2027-01-01',
      to: '2028-12-31',
      label: '2027–2028',
      kind: 'sol',
    });
  });

  it('resolves "2025-2026" dash-separated year range as case kind', () => {
    expect(parseDateRange('cases from 2025-2026', ANCHOR, TZ)).toEqual({
      from: '2025-01-01',
      to: '2026-12-31',
      label: '2025–2026',
      kind: 'case',
    });
  });

  it('returns null when no date phrase present', () => {
    expect(parseDateRange('most recently open case', ANCHOR, TZ)).toBeNull();
  });
});

describe('formatTodayContext', () => {
  it('formats anchor date in timezone', () => {
    expect(formatTodayContext(ANCHOR, TZ)).toEqual({
      isoDate: '2026-06-28',
      weekday: 'Sunday',
      timeZone: 'UTC',
    });
  });
});

describe('formatIsoDate', () => {
  it('zero-pads month and day', () => {
    expect(formatIsoDate(2026, 4, 5)).toBe('2026-04-05');
  });
});
