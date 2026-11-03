import type { DiffCommentThread } from '../types/diff.js';

import { getThreadKind } from './commentImports.js';

function hasReplies(thread: DiffCommentThread): boolean {
  return thread.messages.length > 1;
}

function prefixRootMessage(thread: DiffCommentThread, reviewer: string): DiffCommentThread {
  const [rootMessage, ...replies] = thread.messages;
  if (!rootMessage) {
    return thread;
  }

  return {
    ...thread,
    messages: [{ ...rootMessage, body: `[AI:${reviewer}] ${rootMessage.body}` }, ...replies],
  };
}

function selectThreadForOutput(thread: DiffCommentThread): DiffCommentThread | null {
  switch (getThreadKind(thread)) {
    case 'comment':
      return thread;
    case 'explanation':
      return hasReplies(thread) ? thread : null;
    case 'finding':
      if (thread.finding?.decision === 'adopted') {
        return prefixRootMessage(thread, thread.finding.reviewer);
      }
      return hasReplies(thread) ? thread : null;
  }
}

export function selectThreadsForOutput(threads: DiffCommentThread[]): DiffCommentThread[] {
  return threads.flatMap((thread) => selectThreadForOutput(thread) ?? []);
}
