import { ArrowLeft, X } from 'lucide-react';

import type { LspLocation, LspServerState, LspStatusResponse } from '../../types/lsp';
import {
  isRepositoryPath,
  type ViewedLocation,
  type SymbolLookup,
} from '../hooks/useSymbolNavigation';

import type { AppearanceSettings } from './SettingsModal';
import { SymbolFileView } from './SymbolFileView';

interface SymbolPanelProps {
  status: LspStatusResponse;
  current: SymbolLookup | null;
  view: ViewedLocation | null;
  isLoading: boolean;
  error: string | null;
  canGoBack: boolean;
  width: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  onOpenLocation: (location: LspLocation) => void;
  onShowInDiff: (filePath: string, line: number) => void;
  onBack: () => void;
  onClose: () => void;
}

const SERVER_STATE_CLASS: Record<LspServerState, string> = {
  idle: 'text-github-text-muted',
  starting: 'text-github-warning',
  ready: 'text-github-accent',
  unavailable: 'text-github-danger',
};

const formatLocation = (location: Pick<LspLocation, 'filePath' | 'line'>) =>
  `${location.filePath}:${location.line}`;

const getTargetLineText = (location: LspLocation) =>
  location.preview[location.line - location.previewStartLine]?.trim() ?? '';

function LocationEntry({
  location,
  isViewed,
  onOpen,
  onShowInDiff,
}: {
  location: LspLocation;
  isViewed: boolean;
  onOpen: (location: LspLocation) => void;
  onShowInDiff: (filePath: string, line: number) => void;
}) {
  const label = (
    <>
      <span className="block break-all font-mono text-xs text-sky-500">
        {formatLocation(location)}
      </span>
      <span className="block whitespace-pre-wrap break-words font-mono text-xs text-github-text-primary">
        {getTargetLineText(location)}
      </span>
    </>
  );
  return (
    <li className={`flex items-start gap-2 ${isViewed ? 'bg-github-bg-tertiary' : ''}`}>
      {isRepositoryPath(location.filePath) ? (
        <button
          type="button"
          onClick={() => onOpen(location)}
          aria-current={isViewed ? 'true' : undefined}
          className="min-w-0 flex-1 px-3 py-1.5 text-left hover:bg-github-bg-tertiary"
        >
          {label}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-3 py-1.5 opacity-70">{label}</div>
      )}
      {location.inDiff && (
        <button
          type="button"
          onClick={() => onShowInDiff(location.filePath, location.line)}
          className="mr-2 mt-1.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-github-text-secondary hover:bg-github-bg-tertiary hover:text-github-text-primary"
        >
          Show in diff
        </button>
      )}
    </li>
  );
}

function LocationSection({
  title,
  emptyMessage,
  locations,
  view,
  onOpen,
  onShowInDiff,
}: {
  title: string;
  emptyMessage: string;
  locations: LspLocation[];
  view: ViewedLocation | null;
  onOpen: (location: LspLocation) => void;
  onShowInDiff: (filePath: string, line: number) => void;
}) {
  return (
    <section aria-label={title} className="py-2">
      <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-github-text-muted">
        {title}
      </h3>
      {locations.length === 0 && <p className="px-3 text-github-text-secondary">{emptyMessage}</p>}
      <ul>
        {locations.map((location) => (
          <LocationEntry
            key={`${formatLocation(location)}:${location.character}`}
            location={location}
            isViewed={view?.filePath === location.filePath && view.line === location.line}
            onOpen={onOpen}
            onShowInDiff={onShowInDiff}
          />
        ))}
      </ul>
    </section>
  );
}

export function SymbolPanel({
  status,
  current,
  view,
  isLoading,
  error,
  canGoBack,
  width,
  syntaxTheme,
  onOpenLocation,
  onShowInDiff,
  onBack,
  onClose,
}: SymbolPanelProps) {
  const origin = current?.origin;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-github-border bg-github-bg-secondary text-sm"
      style={{ width: `${width}px` }}
    >
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
        <span className="min-w-0 flex-1 break-all font-mono font-semibold text-github-text-primary">
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
      {isLoading && <p className="px-3 py-2 text-github-text-secondary">Looking up…</p>}
      {error && (
        <p role="alert" className="px-3 py-2 text-github-danger">
          {error}
        </p>
      )}
      {view && (
        <>
          <p className="break-all border-b border-github-border px-3 py-1.5 font-mono text-xs text-github-text-primary">
            {formatLocation(view)}
          </p>
          <SymbolFileView filePath={view.filePath} line={view.line} syntaxTheme={syntaxTheme} />
        </>
      )}
      {current && origin && (
        <div
          className={`overflow-y-auto border-t border-github-border ${view ? 'max-h-[40%] shrink-0' : 'min-h-0 flex-1'}`}
        >
          <p className="px-3 pt-2 text-xs text-github-text-muted">
            from{' '}
            <button
              type="button"
              onClick={() => onShowInDiff(origin.filePath, origin.line)}
              className="font-mono text-sky-500 hover:underline"
            >
              {formatLocation(origin)}
            </button>
          </p>
          <LocationSection
            title="Definition"
            emptyMessage="No definition found."
            locations={current.definition}
            view={view}
            onOpen={onOpenLocation}
            onShowInDiff={onShowInDiff}
          />
          <LocationSection
            title={`References (${current.references.length})`}
            emptyMessage="No references found."
            locations={current.references}
            view={view}
            onOpen={onOpenLocation}
            onShowInDiff={onShowInDiff}
          />
        </div>
      )}
      <ul className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-github-border px-3 py-2 text-xs">
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
