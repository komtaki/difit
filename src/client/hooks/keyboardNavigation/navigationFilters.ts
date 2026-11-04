import type { DiffFile } from '../../../types/diff';
import { getCommentKey } from '../../utils/navigation/domHelpers';
import { hasContentOnSide } from '../../utils/navigation/lineHelpers';
import { findFirstChangePosition } from '../../utils/navigation/positionHelpers';

import type { CommentNavigationItem, CursorPosition, ViewMode } from './types';

function hasCommentAtPosition(
  filePath: string,
  line: DiffFile['chunks'][number]['lines'][number],
  commentIndex: Map<string, CommentNavigationItem[]>,
): boolean {
  const keys: string[] = [];

  if (line.oldLineNumber !== undefined) {
    keys.push(getCommentKey(filePath, line.oldLineNumber, 'old'));
    keys.push(getCommentKey(filePath, line.oldLineNumber));
  }

  if (line.newLineNumber !== undefined) {
    keys.push(getCommentKey(filePath, line.newLineNumber, 'new'));
    keys.push(getCommentKey(filePath, line.newLineNumber));
  }

  return keys.some((key) => commentIndex.has(key));
}

/**
 * Creates navigation filters for different navigation targets
 */
export function createNavigationFilters(
  files: DiffFile[],
  commentIndex: Map<string, CommentNavigationItem[]>,
  viewMode: ViewMode,
  reviewedFiles?: Set<string>,
) {
  const fileEntryPositions = files.map((file, fileIndex) =>
    reviewedFiles?.has(file.path) ? null : findFirstChangePosition(file, fileIndex),
  );

  return {
    /**
     * Line navigation - navigates to lines with content on the current side
     * In unified mode, all lines are navigable
     * In split mode, only lines with content on the current side
     * Skip lines in reviewed/collapsed files
     */
    line: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      return viewMode === 'unified' || hasContentOnSide(pos, files);
    },

    /**
     * Chunk navigation - navigates to the first line of each change chunk
     * Skips normal (unchanged) lines and finds boundaries between chunks
     * Skip chunks in reviewed/collapsed files
     */
    chunk: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      const line = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex];
      if (!line || line.type === 'normal') return false;

      // First line of a chunk is always a chunk boundary
      if (pos.lineIndex === 0) return true;

      // Check if previous line is normal (indicating start of a change chunk)
      const prevLine = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex - 1];
      return !prevLine || prevLine.type === 'normal';
    },

    /**
     * Comment navigation - navigates to lines that have comments
     * Skip comments in reviewed/collapsed files
     */
    comment: (pos: CursorPosition): boolean => {
      const file = files[pos.fileIndex];
      if (!file) return false;

      // Skip if file is reviewed/collapsed
      if (reviewedFiles?.has(file.path)) return false;

      const line = file.chunks[pos.chunkIndex]?.lines[pos.lineIndex];
      if (!line) return false;

      return hasCommentAtPosition(file.path, line, commentIndex);
    },

    /**
     * File navigation - navigates to the first change of each file, or to its
     * first line when the file is reviewed or has no added/deleted lines
     */
    file: (pos: CursorPosition): boolean => {
      const entry = fileEntryPositions[pos.fileIndex];
      if (!entry) return pos.chunkIndex === 0 && pos.lineIndex === 0;
      return pos.chunkIndex === entry.chunkIndex && pos.lineIndex === entry.lineIndex;
    },
  };
}
