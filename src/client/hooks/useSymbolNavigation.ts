import { useCallback, useEffect, useState } from 'react';

import type { LspLocation, LspPositionRequest, LspStatusResponse } from '../../types/lsp';
import { fetchJson, isRecord } from '../utils/fetchJson';

export interface SymbolLookup {
  symbol: string;
  origin: LspPositionRequest;
  definition: LspLocation[];
  references: LspLocation[];
}

export type SymbolTarget = LspPositionRequest & { symbol: string };

export interface ViewedLocation {
  filePath: string;
  line: number;
}

interface PanelEntry {
  lookup: SymbolLookup;
  view: ViewedLocation | null;
}

export const isRepositoryPath = (filePath: string) =>
  !filePath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(filePath);

const toView = ({ filePath, line }: LspLocation): ViewedLocation => ({ filePath, line });

const firstViewableLocation = (locations: LspLocation[]) => {
  const location = locations.find(({ filePath }) => isRepositoryPath(filePath));
  return location ? toView(location) : null;
};

const isStatusResponse = (value: unknown): value is LspStatusResponse =>
  isRecord(value) && typeof value.enabled === 'boolean' && Array.isArray(value.servers);

async function fetchStatus(): Promise<LspStatusResponse | null> {
  const payload = await fetchJson('/api/lsp/status');
  return isStatusResponse(payload) ? payload : null;
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
  const [entries, setEntries] = useState<PanelEntry[]>([]);
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
        setEntries((prev) => [
          ...prev,
          {
            lookup: { symbol, origin, definition, references },
            view: firstViewableLocation(definition),
          },
        ]);
      } catch (lookupError) {
        setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
      } finally {
        setIsLoading(false);
        void refreshStatus();
      }
    },
    [refreshStatus],
  );

  const open = useCallback((location: LspLocation) => {
    if (!isRepositoryPath(location.filePath)) return;
    setEntries((prev) => {
      const latest = prev.at(-1);
      return latest ? [...prev, { lookup: latest.lookup, view: toView(location) }] : prev;
    });
  }, []);

  const back = useCallback(() => {
    setError(null);
    setEntries((prev) => prev.slice(0, -1));
  }, []);

  const close = useCallback(() => {
    setError(null);
    setEntries([]);
  }, []);

  const latest = entries.at(-1);

  return {
    status,
    current: latest?.lookup ?? null,
    view: latest?.view ?? null,
    isLoading,
    error,
    lookup,
    open,
    back,
    close,
    canGoBack: entries.length > 1,
  };
}
