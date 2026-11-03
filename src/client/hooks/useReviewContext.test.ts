import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReviewContext } from './useReviewContext';

const fetchMock = vi.fn();

function respondWith(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string) => {
    const body = routes[url];
    return Promise.resolve({
      ok: body !== undefined,
      json: async () => body,
    });
  });
}

describe('useReviewContext', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads the overview and reviewers on mount', async () => {
    respondWith({
      '/api/overview': { markdown: '# Summary' },
      '/api/reviewers': {
        reviewers: [{ name: 'security', status: 'running', updatedAt: '2024-01-01T00:00:00Z' }],
      },
    });

    const { result } = renderHook(() => useReviewContext());

    await waitFor(() => {
      expect(result.current.overview).toBe('# Summary');
      expect(result.current.reviewers).toEqual([
        { name: 'security', status: 'running', updatedAt: '2024-01-01T00:00:00Z' },
      ]);
    });
  });

  it('treats missing, blank or malformed payloads as empty', async () => {
    respondWith({
      '/api/overview': { markdown: '   ' },
      '/api/reviewers': { reviewers: [{ name: 'x', status: 'unknown' }, 'bad'] },
    });

    const { result } = renderHook(() => useReviewContext());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.overview).toBeNull();
    expect(result.current.reviewers).toEqual([]);
  });

  it('refetches only what changed when notified', async () => {
    respondWith({ '/api/overview': { markdown: null }, '/api/reviewers': { reviewers: [] } });
    const { result } = renderHook(() => useReviewContext());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    respondWith({ '/api/overview': { markdown: 'Updated' }, '/api/reviewers': { reviewers: [] } });
    act(() => {
      result.current.handleReviewContextChanged('overviewChanged');
    });

    await waitFor(() => expect(result.current.overview).toBe('Updated'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/overview');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
