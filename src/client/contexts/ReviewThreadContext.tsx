import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

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

function resolveThreadKind(review: Pick<DiffCommentThread, 'kind' | 'finding'>): ThreadKind {
  const kind = getThreadKind(review);
  return kind === 'finding' && !review.finding ? 'comment' : kind;
}

export function useThreadKindLookup(): (threadId: string) => ThreadKind {
  const context = useContext(ReviewThreadContext);
  return useCallback(
    (threadId: string) => {
      const review = context?.reviewById.get(threadId);
      return review ? resolveThreadKind(review) : 'comment';
    },
    [context],
  );
}

export function useThreadReview(threadId: string): ThreadReview | null {
  const context = useContext(ReviewThreadContext);
  const review = context?.reviewById.get(threadId);
  if (!context || !review) return null;

  return {
    kind: resolveThreadKind(review),
    finding: review.finding,
    setDecision: (decision) => context.onSetFindingDecision(threadId, decision),
  };
}
