import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LspLocation, LspStatusResponse } from '../../types/lsp';

import { useSymbolNavigation } from './useSymbolNavigation';

const fetchMock = vi.fn();

const enabledStatus: LspStatusResponse = {
  enabled: true,
  servers: [
    { language: 'ruby', state: 'idle' },
    { language: 'typescript', state: 'ready' },
    { language: 'python', state: 'unavailable', detail: 'spawn pyright-langserver ENOENT' },
  ],
};

const location = (filePath: string, line: number): LspLocation => ({
  filePath,
  line,
  character: 2,
  inDiff: true,
  preview: ['const value = 1;'],
  previewStartLine: line,
});

type Route = { status?: number; body: unknown };

function respondWith(routes: Record<string, Route>) {
  fetchMock.mockImplementation((url: string) => {
    const route = routes[url];
    return Promise.resolve({
      ok: route !== undefined && (route.status ?? 200) < 400,
      status: route?.status ?? 404,
      json: async () => route?.body ?? { error: 'Not found' },
    });
  });
}

const target = (line: number, symbol = 'value') => ({
  filePath: 'src/a.ts',
  line,
  character: 6,
  symbol,
});

describe('useSymbolNavigation', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads the language server status', async () => {
    respondWith({ '/api/lsp/status': { body: enabledStatus } });

    const { result } = renderHook(() => useSymbolNavigation());

    await waitFor(() => expect(result.current.status).toEqual(enabledStatus));
    expect(result.current.current).toBeNull();
    expect(result.current.view).toBeNull();
    expect(result.current.canGoBack).toBe(false);
  });

  it('treats a malformed status payload as disabled', async () => {
    respondWith({ '/api/lsp/status': { body: { commit: 'abc' } } });

    const { result } = renderHook(() => useSymbolNavigation());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.status).toBeNull();
  });

  it('fetches the definition and references in parallel', async () => {
    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': { body: { locations: [location('src/b.ts', 4)] } },
      '/api/lsp/references': {
        body: { locations: [location('src/b.ts', 4), location('src/a.ts', 12)] },
      },
    });
    const { result } = renderHook(() => useSymbolNavigation());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.lookup(target(12));
    });

    expect(result.current.current).toEqual({
      symbol: 'value',
      origin: { filePath: 'src/a.ts', line: 12, character: 6 },
      definition: [location('src/b.ts', 4)],
      references: [location('src/b.ts', 4), location('src/a.ts', 12)],
    });
    expect(result.current.error).toBeNull();
    const definitionRequest = fetchMock.mock.calls.find(
      ([url]) => url === '/api/lsp/definition',
    )?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(definitionRequest?.body))).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      character: 6,
    });
  });

  it('reports server errors without dropping the previous result', async () => {
    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': { body: { locations: [location('src/b.ts', 4)] } },
      '/api/lsp/references': { body: { locations: [] } },
    });
    const { result } = renderHook(() => useSymbolNavigation());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => {
      await result.current.lookup(target(12));
    });

    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': { status: 504, body: { error: 'Language server timed out' } },
      '/api/lsp/references': { body: { locations: [] } },
    });
    await act(async () => {
      await result.current.lookup(target(20, 'other'));
    });

    expect(result.current.error).toBe('Language server timed out');
    expect(result.current.current?.symbol).toBe('value');
  });

  it('goes back through previous lookups and closes the panel', async () => {
    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': { body: { locations: [] } },
      '/api/lsp/references': { body: { locations: [] } },
    });
    const { result } = renderHook(() => useSymbolNavigation());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.lookup(target(1, 'first'));
    });
    await act(async () => {
      await result.current.lookup(target(2, 'second'));
    });
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      result.current.back();
    });
    expect(result.current.current?.symbol).toBe('first');

    act(() => {
      result.current.close();
    });
    expect(result.current.current).toBeNull();
    expect(result.current.canGoBack).toBe(false);
  });

  it('views the first definition inside the repository after a lookup', async () => {
    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': {
        body: { locations: [location('/usr/lib/value.d.ts', 1), location('src/b.ts', 4)] },
      },
      '/api/lsp/references': { body: { locations: [] } },
    });
    const { result } = renderHook(() => useSymbolNavigation());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.lookup(target(12));
    });

    expect(result.current.view).toEqual({ filePath: 'src/b.ts', line: 4 });
    expect(result.current.canGoBack).toBe(false);
  });

  it('opens locations in the panel and goes back to the previously viewed one', async () => {
    respondWith({
      '/api/lsp/status': { body: enabledStatus },
      '/api/lsp/definition': { body: { locations: [location('src/b.ts', 4)] } },
      '/api/lsp/references': { body: { locations: [location('src/c.ts', 30)] } },
    });
    const { result } = renderHook(() => useSymbolNavigation());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => {
      await result.current.lookup(target(12));
    });

    act(() => {
      result.current.open(location('src/c.ts', 30));
    });
    expect(result.current.view).toEqual({ filePath: 'src/c.ts', line: 30 });
    expect(result.current.current?.symbol).toBe('value');
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      result.current.open(location('/usr/lib/value.d.ts', 1));
    });
    expect(result.current.view).toEqual({ filePath: 'src/c.ts', line: 30 });

    act(() => {
      result.current.back();
    });
    expect(result.current.view).toEqual({ filePath: 'src/b.ts', line: 4 });
    expect(result.current.canGoBack).toBe(false);
  });
});
