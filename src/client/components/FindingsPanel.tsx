import { useState } from 'react';

import type { DiffCommentThread, DiffLineRange, FindingDecision } from '../../types/diff';
import { groupFindingsByReviewer } from '../utils/reviewThreads';

import { Checkbox } from './Checkbox';
import { FindingDecisionButtons, PreviousDecisionBadge, SeverityBadge } from './FindingControls';

interface FindingsPanelProps {
  threads: DiffCommentThread[];
  onNavigate: (threadId: string) => void;
  onSetFindingDecision: (threadId: string, decision: FindingDecision | undefined) => void;
}

const formatLine = (line: DiffLineRange) =>
  typeof line === 'number' ? `${line}` : `${line.start}-${line.end}`;

export function FindingsPanel({ threads, onNavigate, onSetFindingDecision }: FindingsPanelProps) {
  const [showRejected, setShowRejected] = useState(false);
  const groups = groupFindingsByReviewer(threads, { includeRejected: showRejected });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex justify-end">
        <Checkbox checked={showRejected} onChange={setShowRejected} label="Show rejected" />
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-github-text-secondary">No AI findings to show.</p>
      )}
      {groups.map((group) => (
        <section key={group.reviewer} aria-label={group.reviewer} className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-finding-text)]">
            {group.reviewer}
            <span className="ml-2 font-normal text-github-text-muted">{group.threads.length}</span>
          </h2>
          <ul className="divide-y divide-github-border rounded-md border border-[var(--color-finding-border)] bg-github-bg-secondary">
            {group.threads.map((thread) => {
              const finding = thread.finding;
              if (!finding) return null;
              return (
                <li
                  key={thread.id}
                  onClick={() => onNavigate(thread.id)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-github-bg-tertiary ${
                    finding.decision === 'rejected' ? 'opacity-60' : ''
                  }`}
                >
                  <SeverityBadge severity={finding.severity} />
                  <span className="min-w-0 flex-1 truncate text-github-text-primary">
                    {finding.title}
                  </span>
                  {finding.previousDecision && (
                    <PreviousDecisionBadge decision={finding.previousDecision} />
                  )}
                  <span className="shrink-0 font-mono text-xs text-github-text-secondary">
                    {thread.filePath}:{formatLine(thread.position.line)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <FindingDecisionButtons
                      finding={finding}
                      onChange={(decision) => onSetFindingDecision(thread.id, decision)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
