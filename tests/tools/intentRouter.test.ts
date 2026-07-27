import { describe, it, expect } from 'vitest';
import { classifyIntents } from '@/lib/tools/intentRouter';

// Regression tests for the case_parties fix (2026-07-19, QA round 2): the
// field-lookup half of this rule used to require the field word to sit
// DIRECTLY adjacent to "on/for/assigned to" + a case-NUMBER token, which
// missed (a) the "insurance company" synonym and (b) any case-NAME reference
// or non-adjacent phrasing. Rewritten to the same "topic word + case-reference
// anywhere in the message" style already used across lib/domains/*.ts.
describe('classifyIntents — case_parties', () => {
  it('recognizes "insurance company" as a synonym for "insurance carrier"', () => {
    expect(classifyIntents('who do we call for the insurance company on RP003583')).toContain('case_parties');
  });

  it('still recognizes the original "insurance carrier" phrase', () => {
    expect(classifyIntents('who is the insurance carrier for RP003583')).toContain('case_parties');
  });

  it('recognizes a field lookup against a case NAME reference ("X vs Y"), not just a case number', () => {
    expect(classifyIntents('please tell me who the attorney is for the Smith vs Wallmart matter')).toContain('case_parties');
  });

  it('recognizes non-adjacent phrasing (words between the field word and "on/for")', () => {
    expect(classifyIntents('who is the attorney representing the applicant on case RP2476')).toContain('case_parties');
  });

  it('still recognizes the original adjacent-token phrasing', () => {
    expect(classifyIntents('venue for case RP2010')).toContain('case_parties');
    expect(classifyIntents('attorney on RP2476')).toContain('case_parties');
  });

  it('does NOT fire for a pure staff list-filter query with no case reference (no over-broadening)', () => {
    expect(classifyIntents('cases handled by attorney Raj')).not.toContain('case_parties');
  });

  it('does NOT fire for a plain case-type filter query mentioning "employer" with no case reference', () => {
    expect(classifyIntents('open cases for employer Acme Corp')).not.toContain('case_parties');
  });
});
