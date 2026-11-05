import type { DiffCommentThread, DiffFile, DiffLine, ThreadKind } from '../../types/diff';
import { getThreadKind } from '../../utils/commentImports';

type MinimapChangeKind = 'add' | 'delete';

interface MinimapChangeRange {
  kind: MinimapChangeKind;
  start: number;
  end: number;
}

interface MinimapThreadMark {
  id: string;
  kind: ThreadKind;
  position: number;
}

export interface FileMinimapMarkers {
  changes: MinimapChangeRange[];
  threads: MinimapThreadMark[];
}

export interface MinimapFileLayout {
  top: number;
  bodyTop: number;
  bodyHeight: number;
}

export interface MinimapFileEntry {
  path: string;
  markers: FileMinimapMarkers;
  layout: MinimapFileLayout;
  isCollapsed: boolean;
}

interface MinimapLayout {
  boundaries: { key: string; top: number }[];
  changes: { key: string; kind: MinimapChangeKind; top: number; height: number }[];
  threads: { key: string; kind: ThreadKind; top: number }[];
}

interface FileLines {
  lines: DiffLine[];
  changes: MinimapChangeRange[];
}

const fileLinesCache = new WeakMap<DiffFile, FileLines>();

const buildChangeRanges = (lines: DiffLine[]): MinimapChangeRange[] => {
  const total = lines.length;
  const changes: MinimapChangeRange[] = [];
  let previousKind: MinimapChangeKind | null = null;
  lines.forEach((line, index) => {
    const kind = line.type === 'add' || line.type === 'delete' ? line.type : null;
    const previous = changes.at(-1);
    if (kind && previous && kind === previousKind) {
      previous.end = (index + 1) / total;
    } else if (kind) {
      changes.push({ kind, start: index / total, end: (index + 1) / total });
    }
    previousKind = kind;
  });
  return changes;
};

const getFileLines = (file: DiffFile): FileLines => {
  const cached = fileLinesCache.get(file);
  if (cached) return cached;
  const lines = file.chunks.flatMap((chunk) => chunk.lines);
  const fileLines = { lines, changes: buildChangeRanges(lines) };
  fileLinesCache.set(file, fileLines);
  return fileLines;
};

const findNearestLineIndex = (lines: DiffLine[], thread: DiffCommentThread): number => {
  const { side, line } = thread.position;
  const target = typeof line === 'number' ? line : line.start;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  lines.forEach((diffLine, index) => {
    const lineNumber = side === 'old' ? diffLine.oldLineNumber : diffLine.newLineNumber;
    if (lineNumber === undefined) return;
    const distance = Math.abs(lineNumber - target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
};

export function buildFileMinimapMarkers(
  file: DiffFile,
  threads: DiffCommentThread[],
): FileMinimapMarkers {
  const { lines, changes } = getFileLines(file);
  const total = lines.length;
  if (total === 0) return { changes, threads: [] };

  return {
    changes,
    threads: threads.map((thread) => ({
      id: thread.id,
      kind: getThreadKind(thread),
      position: (findNearestLineIndex(lines, thread) + 0.5) / total,
    })),
  };
}

export function layoutMinimapMarkers(
  entries: MinimapFileEntry[],
  scrollHeight: number,
): MinimapLayout {
  const result: MinimapLayout = { boundaries: [], changes: [], threads: [] };
  if (scrollHeight <= 0) return result;

  for (const { path, markers, layout, isCollapsed } of entries) {
    result.boundaries.push({ key: path, top: layout.top / scrollHeight });
    if (isCollapsed) continue;

    const toFraction = (position: number) =>
      (layout.bodyTop + position * layout.bodyHeight) / scrollHeight;
    markers.changes.forEach((change, index) => {
      result.changes.push({
        key: `${path}:${index}`,
        kind: change.kind,
        top: toFraction(change.start),
        height: ((change.end - change.start) * layout.bodyHeight) / scrollHeight,
      });
    });
    markers.threads.forEach((thread) => {
      result.threads.push({
        key: `${path}:${thread.id}`,
        kind: thread.kind,
        top: toFraction(thread.position),
      });
    });
  }
  return result;
}

const LAYOUT_TOLERANCE_PX = 1;

export function hasFileLayoutChanged(
  previous: Map<string, MinimapFileLayout>,
  next: Map<string, MinimapFileLayout>,
): boolean {
  if (previous.size !== next.size) return true;
  for (const [path, layout] of next) {
    const before = previous.get(path);
    if (
      !before ||
      Math.abs(before.top - layout.top) >= LAYOUT_TOLERANCE_PX ||
      Math.abs(before.bodyTop - layout.bodyTop) >= LAYOUT_TOLERANCE_PX ||
      Math.abs(before.bodyHeight - layout.bodyHeight) >= LAYOUT_TOLERANCE_PX
    ) {
      return true;
    }
  }
  return false;
}
