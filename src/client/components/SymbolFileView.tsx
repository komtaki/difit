import { Highlight } from 'prism-react-renderer';
import { useEffect, useRef, useState } from 'react';

import { useHighlightedCode } from '../hooks/useHighlightedCode';
import { getPrismLanguageFromFilename } from '../utils/languageDetection';
import Prism from '../utils/prism';
import { getSyntaxTheme } from '../utils/syntaxThemes';

import type { AppearanceSettings } from './SettingsModal';

interface SymbolFileViewProps {
  filePath: string;
  line: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

type FileState = { content: string } | { error: string } | null;

async function fetchRepositoryFile(filePath: string): Promise<FileState> {
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
    return { content: payload.content.replace(/\n$/, '') };
  } catch {
    return { error: 'Failed to load the file' };
  }
}

function HighlightedFile({
  content,
  filePath,
  line,
  syntaxTheme = 'vsDark',
}: {
  content: string;
  filePath: string;
  line: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}) {
  const { actualLang } = useHighlightedCode(content, getPrismLanguageFromFilename(filePath));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const target = targetLineRef.current;
    if (!container || !target) return;
    container.scrollTop = target.offsetTop - container.clientHeight / 3;
  }, [content, line]);

  return (
    <Highlight
      code={content}
      language={actualLang}
      theme={getSyntaxTheme(syntaxTheme)}
      prism={Prism}
    >
      {({ style, tokens, getTokenProps }) => (
        <div
          ref={scrollContainerRef}
          className="relative min-h-0 flex-1 overflow-auto font-mono text-xs leading-5"
          style={{ color: style.color }}
        >
          <div className="min-w-max py-1">
            {tokens.map((lineTokens, index) => {
              const lineNumber = index + 1;
              const isTarget = lineNumber === line;
              return (
                <div
                  key={lineNumber}
                  ref={isTarget ? targetLineRef : undefined}
                  data-line-number={lineNumber}
                  data-target-line={isTarget ? 'true' : undefined}
                  className={`flex ${isTarget ? 'bg-[var(--color-diff-selected-bg)]' : ''}`}
                >
                  <span
                    className={`sticky left-0 w-12 shrink-0 select-none pr-3 text-right text-github-text-muted ${isTarget ? 'bg-[var(--color-diff-selected-bg)]' : 'bg-github-bg-primary'}`}
                  >
                    {lineNumber}
                  </span>
                  <span className="whitespace-pre pr-3">
                    {lineTokens.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Highlight>
  );
}

export function SymbolFileView({ filePath, line, syntaxTheme }: SymbolFileViewProps) {
  const [file, setFile] = useState<FileState>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    void fetchRepositoryFile(filePath).then((result) => {
      if (!cancelled) setFile(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <section
      aria-label="File content"
      className="flex min-h-0 flex-1 flex-col bg-github-bg-primary"
    >
      {file === null && <p className="px-3 py-2 text-github-text-secondary">Loading file…</p>}
      {file && 'error' in file && (
        <p role="alert" className="px-3 py-2 text-github-danger">
          {file.error}
        </p>
      )}
      {file && 'content' in file && (
        <HighlightedFile
          content={file.content}
          filePath={filePath}
          line={line}
          syntaxTheme={syntaxTheme}
        />
      )}
    </section>
  );
}
