import type { DiffCommentThread, FindingMeta } from '../../types/diff';
import { getThreadKind } from '../../utils/commentImports';

type ReviewThread = Pick<DiffCommentThread, 'kind' | 'finding'>;

type FindingThread = DiffCommentThread & { finding: FindingMeta };

interface FindingGroup {
  reviewer: string;
  threads: FindingThread[];
}

const FILE_REFERENCE_PATTERN = /^([^\s:]+\.[A-Za-z0-9]+):(\d+)$/;

export function isFindingThread<T extends ReviewThread>(
  thread: T,
): thread is T & { finding: FindingMeta } {
  return getThreadKind(thread) === 'finding' && thread.finding !== undefined;
}

export function isHiddenInDiff(thread: ReviewThread): boolean {
  return isFindingThread(thread) && thread.finding.decision === 'rejected';
}

export function countOpenFindingsByFile(threads: DiffCommentThread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (!isFindingThread(thread) || thread.finding.decision === 'rejected') continue;
    counts.set(thread.filePath, (counts.get(thread.filePath) ?? 0) + 1);
  }
  return counts;
}

export function countFindingsByReviewer(threads: DiffCommentThread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (!isFindingThread(thread)) continue;
    const { reviewer } = thread.finding;
    counts.set(reviewer, (counts.get(reviewer) ?? 0) + 1);
  }
  return counts;
}

export function groupFindingsByReviewer(
  threads: DiffCommentThread[],
  { includeRejected }: { includeRejected: boolean },
): FindingGroup[] {
  const groups = new Map<string, FindingThread[]>();
  for (const thread of threads) {
    if (!isFindingThread(thread)) continue;
    if (!includeRejected && isHiddenInDiff(thread)) continue;
    const group = groups.get(thread.finding.reviewer);
    if (group) {
      group.push(thread);
    } else {
      groups.set(thread.finding.reviewer, [thread]);
    }
  }
  return Array.from(groups, ([reviewer, groupThreads]) => ({ reviewer, threads: groupThreads }));
}

export function preserveServerFindingHistory(
  serverThreads: DiffCommentThread[],
  mergedThreads: DiffCommentThread[],
): DiffCommentThread[] {
  const serverFindings = new Map(
    serverThreads.flatMap((thread) => (thread.finding ? [[thread.id, thread.finding]] : [])),
  );
  return mergedThreads.map((thread) => {
    const serverFinding = serverFindings.get(thread.id);
    if (!serverFinding || !thread.finding) return thread;
    return {
      ...thread,
      finding: {
        ...thread.finding,
        fingerprint: serverFinding.fingerprint ?? thread.finding.fingerprint,
        previousDecision: serverFinding.previousDecision,
      },
    };
  });
}

export function parseFileReference(text: string): { filePath: string; line: number } | null {
  const match = FILE_REFERENCE_PATTERN.exec(text.trim());
  if (!match?.[1] || !match[2]) return null;
  return { filePath: match[1], line: Number(match[2]) };
}
