import { describe, expect, it } from 'vitest';

import type { DiffCommentThread, FindingMeta, ThreadKind } from '../../types/diff';

import {
  countFindingsByReviewer,
  countOpenFindingsByFile,
  groupFindingsByReviewer,
  isHiddenInDiff,
  parseFileReference,
  preserveServerFindingHistory,
} from './reviewThreads';

function createThread(
  id: string,
  options: { filePath?: string; kind?: ThreadKind; finding?: FindingMeta } = {},
): DiffCommentThread {
  const timestamp = '2024-01-01T00:00:00.000Z';
  return {
    id,
    filePath: options.filePath ?? 'src/a.ts',
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line: 1 },
    messages: [{ id, body: `body ${id}`, createdAt: timestamp, updatedAt: timestamp }],
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.finding ? { finding: options.finding } : {}),
  };
}

const finding = (overrides: Partial<FindingMeta> = {}): FindingMeta => ({
  reviewer: 'correctness',
  severity: 'warn',
  title: 'Title',
  ...overrides,
});

describe('isHiddenInDiff', () => {
  it('hides only rejected findings', () => {
    expect(isHiddenInDiff(createThread('a'))).toBe(false);
    expect(isHiddenInDiff(createThread('b', { kind: 'explanation' }))).toBe(false);
    expect(isHiddenInDiff(createThread('c', { kind: 'finding', finding: finding() }))).toBe(false);
    expect(
      isHiddenInDiff(
        createThread('d', { kind: 'finding', finding: finding({ decision: 'adopted' }) }),
      ),
    ).toBe(false);
    expect(
      isHiddenInDiff(
        createThread('e', { kind: 'finding', finding: finding({ decision: 'rejected' }) }),
      ),
    ).toBe(true);
  });
});

describe('countOpenFindingsByFile', () => {
  it('counts findings that are not rejected per file', () => {
    const counts = countOpenFindingsByFile([
      createThread('a', { filePath: 'x.ts', kind: 'finding', finding: finding() }),
      createThread('b', { filePath: 'x.ts', kind: 'finding', finding: finding() }),
      createThread('c', {
        filePath: 'x.ts',
        kind: 'finding',
        finding: finding({ decision: 'rejected' }),
      }),
      createThread('d', { filePath: 'y.ts', kind: 'explanation' }),
      createThread('e', { filePath: 'y.ts' }),
    ]);

    expect(counts.get('x.ts')).toBe(2);
    expect(counts.has('y.ts')).toBe(false);
  });
});

describe('countFindingsByReviewer', () => {
  it('counts every finding per reviewer, including rejected ones', () => {
    const counts = countFindingsByReviewer([
      createThread('a', { kind: 'finding', finding: finding({ reviewer: 'security' }) }),
      createThread('b', {
        kind: 'finding',
        finding: finding({ reviewer: 'security', decision: 'rejected' }),
      }),
      createThread('c', { kind: 'explanation' }),
    ]);

    expect(Array.from(counts)).toEqual([['security', 2]]);
  });
});

describe('groupFindingsByReviewer', () => {
  const threads = [
    createThread('a', { kind: 'finding', finding: finding({ reviewer: 'security' }) }),
    createThread('b', { kind: 'finding', finding: finding({ reviewer: 'correctness' }) }),
    createThread('c', {
      kind: 'finding',
      finding: finding({ reviewer: 'security', decision: 'rejected' }),
    }),
    createThread('d', { kind: 'explanation' }),
  ];

  it('groups findings by reviewer in first-seen order and skips rejected ones', () => {
    const groups = groupFindingsByReviewer(threads, { includeRejected: false });

    expect(groups.map((group) => group.reviewer)).toEqual(['security', 'correctness']);
    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(['a']);
  });

  it('includes rejected findings when requested', () => {
    const groups = groupFindingsByReviewer(threads, { includeRejected: true });

    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(['a', 'c']);
  });
});

describe('preserveServerFindingHistory', () => {
  it('keeps the server fingerprint and previous decision but the client decision', () => {
    const server = createThread('a', {
      kind: 'finding',
      finding: finding({
        fingerprint: 'fp-1',
        previousDecision: 'rejected',
        decision: 'rejected',
      }),
    });
    const merged = createThread('a', { kind: 'finding', finding: finding() });

    const [result] = preserveServerFindingHistory([server], [merged]);

    expect(result?.finding).toEqual(
      finding({ fingerprint: 'fp-1', previousDecision: 'rejected', decision: undefined }),
    );
  });

  it('leaves threads without a server finding untouched', () => {
    const merged = createThread('a');

    expect(preserveServerFindingHistory([], [merged])).toEqual([merged]);
  });
});

describe('parseFileReference', () => {
  it('parses path:line references', () => {
    expect(parseFileReference('src/server/server.ts:123')).toEqual({
      filePath: 'src/server/server.ts',
      line: 123,
    });
  });

  it('rejects text that is not a file reference', () => {
    expect(parseFileReference('npm run build')).toBeNull();
    expect(parseFileReference('src/server/server.ts')).toBeNull();
    expect(parseFileReference('host:8080')).toBeNull();
  });
});
