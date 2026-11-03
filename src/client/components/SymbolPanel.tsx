import { ArrowLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LspLocation, LspServerState, LspStatusResponse } from '../../types/lsp';
import type { SymbolLookup } from '../hooks/useSymbolNavigation';

interface SymbolPanelProps {
  status: LspStatusResponse;
  current: SymbolLookup | null;
  isLoading: boolean;
  error: string | null;
  canGoBack: boolean;
  onSelectLocation: (location: LspLocation) => void;
  onBack: () => void;
  onClose: () => void;
}

const SERVER_STATE_CLASS: Record<LspServerState, string> = {
  idle: 'text-github-text-muted',
  starting: 'text-github-warning',
  ready: 'text-github-accent',
  unavailable: 'text-github-danger',
};

const isRepositoryPath = (filePath: string) =>
  !filePath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(filePath);

const formatLocation = (location: Pick<LspLocation, 'filePath' | 'line'>) =>
  `${location.filePath}:${location.line}`;

function LocationButton({
  location,
  onSelect,
  children,
}: {
  location: LspLocation;
  onSelect: (location: LspLocation) => void;
  children: ReactNode;
}) {
  if (!isRepositoryPath(location.filePath)) {
    return <div className="block w-full px-3 py-1.5 text-left opacity-70">{children}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(location)}
      className="block w-full px-3 py-1.5 text-left hover:bg-github-bg-tertiary"
    >
      {children}
    </button>
  );
}

function LocationLabel({ location }: { location: LspLocation }) {
  return (
    <span className="block truncate font-mono text-xs text-sky-500">
      {formatLocation(location)}
    </span>
  );
}

function DefinitionPreview({ location }: { location: LspLocation }) {
  return (
    <pre className="mx-3 overflow-x-auto rounded border border-github-border bg-github-bg-primary py-1 font-mono text-xs leading-5">
      {location.preview.map((text, index) => {
        const lineNumber = location.previewStartLine + index;
        const isTarget = lineNumber === location.line;
        return (
          <div
            key={lineNumber}
            className={`flex ${isTarget ? 'bg-[var(--color-diff-selected-bg)]' : ''}`}
          >
            <span className="w-10 shrink-0 select-none pr-2 text-right text-github-text-muted">
              {lineNumber}
            </span>
            <span
              className="whitespace-pre text-github-text-primary"
              data-target-line={isTarget ? 'true' : undefined}
            >
              {text}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

const getTargetLineText = (location: LspLocation) =>
  location.preview[location.line - location.previewStartLine]?.trim() ?? '';

export function SymbolPanel({
  status,
  current,
  isLoading,
  error,
  canGoBack,
  onSelectLocation,
  onBack,
  onClose,
}: SymbolPanelProps) {
  const origin = current?.origin;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-github-border bg-github-bg-secondary text-sm">
      <div className="flex items-center gap-2 border-b border-github-border px-3 py-2">
        {canGoBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-github-text-secondary hover:bg-github-bg-tertiary hover:text-github-text-primary"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
        )}
        <span className="min-w-0 flex-1 truncate font-mono font-semibold text-github-text-primary">
          {current?.symbol ?? 'Symbol'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close symbol panel"
          className="rounded p-1 text-github-text-secondary hover:bg-github-bg-tertiary hover:text-github-text-primary"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="px-3 py-2 text-github-text-secondary">Looking up…</p>}
        {error && (
          <p role="alert" className="px-3 py-2 text-github-danger">
            {error}
          </p>
        )}
        {current && origin && (
          <>
            <p className="px-3 pt-2 text-xs text-github-text-muted">
              from{' '}
              <button
                type="button"
                onClick={() =>
                  onSelectLocation({
                    ...origin,
                    inDiff: true,
                    preview: [],
                    previewStartLine: origin.line,
                  })
                }
                className="font-mono text-sky-500 hover:underline"
              >
                {formatLocation(origin)}
              </button>
            </p>
            <section aria-label="Definition" className="py-2">
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-github-text-muted">
                Definition
              </h3>
              {current.definition.length === 0 && (
                <p className="px-3 text-github-text-secondary">No definition found.</p>
              )}
              {current.definition.map((location) => (
                <div key={`${formatLocation(location)}:${location.character}`} className="pb-2">
                  <LocationButton location={location} onSelect={onSelectLocation}>
                    <LocationLabel location={location} />
                  </LocationButton>
                  <DefinitionPreview location={location} />
                </div>
              ))}
            </section>
            <section
              aria-label={`References (${current.references.length})`}
              className="border-t border-github-border py-2"
            >
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-github-text-muted">
                References ({current.references.length})
              </h3>
              {current.references.map((location) => (
                <LocationButton
                  key={`${formatLocation(location)}:${location.character}`}
                  location={location}
                  onSelect={onSelectLocation}
                >
                  <LocationLabel location={location} />
                  <span className="block truncate font-mono text-xs text-github-text-primary">
                    {getTargetLineText(location)}
                  </span>
                </LocationButton>
              ))}
            </section>
          </>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-github-border px-3 py-2 text-xs">
        {status.servers.map((server) => (
          <li key={server.language} className="flex items-center gap-1">
            <span className="text-github-text-secondary">{server.language}</span>
            <span className={SERVER_STATE_CLASS[server.state]} title={server.detail}>
              {server.state}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
