import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DiffCommentThread, FindingDecision, FindingMeta, ThreadKind } from '../../types/diff';
import { getThreadKind } from '../../utils/commentImports';

type SetFindingDecision = (threadId: string, decision: FindingDecision | undefined) => void;

interface ReviewThreadContextValue {
  reviewById: Map<string, Pick<DiffCommentThread, 'kind' | 'finding'>>;
  onSetFindingDecision: SetFindingDecision;
}

interface ThreadReview {
  kind: ThreadKind;
  finding?: FindingMeta;
  setDecision: (decision: FindingDecision | undefined) => void;
}

const ReviewThreadContext = createContext<ReviewThreadContextValue | null>(null);

export function ReviewThreadProvider({
  threads,
  onSetFindingDecision,
  children,
}: {
  threads: DiffCommentThread[];
  onSetFindingDecision: SetFindingDecision;
  children: ReactNode;
}) {
  const value = useMemo<ReviewThreadContextValue>(
    () => ({
      reviewById: new Map(
        threads.map((thread) => [thread.id, { kind: thread.kind, finding: thread.finding }]),
      ),
      onSetFindingDecision,
    }),
    [threads, onSetFindingDecision],
  );

  return <ReviewThreadContext.Provider value={value}>{children}</ReviewThreadContext.Provider>;
}

export function useThreadReview(threadId: string): ThreadReview | null {
  const context = useContext(ReviewThreadContext);
  const review = context?.reviewById.get(threadId);
  if (!context || !review) return null;

  const kind = getThreadKind(review);
  return {
    kind: kind === 'finding' && !review.finding ? 'comment' : kind,
    finding: review.finding,
    setDecision: (decision) => context.onSetFindingDecision(threadId, decision),
  };
}
