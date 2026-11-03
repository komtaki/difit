import { describe, expect, it, vi } from 'vitest';

import type { CommentImport, DiffCommentThread, FindingDecision, FindingMeta } from '../types/diff';

import {
  getThreadKind,
  mergeCommentImports,
  mergeCommentThreads,
  normalizeCommentImports,
  parseCommentImportValue,
  serializeCommentImports,
} from './commentImports';

const findingImport = {
  type: 'thread',
  kind: 'finding',
  reviewer: 'correctness',
  severity: 'warn',
  title: 'T',
  filePath: 'src/example.ts',
  position: { side: 'new', line: 10 },
  body: 'Finding body',
  author: 'AI',
} as const;

function createThread({
  id,
  filePath = 'src/example.ts',
  side = 'new',
  line = 10,
  body,
  updatedAt = '2024-01-01T00:00:00.000Z',
}: {
  id: string;
  filePath?: string;
  side?: 'old' | 'new';
  line?: number;
  body: string;
  updatedAt?: string;
}): DiffCommentThread {
  return {
    id,
    filePath,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
    position: {
      side,
      line,
    },
    messages: [
      {
        id,
        body,
        author: 'User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt,
      },
    ],
  };
}

describe('commentImports', () => {
  describe('parseCommentImportValue', () => {
    it('parses a single thread import', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
        }),
      );

      expect(imports).toEqual([
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          id: undefined,
          author: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          codeSnapshot: undefined,
        },
      ]);
    });

    it('parses an array of imports', () => {
      const imports = parseCommentImportValue(
        JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Root',
          },
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Reply',
          },
        ]),
      );

      expect(imports).toHaveLength(2);
      expect(imports[0]?.type).toBe('thread');
      expect(imports[1]?.type).toBe('reply');
    });

    it('rejects malformed json', () => {
      expect(() => parseCommentImportValue('{')).toThrow('Invalid --comment JSON');
    });

    it('rejects invalid import shape', () => {
      expect(() =>
        parseCommentImportValue(
          JSON.stringify({
            type: 'thread',
            filePath: '',
            position: { side: 'new', line: 0 },
            body: '',
          }),
        ),
      ).toThrow('Invalid comment import field: filePath');
    });
  });

  describe('normalizeCommentImports with review metadata', () => {
    it('accepts a finding thread import', () => {
      const [entry] = normalizeCommentImports(findingImport);

      expect(entry).toMatchObject({
        type: 'thread',
        kind: 'finding',
        reviewer: 'correctness',
        severity: 'warn',
        title: 'T',
      });
    });

    it('accepts an explanation thread import without finding fields', () => {
      const [entry] = normalizeCommentImports({
        type: 'thread',
        kind: 'explanation',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Explains the change',
      });

      expect(entry?.kind).toBe('explanation');
    });

    it.each(['reviewer', 'severity', 'title'] as const)(
      'rejects a finding without %s',
      (fieldName) => {
        const withoutField = Object.fromEntries(
          Object.entries(findingImport).filter(([key]) => key !== fieldName),
        );

        expect(() => normalizeCommentImports(withoutField)).toThrow(
          `Invalid comment import field: ${fieldName}`,
        );
      },
    );

    it('rejects a finding with an empty reviewer', () => {
      expect(() => normalizeCommentImports({ ...findingImport, reviewer: '  ' })).toThrow(
        'Invalid comment import field: reviewer',
      );
    });

    it('rejects an unknown kind', () => {
      expect(() => normalizeCommentImports({ ...findingImport, kind: 'note' })).toThrow(
        'Invalid comment import field: kind',
      );
    });

    it('rejects an unknown severity', () => {
      expect(() => normalizeCommentImports({ ...findingImport, severity: 'fatal' })).toThrow(
        'Invalid comment import field: severity',
      );
    });

    it('rejects finding fields on a non-finding thread', () => {
      expect(() =>
        normalizeCommentImports({
          type: 'thread',
          kind: 'explanation',
          title: 'T',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Explains the change',
        }),
      ).toThrow('Invalid comment import field: title');
    });

    it.each(['kind', 'reviewer', 'severity', 'title'] as const)(
      'rejects %s on a reply import',
      (fieldName) => {
        expect(() =>
          normalizeCommentImports({
            type: 'reply',
            [fieldName]: findingImport[fieldName],
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Reply',
          }),
        ).toThrow(`Invalid comment import field: ${fieldName}`);
      },
    );
  });

  describe('getThreadKind', () => {
    it('defaults to comment when kind is omitted', () => {
      expect(getThreadKind({})).toBe('comment');
    });

    it('returns the thread kind when present', () => {
      expect(getThreadKind({ kind: 'finding' })).toBe('finding');
    });
  });

  describe('serializeCommentImports', () => {
    it('creates a stable payload string for hashing', () => {
      const commentImports: CommentImport[] = [
        {
          type: 'thread',
          id: 'thread-1',
          filePath: 'src/example.ts',
          position: { side: 'new', line: { start: 10, end: 12 } },
          body: 'Root',
          author: 'AI',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          codeSnapshot: { content: 'const value = 1;' },
        },
      ];

      expect(serializeCommentImports(commentImports)).toBe(
        JSON.stringify([
          {
            type: 'thread',
            id: 'thread-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: { start: 10, end: 12 } },
            body: 'Root',
            author: 'AI',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            codeSnapshot: { content: 'const value = 1;', language: undefined },
          },
        ]),
      );
    });
  });

  describe('mergeCommentImports', () => {
    it('adds a new thread import', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

      const result = mergeCommentImports(
        [],
        [
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported thread',
          },
        ],
      );

      expect(result.warnings).toEqual([]);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.messages[0]?.body).toBe('Imported thread');

      vi.useRealTimers();
    });

    it('skips a duplicate thread import with the same root message', () => {
      const existing = [createThread({ id: 'thread-1', body: 'Imported thread' })];

      const result = mergeCommentImports(existing, [
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Imported thread',
          author: 'User',
        },
      ]);

      expect(result.threads).toHaveLength(1);
    });

    it('adds a reply to the newest matching thread', () => {
      const olderThread = createThread({
        id: 'thread-1',
        body: 'Root 1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const newerThread = createThread({
        id: 'thread-2',
        body: 'Root 2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [olderThread, newerThread],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(1);
      expect(result.threads[1]?.messages).toHaveLength(2);
      expect(result.threads[1]?.messages[1]?.body).toBe('Imported reply');
    });

    it('skips a duplicate reply import', () => {
      const existing = createThread({ id: 'thread-1', body: 'Root' });
      existing.messages.push({
        id: 'reply-1',
        body: 'Imported reply',
        author: 'AI',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [existing],
        [
          {
            type: 'reply',
            id: 'reply-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(2);
    });

    it('creates a finding thread with finding metadata', () => {
      const result = mergeCommentImports([], normalizeCommentImports(findingImport));

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.kind).toBe('finding');
      const expectedFinding: FindingMeta = {
        reviewer: 'correctness',
        severity: 'warn',
        title: 'T',
      };
      expect(result.threads[0]?.finding).toEqual(expectedFinding);
    });

    it('creates an explanation thread without finding metadata', () => {
      const result = mergeCommentImports(
        [],
        normalizeCommentImports({
          type: 'thread',
          kind: 'explanation',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Explains the change',
        }),
      );

      expect(result.threads[0]?.kind).toBe('explanation');
      expect(result.threads[0]?.finding).toBeUndefined();
    });

    it('creates a plain thread without kind when kind is omitted', () => {
      const result = mergeCommentImports(
        [],
        normalizeCommentImports({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Plain comment',
        }),
      );

      expect(result.threads[0]).not.toHaveProperty('kind');
      expect(result.threads[0]).not.toHaveProperty('finding');
    });

    it('skips a duplicate finding import', () => {
      const imports = normalizeCommentImports(findingImport);
      const first = mergeCommentImports([], imports);
      const second = mergeCommentImports(first.threads, imports);

      expect(second.threads).toHaveLength(1);
    });

    it('keeps finding metadata when cloning existing threads', () => {
      const first = mergeCommentImports([], normalizeCommentImports(findingImport));
      const decision: FindingDecision = 'adopted';
      const existing = first.threads.map((thread) => ({
        ...thread,
        finding: thread.finding && { ...thread.finding, decision },
      }));

      const result = mergeCommentImports(existing, []);

      expect(result.threads[0]?.kind).toBe('finding');
      expect(result.threads[0]?.finding?.decision).toBe('adopted');
    });

    it('adds resolved finding history only to newly imported findings', () => {
      const resolveFindingHistory = vi.fn(() => ({
        fingerprint: 'fp-1',
        decision: 'rejected' as const,
        previousDecision: 'rejected' as const,
      }));

      const result = mergeCommentImports(
        [],
        normalizeCommentImports([
          findingImport,
          {
            type: 'thread',
            filePath: 'src/plain.ts',
            position: { side: 'new', line: 1 },
            body: 'x',
          },
        ]),
        resolveFindingHistory,
      );

      expect(resolveFindingHistory).toHaveBeenCalledTimes(1);
      expect(result.threads[0]?.finding).toEqual({
        reviewer: 'correctness',
        severity: 'warn',
        title: 'T',
        fingerprint: 'fp-1',
        decision: 'rejected',
        previousDecision: 'rejected',
      });
      expect(result.threads[1]).not.toHaveProperty('finding');
    });

    it('warns and skips reply import when no matching thread exists', () => {
      const result = mergeCommentImports(
        [],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
          },
        ],
      );

      expect(result.threads).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Skipped reply import');
    });
  });

  describe('mergeCommentThreads', () => {
    it('keeps the incoming finding decision when merging the same thread', () => {
      const [existing] = mergeCommentImports([], normalizeCommentImports(findingImport)).threads;
      if (!existing?.finding) throw new Error('expected a finding thread');
      const incoming = {
        ...existing,
        finding: { ...existing.finding, decision: 'adopted' as const },
      };

      const result = mergeCommentThreads([existing], [incoming]);

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.kind).toBe('finding');
      expect(result.threads[0]?.finding?.decision).toBe('adopted');
    });

    it('keeps existing finding metadata when the incoming thread has none', () => {
      const [existing] = mergeCommentImports([], normalizeCommentImports(findingImport)).threads;
      if (!existing) throw new Error('expected a finding thread');
      const incoming: DiffCommentThread = { ...existing };
      delete incoming.kind;
      delete incoming.finding;

      const result = mergeCommentThreads([existing], [incoming]);

      expect(result.threads[0]?.kind).toBe('finding');
      expect(result.threads[0]?.finding?.reviewer).toBe('correctness');
    });
  });
});
