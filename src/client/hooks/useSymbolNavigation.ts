import { useCallback, useEffect, useState } from 'react';

import type { LspLocation, LspPositionRequest, LspStatusResponse } from '../../types/lsp';

export interface SymbolLookup {
  symbol: string;
  origin: LspPositionRequest;
  definition: LspLocation[];
  references: LspLocation[];
}

export type SymbolTarget = LspPositionRequest & { symbol: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStatusResponse = (value: unknown): value is LspStatusResponse =>
  isRecord(value) && typeof value.enabled === 'boolean' && Array.isArray(value.servers);

async function fetchStatus(): Promise<LspStatusResponse | null> {
  try {
    const response = await fetch('/api/lsp/status');
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return isStatusResponse(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function fetchLocations(
  method: 'definition' | 'references',
  position: LspPositionRequest,
): Promise<LspLocation[]> {
  const response = await fetch(`/api/lsp/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(position),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;
    throw new Error(message ?? `Language server request failed (${response.status})`);
  }
  return isRecord(payload) && Array.isArray(payload.locations)
    ? (payload.locations as LspLocation[])
    : [];
}

export function useSymbolNavigation() {
  const [status, setStatus] = useState<LspStatusResponse | null>(null);
  const [lookups, setLookups] = useState<SymbolLookup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await fetchStatus());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const lookup = useCallback(
    async ({ symbol, ...origin }: SymbolTarget) => {
      setIsLoading(true);
      setError(null);
      try {
        const [definition, references] = await Promise.all([
          fetchLocations('definition', origin),
          fetchLocations('references', origin),
        ]);
        setLookups((prev) => [...prev, { symbol, origin, definition, references }]);
      } catch (lookupError) {
        setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
      } finally {
        setIsLoading(false);
        void refreshStatus();
      }
    },
    [refreshStatus],
  );

  const back = useCallback(() => {
    setError(null);
    setLookups((prev) => prev.slice(0, -1));
  }, []);

  const close = useCallback(() => {
    setError(null);
    setLookups([]);
  }, []);

  return {
    status,
    current: lookups.at(-1) ?? null,
    isLoading,
    error,
    lookup,
    back,
    close,
    canGoBack: lookups.length > 1,
  };
}
