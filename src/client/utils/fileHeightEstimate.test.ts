import { describe, expect, it } from 'vitest';

import type { DiffChunk, DiffFile, DiffLine } from '../../types/diff';

import { estimateFileHeight } from './fileHeightEstimate';

const line = (type: DiffLine['type']): DiffLine => ({ type, content: '' });

const chunk = (lines: DiffLine[]): DiffChunk => ({
  header: '@@',
  oldStart: 1,
  oldLines: 0,
  newStart: 1,
  newLines: 0,
  lines,
});

const createFile = (chunks: DiffChunk[]): DiffFile => ({
  path: 'src/a.ts',
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks,
});

describe('estimateFileHeight', () => {
  const file = createFile([
    chunk([line('normal'), line('delete'), line('delete'), line('add'), line('normal')]),
    chunk([line('add'), line('add')]),
  ]);

  it('counts every diff line as a row in unified mode', () => {
    expect(estimateFileHeight(file, 'unified', false)).toBe(61 + 7 * 18 + 2 * 32);
  });

  it('pairs deletions with additions into shared rows in split mode', () => {
    expect(estimateFileHeight(file, 'split', false)).toBe(61 + 6 * 24 + 2 * 32);
  });

  it('estimates only the header for a collapsed file', () => {
    expect(estimateFileHeight(file, 'unified', true)).toBe(59);
  });

  it('reserves a fixed preview area for a file without diff lines', () => {
    expect(estimateFileHeight(createFile([]), 'unified', false)).toBe(61 + 300);
  });
});
