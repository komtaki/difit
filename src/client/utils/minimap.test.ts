import { describe, expect, it } from 'vitest';

import type { DiffCommentThread, DiffFile, DiffLine } from '../../types/diff';

import {
  buildFileMinimapMarkers,
  hasFileLayoutChanged,
  layoutMinimapMarkers,
  type MinimapFileLayout,
} from './minimap';

const line = (
  type: DiffLine['type'],
  oldLineNumber?: number,
  newLineNumber?: number,
): DiffLine => ({
  type,
  content: '',
  oldLineNumber,
  newLineNumber,
});

const createFile = (lines: DiffLine[], path = 'src/a.ts'): DiffFile => ({
  path,
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks: [{ header: '@@', oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines }],
});

const createThread = (
  overrides: Partial<DiffCommentThread> & Pick<DiffCommentThread, 'position'>,
): DiffCommentThread => ({
  id: 'thread-1',
  filePath: 'src/a.ts',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  messages: [],
  ...overrides,
});

describe('buildFileMinimapMarkers', () => {
  it('merges adjacent lines of the same change type into one range', () => {
    const file = createFile([
      line('normal', 1, 1),
      line('delete', 2),
      line('delete', 3),
      line('add', undefined, 2),
      line('add', undefined, 3),
      line('add', undefined, 4),
      line('normal', 4, 5),
      line('add', undefined, 6),
    ]);

    expect(buildFileMinimapMarkers(file, []).changes).toEqual([
      { kind: 'delete', start: 1 / 8, end: 3 / 8 },
      { kind: 'add', start: 3 / 8, end: 6 / 8 },
      { kind: 'add', start: 7 / 8, end: 1 },
    ]);
  });

  it('places lines proportionally across all chunks of the file', () => {
    const file: DiffFile = {
      ...createFile([]),
      chunks: [
        {
          header: '@@',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [line('normal', 1, 1), line('add', undefined, 2)],
        },
        {
          header: '@@',
          oldStart: 10,
          oldLines: 2,
          newStart: 11,
          newLines: 1,
          lines: [line('delete', 10), line('normal', 11, 11)],
        },
      ],
    };

    expect(buildFileMinimapMarkers(file, []).changes).toEqual([
      { kind: 'add', start: 1 / 4, end: 2 / 4 },
      { kind: 'delete', start: 2 / 4, end: 3 / 4 },
    ]);
  });

  it('places threads at the line on their side, and ranges at their start line', () => {
    const file = createFile([
      line('normal', 1, 1),
      line('delete', 2),
      line('add', undefined, 2),
      line('normal', 3, 3),
    ]);
    const threads = [
      createThread({ id: 'new', position: { side: 'new', line: 2 } }),
      createThread({ id: 'old', position: { side: 'old', line: 2 } }),
      createThread({
        id: 'range',
        kind: 'explanation',
        position: { side: 'new', line: { start: 3, end: 3 } },
      }),
    ];

    expect(buildFileMinimapMarkers(file, threads).threads).toEqual([
      { id: 'new', kind: 'comment', position: 2.5 / 4 },
      { id: 'old', kind: 'comment', position: 1.5 / 4 },
      { id: 'range', kind: 'explanation', position: 3.5 / 4 },
    ]);
  });

  it('places a thread outside the displayed lines at the nearest line', () => {
    const file = createFile([line('normal', 10, 10), line('add', undefined, 11)]);
    const threads = [
      createThread({
        kind: 'finding',
        finding: { reviewer: 'r', severity: 'warn', title: 't' },
        position: { side: 'new', line: 40 },
      }),
    ];

    expect(buildFileMinimapMarkers(file, threads).threads).toEqual([
      { id: 'thread-1', kind: 'finding', position: 1.5 / 2 },
    ]);
  });

  it('reuses the change ranges of a file when only its threads change', () => {
    const file = createFile([line('normal', 1, 1), line('add', undefined, 2)]);

    const withoutThreads = buildFileMinimapMarkers(file, []);
    const withThread = buildFileMinimapMarkers(file, [
      createThread({ position: { side: 'new', line: 2 } }),
    ]);

    expect(withThread.changes).toBe(withoutThreads.changes);
    expect(withThread.threads).toHaveLength(1);
  });

  it('returns no markers for a file without lines', () => {
    const file: DiffFile = { ...createFile([]), chunks: [] };
    const threads = [createThread({ position: { side: 'new', line: 1 } })];

    expect(buildFileMinimapMarkers(file, threads)).toEqual({ changes: [], threads: [] });
  });
});

describe('layoutMinimapMarkers', () => {
  const file = createFile([line('normal', 1, 1), line('add', undefined, 2)]);
  const markers = buildFileMinimapMarkers(file, [
    createThread({ position: { side: 'new', line: 1 } }),
  ]);
  const layout: MinimapFileLayout = { top: 100, bodyTop: 140, bodyHeight: 200 };

  it('maps markers into the body span of the file as fractions of the scroll height', () => {
    expect(
      layoutMinimapMarkers([{ path: file.path, markers, layout, isCollapsed: false }], 1000),
    ).toEqual({
      boundaries: [{ key: 'src/a.ts', top: 0.1 }],
      changes: [{ key: 'src/a.ts:0', kind: 'add', top: 0.24, height: 0.1 }],
      threads: [{ key: 'src/a.ts:thread-1', kind: 'comment', top: 0.19 }],
    });
  });

  it('keeps only the boundary for a collapsed file', () => {
    expect(
      layoutMinimapMarkers([{ path: file.path, markers, layout, isCollapsed: true }], 1000),
    ).toEqual({ boundaries: [{ key: 'src/a.ts', top: 0.1 }], changes: [], threads: [] });
  });

  it('returns nothing before the scroll container has a height', () => {
    expect(
      layoutMinimapMarkers([{ path: file.path, markers, layout, isCollapsed: false }], 0),
    ).toEqual({ boundaries: [], changes: [], threads: [] });
  });
});

describe('hasFileLayoutChanged', () => {
  const layouts = new Map<string, MinimapFileLayout>([
    ['src/a.ts', { top: 0, bodyTop: 40, bodyHeight: 200 }],
  ]);

  it('ignores sub-pixel differences', () => {
    const next = new Map([['src/a.ts', { top: 0.4, bodyTop: 40.6, bodyHeight: 199.5 }]]);

    expect(hasFileLayoutChanged(layouts, next)).toBe(false);
  });

  it('detects a moved or resized file', () => {
    const next = new Map([['src/a.ts', { top: 0, bodyTop: 40, bodyHeight: 260 }]]);

    expect(hasFileLayoutChanged(layouts, next)).toBe(true);
  });

  it('detects added or removed files', () => {
    const next = new Map([...layouts, ['src/b.ts', { top: 300, bodyTop: 340, bodyHeight: 10 }]]);

    expect(hasFileLayoutChanged(layouts, next)).toBe(true);
    expect(hasFileLayoutChanged(next, layouts)).toBe(true);
  });
});
