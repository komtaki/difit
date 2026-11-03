import { describe, expect, it } from 'vitest';

import type { CommentThread, DiffCommentThread, FindingMeta, ThreadKind } from '../types/diff';

import { formatCommentsOutput } from './commentFormatting';
import { selectThreadsForOutput } from './reviewOutput';

function createThread({
  id,
  kind,
  finding,
  replies = [],
}: {
  id: string;
  kind?: ThreadKind;
  finding?: FindingMeta;
  replies?: string[];
}): DiffCommentThread {
  const timestamp = '2024-01-01T00:00:00.000Z';
  return {
    id,
    filePath: 'src/example.ts',
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line: 10 },
    messages: [
      { id, body: `Root ${id}`, author: 'AI', createdAt: timestamp, updatedAt: timestamp },
      ...replies.map((body, index) => ({
        id: `${id}-reply-${index}`,
        body,
        author: 'User',
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ],
    ...(kind ? { kind } : {}),
    ...(finding ? { finding } : {}),
  };
}

function toCommentThread(thread: DiffCommentThread): CommentThread {
  return {
    id: thread.id,
    file: thread.filePath,
    line: typeof thread.position.line === 'number' ? thread.position.line : 0,
    side: thread.position.side,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages,
  };
}

const finding: FindingMeta = { reviewer: 'correctness', severity: 'warn', title: 'T' };

describe('selectThreadsForOutput', () => {
  it('keeps comment threads unchanged', () => {
    const plain = createThread({ id: 'plain' });
    const explicit = createThread({ id: 'explicit', kind: 'comment' });

    expect(selectThreadsForOutput([plain, explicit])).toEqual([plain, explicit]);
  });

  it('produces the same output as before for threads without kind', () => {
    const threads = [createThread({ id: 'a' }), createThread({ id: 'b', replies: ['Reply'] })];

    expect(formatCommentsOutput(selectThreadsForOutput(threads).map(toCommentThread))).toBe(
      formatCommentsOutput(threads.map(toCommentThread)),
    );
  });

  it('prefixes the root message of an adopted finding with the reviewer', () => {
    const adopted = createThread({
      id: 'adopted',
      kind: 'finding',
      finding: { ...finding, decision: 'adopted' },
      replies: ['Agreed'],
    });

    const [selected] = selectThreadsForOutput([adopted]);

    expect(selected?.messages.map((message) => message.body)).toEqual([
      '[AI:correctness] Root adopted',
      'Agreed',
    ]);
  });

  it('does not mutate the input when prefixing an adopted finding', () => {
    const adopted = createThread({
      id: 'adopted',
      kind: 'finding',
      finding: { ...finding, decision: 'adopted' },
    });

    selectThreadsForOutput([adopted]);

    expect(adopted.messages[0]?.body).toBe('Root adopted');
  });

  it('outputs an undecided finding with replies without the prefix', () => {
    const replied = createThread({ id: 'replied', kind: 'finding', finding, replies: ['Why?'] });

    expect(selectThreadsForOutput([replied])).toEqual([replied]);
  });

  it('skips findings that are neither adopted nor replied to', () => {
    const undecided = createThread({ id: 'undecided', kind: 'finding', finding });
    const rejected = createThread({
      id: 'rejected',
      kind: 'finding',
      finding: { ...finding, decision: 'rejected' },
    });

    expect(selectThreadsForOutput([undecided, rejected])).toEqual([]);
  });

  it('outputs explanations only when they have replies', () => {
    const silent = createThread({ id: 'silent', kind: 'explanation' });
    const replied = createThread({ id: 'replied', kind: 'explanation', replies: ['Question'] });

    expect(selectThreadsForOutput([silent, replied])).toEqual([replied]);
  });

  it('preserves input order', () => {
    const threads = [
      createThread({ id: 'first' }),
      createThread({ id: 'skipped', kind: 'explanation' }),
      createThread({ id: 'second', kind: 'finding', finding: { ...finding, decision: 'adopted' } }),
      createThread({ id: 'third', kind: 'explanation', replies: ['Reply'] }),
    ];

    expect(selectThreadsForOutput(threads).map((thread) => thread.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
