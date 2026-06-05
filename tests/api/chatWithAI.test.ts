import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatWithAI } from '@/api/chatWithAI';
import { ApiError } from '@/api/searchCases';
import { MainSearchType } from '@/types/case';

const chatSuccess = {
  text: 'Found 2 cases.',
  cases: [],
  totalRecords: 2,
  hasMorePages: false,
  page: 1,
  query: 'John',
  searchType: MainSearchType.AllCases,
};

describe('chatWithAI', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns structured result on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(chatSuccess),
      }),
    );

    const result = await chatWithAI('find John', MainSearchType.AllCases);
    expect(result.text).toBe('Found 2 cases.');
    expect(result.totalRecords).toBe(2);
    expect(result.page).toBe(1);
  });

  it('posts JSON body with message and searchType', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(chatSuccess),
      }),
    );

    await chatWithAI('find cases', MainSearchType.OpenCases);
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/chat');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body as string);
    expect(body.message).toBe('find cases');
    expect(body.searchType).toBe(MainSearchType.OpenCases);
  });

  it('fills in defaults when response fields are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    );

    const result = await chatWithAI('hello', MainSearchType.AllCases);
    expect(result.text).toBe('');
    expect(result.cases).toEqual([]);
    expect(result.totalRecords).toBe(0);
    expect(result.hasMorePages).toBe(false);
    expect(result.page).toBe(1);
    expect(result.query).toBe('hello');
  });

  it('throws ApiError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(chatWithAI('hi', MainSearchType.AllCases)).rejects.toMatchObject({
      status: 0,
      isAuthError: false,
    });
  });

  it('throws ApiError with isAuthError from response on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized', isAuthError: true }),
      }),
    );

    const err = await chatWithAI('hi', MainSearchType.AllCases).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isAuthError).toBe(true);
  });

  it('sets isConfigError on 500 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Config error', isConfigError: true }),
      }),
    );

    const err = await chatWithAI('hi', MainSearchType.AllCases).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    const extErr = err as ApiError & { isConfigError?: boolean };
    expect(extErr.isConfigError).toBe(true);
  });
});
