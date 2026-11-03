import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

interface ReadOnlyFileModalProps {
  filePath: string;
  line: number;
  onClose: () => void;
}

type FileState = { lines: string[] } | { error: string } | null;

async function fetchFileLines(filePath: string): Promise<FileState> {
  try {
    const response = await fetch(`/api/lsp/file?path=${encodeURIComponent(filePath)}`);
    const payload = (await response.json().catch(() => null)) as {
      content?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || typeof payload?.content !== 'string') {
      return {
        error: typeof payload?.error === 'string' ? payload.error : 'Failed to load the file',
      };
    }
    return { lines: payload.content.replace(/\n$/, '').split('\n') };
  } catch {
    return { error: 'Failed to load the file' };
  }
}

export function ReadOnlyFileModal({ filePath, line, onClose }: ReadOnlyFileModalProps) {
  const { enableScope, disableScope } = useHotkeysContext();
  const [file, setFile] = useState<FileState>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  const title = `${filePath}:${line}`;

  useHotkeys('escape', () => onClose(), [onClose]);

  useEffect(() => {
    disableScope('navigation');
    return () => enableScope('navigation');
  }, [enableScope, disableScope]);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    void fetchFileLines(filePath).then((result) => {
      if (!cancelled) setFile(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    targetLineRef.current?.scrollIntoView?.({ block: 'center' });
  }, [file, line]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="relative mx-4 flex max-h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-github-border bg-github-bg-primary shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-github-border px-4 py-3">
          <h2 className="truncate font-mono text-sm text-github-text-primary">{title}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-github-text-muted">Read-only · outside the diff</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close file preview"
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-auto py-2 font-mono text-xs leading-5">
          {file === null && <p className="px-4 text-github-text-secondary">Loading…</p>}
          {file && 'error' in file && (
            <p role="alert" className="px-4 text-github-danger">
              {file.error}
            </p>
          )}
          {file &&
            'lines' in file &&
            file.lines.map((text, index) => {
              const lineNumber = index + 1;
              const isTarget = lineNumber === line;
              return (
                <div
                  key={lineNumber}
                  ref={isTarget ? targetLineRef : undefined}
                  className={`flex ${isTarget ? 'bg-[var(--color-diff-selected-bg)]' : ''}`}
                >
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-github-text-muted">
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
        </div>
      </div>
    </div>
  );
}
