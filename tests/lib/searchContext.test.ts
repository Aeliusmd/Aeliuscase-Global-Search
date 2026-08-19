import { describe, expect, it } from 'vitest';
import {
  additiveCaseKeyword,
  defaultCaseSearchText,
  isImplicitSearchRefinement,
  isMixedCaseSearchAndPartyRequest,
  whoIsOnCaseRef,
} from '@/lib/searchContext';

describe('Phase-1 search conversation helpers', () => {
  it.each([
    ['find cases for John Smith', 'John Smith'],
    ['find open cases for Maria', 'Maria'],
    ['active cases for Johnson', 'Johnson'],
    ['find closed cases for Smith', 'Smith'],
    ['show open cases for Maria and also show parties for RP003613', 'Maria'],
  ])('defaults case-search wording "%s" to search text "%s"', (text, expected) => {
    expect(defaultCaseSearchText(text)).toBe(expected);
  });

  it.each([
    'cases handled by Maria',
    'cases for attorney John Smith',
    'cases for the last 4 months',
    'cases for RP003613',
  ])('does not reinterpret non-applicant wording "%s"', (text) => {
    expect(defaultCaseSearchText(text)).toBeNull();
  });

  it.each(['show 2024 cases', 'now show closed', 'based on above cases only show RP0036 cases'])
    ('recognizes implicit refinement "%s"', (text) => {
      expect(isImplicitSearchRefinement(text)).toBe(true);
    });

  it('extracts the additive case keyword from the final progressive-filter turn', () => {
    expect(additiveCaseKeyword('based on above cases only show RP0036 cases')).toBe('RP0036');
  });

  it('routes the Phase-1 general party wording by case number', () => {
    expect(whoIsOnCaseRef('who is on case RP003665')).toBe('RP003665');
  });

  it('recognizes a mixed list-search and party request', () => {
    expect(isMixedCaseSearchAndPartyRequest('show open cases for Maria and also show parties for RP003613')).toBe(true);
    expect(isMixedCaseSearchAndPartyRequest('show parties for RP003613')).toBe(false);
  });
});
