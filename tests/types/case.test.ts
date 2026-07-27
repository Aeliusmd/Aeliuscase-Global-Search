import { describe, it, expect } from 'vitest';
import { MainSearchType } from '@/types/case';

describe('MainSearchType enum', () => {
  it('has correct numeric values', () => {
    expect(MainSearchType.AllCases).toBe(1);
    expect(MainSearchType.OpenCases).toBe(2);
    expect(MainSearchType.ClosedCases).toBe(3);
    expect(MainSearchType.SubOutCases).toBe(4);
  });

  it('has exactly 4 members', () => {
    const values = Object.values(MainSearchType).filter((v) => typeof v === 'number');
    expect(values).toHaveLength(4);
  });
});
