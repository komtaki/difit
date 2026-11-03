import { memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ReviewerState } from '../../types/review';
import { extractMarkdownText, isSafeUrl } from '../utils/markdownUtils';
import { parseFileReference } from '../utils/reviewThreads';
import { getMarkdownComponents } from '../viewers/MarkdownDiffViewer';

import type { AppearanceSettings } from './SettingsModal';

const REMARK_PLUGINS = [remarkGfm];

const transformUrl = (url: string) => (isSafeUrl(url) ? url : '');

interface OverviewPanelProps {
  markdown: string | null;
  reviewers: ReviewerState[];
  findingCountByReviewer: Map<string, number>;
  isFileInDiff: (filePath: string) => boolean;
  onOpenFileReference: (filePath: string, line: number) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

function formatReviewerStatus(reviewer: ReviewerState, findingCount: number): string {
  if (reviewer.status === 'running') return 'running';
  return `done · ${findingCount} ${findingCount === 1 ? 'finding' : 'findings'}`;
}

export const OverviewPanel = memo(function OverviewPanel({
  markdown,
  reviewers,
  findingCountByReviewer,
  isFileInDiff,
  onOpenFileReference,
  syntaxTheme,
}: OverviewPanelProps) {
  const components = useMemo(() => {
    const baseComponents = getMarkdownComponents(syntaxTheme);
    return {
      ...baseComponents,
      code: ({ className, children }: { className?: string; children?: ReactNode }) => {
        const reference = className ? null : parseFileReference(extractMarkdownText(children));
        if (!reference || !isFileInDiff(reference.filePath)) {
          return baseComponents.code({ className, children });
        }
        return (
          <button
            type="button"
            onClick={() => onOpenFileReference(reference.filePath, reference.line)}
            className="rounded border border-github-border bg-github-bg-tertiary px-1 py-0.5 font-mono text-sm text-sky-500 underline-offset-4 hover:underline"
          >
            {children}
          </button>
        );
      },
    };
  }, [isFileInDiff, onOpenFileReference, syntaxTheme]);

  return (
    <div className="flex min-h-full gap-6 p-6">
      <article className="min-w-0 flex-1 space-y-4 text-github-text-primary">
        {markdown === null ? (
          <p className="text-sm text-github-text-secondary">No overview has been provided.</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            urlTransform={transformUrl}
            components={components}
          >
            {markdown}
          </ReactMarkdown>
        )}
      </article>
      {reviewers.length > 0 && (
        <aside className="w-64 shrink-0">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-github-text-muted">
            Reviewers
          </h2>
          <ul className="divide-y divide-github-border rounded-md border border-github-border bg-github-bg-secondary">
            {reviewers.map((reviewer) => (
              <li
                key={reviewer.name}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="truncate text-github-text-primary">{reviewer.name}</span>
                <span
                  className={`shrink-0 text-xs ${
                    reviewer.status === 'running'
                      ? 'text-github-warning'
                      : 'text-github-text-secondary'
                  }`}
                >
                  {formatReviewerStatus(reviewer, findingCountByReviewer.get(reviewer.name) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
});
