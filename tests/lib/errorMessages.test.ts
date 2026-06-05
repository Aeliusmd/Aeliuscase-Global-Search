import { describe, it, expect } from 'vitest';
import {
  ERR_JWT_EXPIRED,
  ERR_NETWORK,
  ERR_API,
  ERR_CONFIG,
  emptyResultsMessage,
} from '@/lib/errorMessages';

describe('error message constants', () => {
  it('ERR_JWT_EXPIRED is non-empty', () => {
    expect(ERR_JWT_EXPIRED).toBeTruthy();
    expect(ERR_JWT_EXPIRED).toContain('JWT_TOKEN');
  });

  it('ERR_NETWORK mentions network', () => {
    expect(ERR_NETWORK.toLowerCase()).toContain('network');
  });

  it('ERR_API is non-empty string', () => {
    expect(typeof ERR_API).toBe('string');
    expect(ERR_API.length).toBeGreaterThan(0);
  });

  it('ERR_CONFIG mentions administrator or configuration', () => {
    const lower = ERR_CONFIG.toLowerCase();
    expect(lower.includes('config') || lower.includes('administrator')).toBe(true);
  });
});

describe('emptyResultsMessage', () => {
  it('includes the query in the message', () => {
    const msg = emptyResultsMessage('John Doe');
    expect(msg).toContain('John Doe');
  });

  it('returns a non-empty string for empty query', () => {
    expect(emptyResultsMessage('')).toBeTruthy();
  });

  it('handles special characters in query', () => {
    const msg = emptyResultsMessage('RP-0037"82');
    expect(msg).toContain('RP-0037"82');
  });
});
