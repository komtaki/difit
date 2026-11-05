import type { DiffChunk, DiffFile, DiffViewMode } from '../../types/diff';

const HEADER_HEIGHT = 61;
const COLLAPSED_HEADER_HEIGHT = 59;
const UNIFIED_ROW_HEIGHT = 18;
const SPLIT_ROW_HEIGHT = 24;
const CHUNK_SEPARATOR_HEIGHT = 32;
const PREVIEW_HEIGHT = 300;

const countSplitRows = (chunk: DiffChunk): number => {
  let rows = 0;
  let deletions = 0;
  let additions = 0;
  for (const line of chunk.lines) {
    if (line.type === 'delete') {
      deletions++;
    } else if (line.type === 'add') {
      additions++;
    } else {
      rows += Math.max(deletions, additions) + 1;
      deletions = 0;
      additions = 0;
    }
  }
  return rows + Math.max(deletions, additions);
};

export function estimateFileHeight(
  file: DiffFile,
  diffMode: DiffViewMode,
  isCollapsed: boolean,
): number {
  if (isCollapsed) return COLLAPSED_HEADER_HEIGHT;
  if (file.chunks.length === 0) return HEADER_HEIGHT + PREVIEW_HEIGHT;

  const rowsHeight = file.chunks.reduce(
    (sum, chunk) =>
      sum +
      (diffMode === 'split'
        ? countSplitRows(chunk) * SPLIT_ROW_HEIGHT
        : chunk.lines.length * UNIFIED_ROW_HEIGHT),
    0,
  );
  return HEADER_HEIGHT + rowsHeight + file.chunks.length * CHUNK_SEPARATOR_HEIGHT;
}
