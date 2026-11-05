import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DiffCommentThread, DiffFile, ThreadKind } from '../../types/diff';
import {
  buildFileMinimapMarkers,
  findScrollAnchor,
  layoutMinimapMarkers,
  resolveScrollAnchor,
  type FileMinimapMarkers,
  type MinimapFileEntry,
  type MinimapFileLayout,
  type MinimapScrollAnchor,
} from '../utils/minimap';

interface DiffMinimapProps {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  files: DiffFile[];
  threads: DiffCommentThread[];
  collapsedFiles: Set<string>;
}

interface Measurement {
  scrollHeight: number;
  fileLayouts: Map<string, MinimapFileLayout>;
}

interface Viewport {
  scrollTop: number;
  clientHeight: number;
}

interface PinnedPosition {
  anchor: MinimapScrollAnchor;
  viewportOffset: number;
}

const PIN_DURATION_MS = 3000;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

const THREAD_MARKER_CLASS: Record<ThreadKind, string> = {
  comment: 'bg-github-warning',
  explanation: 'bg-[var(--color-explanation-accent)]',
  finding: 'bg-[var(--color-finding-accent)]',
};

const toPercent = (fraction: number) => `${fraction * 100}%`;

const measureFileLayouts = (container: HTMLElement): Map<string, MinimapFileLayout> => {
  const contentTop = container.getBoundingClientRect().top - container.scrollTop;
  const layouts = new Map<string, MinimapFileLayout>();
  container.querySelectorAll<HTMLElement>(':scope > [data-file-path]').forEach((fileElement) => {
    const { filePath } = fileElement.dataset;
    if (!filePath) return;
    const fileRect = fileElement.getBoundingClientRect();
    const bodyRect =
      fileElement.querySelector<HTMLElement>('[data-diff-body]')?.getBoundingClientRect() ??
      fileRect;
    layouts.set(filePath, {
      top: fileRect.top - contentTop,
      bodyTop: bodyRect.top - contentTop,
      bodyHeight: bodyRect.height,
    });
  });
  return layouts;
};

export function DiffMinimap({
  scrollContainerRef,
  files,
  threads,
  collapsedFiles,
}: DiffMinimapProps) {
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<number | null>(null);
  const pinnedPositionRef = useRef<PinnedPosition | null>(null);
  const pinTimeoutRef = useRef<number | null>(null);
  const ownScrollTopRef = useRef<number | null>(null);
  const [measurement, setMeasurement] = useState<Measurement>({
    scrollHeight: 0,
    fileLayouts: new Map(),
  });
  const [viewport, setViewport] = useState<Viewport>({ scrollTop: 0, clientHeight: 0 });

  const updateViewport = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setViewport({ scrollTop: container.scrollTop, clientHeight: container.clientHeight });
  }, [scrollContainerRef]);

  const unpinPosition = useCallback(() => {
    if (pinnedPositionRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.style.overflowAnchor = '';
    }
    pinnedPositionRef.current = null;
    if (pinTimeoutRef.current !== null) {
      window.clearTimeout(pinTimeoutRef.current);
      pinTimeoutRef.current = null;
    }
  }, [scrollContainerRef]);

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const fileLayouts = measureFileLayouts(container);
    const pinned = pinnedPositionRef.current;
    const anchorY = pinned ? resolveScrollAnchor(fileLayouts, pinned.anchor) : null;
    if (pinned && anchorY !== null) {
      const targetScrollTop = anchorY - pinned.viewportOffset;
      if (Math.abs(container.scrollTop - targetScrollTop) >= 1) {
        container.scrollTop = targetScrollTop;
        ownScrollTopRef.current = container.scrollTop;
      }
    }
    setMeasurement({ scrollHeight: container.scrollHeight, fileLayouts });
    updateViewport();
  }, [scrollContainerRef, updateViewport]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    measure();

    let measureFrame: number | null = null;
    const scheduleMeasure = () => {
      if (measureFrame !== null) return;
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null;
        measure();
      });
    };
    let scrollFrame: number | null = null;
    const handleScroll = () => {
      const ownScrollTop = ownScrollTopRef.current;
      if (ownScrollTop === null || Math.abs(container.scrollTop - ownScrollTop) >= 1) {
        unpinPosition();
      }
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        updateViewport();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    container
      .querySelectorAll(':scope > [data-file-path]')
      .forEach((fileElement) => resizeObserver.observe(fileElement));
    container.addEventListener('scroll', handleScroll, { passive: true });
    USER_SCROLL_EVENTS.forEach((type) =>
      container.addEventListener(type, unpinPosition, { passive: true }),
    );
    window.addEventListener('keydown', unpinPosition);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
      USER_SCROLL_EVENTS.forEach((type) => container.removeEventListener(type, unpinPosition));
      window.removeEventListener('keydown', unpinPosition);
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
  }, [files, measure, scrollContainerRef, unpinPosition, updateViewport]);

  useEffect(() => unpinPosition, [unpinPosition]);

  const markersByPath = useMemo(() => {
    const threadsByPath = new Map<string, DiffCommentThread[]>();
    for (const thread of threads) {
      const fileThreads = threadsByPath.get(thread.filePath);
      if (fileThreads) {
        fileThreads.push(thread);
      } else {
        threadsByPath.set(thread.filePath, [thread]);
      }
    }
    return new Map<string, FileMinimapMarkers>(
      files.map((file) => [
        file.path,
        buildFileMinimapMarkers(file, threadsByPath.get(file.path) ?? []),
      ]),
    );
  }, [files, threads]);

  const markerElements = useMemo(() => {
    const entries: MinimapFileEntry[] = [];
    for (const [path, markers] of markersByPath) {
      const layout = measurement.fileLayouts.get(path);
      if (!layout) continue;
      entries.push({ path, markers, layout, isCollapsed: collapsedFiles.has(path) });
    }
    const {
      boundaries,
      changes,
      threads: threadMarkers,
    } = layoutMinimapMarkers(entries, measurement.scrollHeight);
    return (
      <>
        {boundaries.map((boundary) => (
          <div
            key={boundary.key}
            data-marker="boundary"
            className="absolute inset-x-0 h-px bg-github-border"
            style={{ top: toPercent(boundary.top) }}
          />
        ))}
        {changes.map((change) => (
          <div
            key={change.key}
            data-marker={change.kind}
            className={`absolute left-1 right-4 min-h-0.5 ${
              change.kind === 'add' ? 'bg-diff-addition-border' : 'bg-github-danger'
            }`}
            style={{ top: toPercent(change.top), height: toPercent(change.height) }}
          />
        ))}
        {threadMarkers.map((thread) => (
          <div
            key={thread.key}
            data-marker={thread.kind}
            className={`absolute right-1 h-1.5 w-2 -translate-y-1/2 rounded-sm ${THREAD_MARKER_CLASS[thread.kind]}`}
            style={{ top: toPercent(thread.top) }}
          />
        ))}
      </>
    );
  }, [collapsedFiles, markersByPath, measurement]);

  const toContentY = (clientY: number) => {
    const container = scrollContainerRef.current;
    const minimap = minimapRef.current;
    if (!container || !minimap) return null;
    const rect = minimap.getBoundingClientRect();
    if (rect.height <= 0) return null;
    return ((clientY - rect.top) / rect.height) * container.scrollHeight;
  };

  const scrollToPointer = (clientY: number, dragOffset: number) => {
    const container = scrollContainerRef.current;
    const contentY = toContentY(clientY);
    if (!container || contentY === null) return;
    container.scrollTop = contentY - dragOffset * container.scrollHeight;
    ownScrollTopRef.current = container.scrollTop;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    const minimap = minimapRef.current;
    if (event.button !== 0 || !container || !minimap || container.scrollHeight <= 0) return;
    event.preventDefault();
    unpinPosition();
    minimap.setPointerCapture(event.pointerId);

    const rect = minimap.getBoundingClientRect();
    const pointer = (event.clientY - rect.top) / rect.height;
    const viewportTop = container.scrollTop / container.scrollHeight;
    const viewportHeight = container.clientHeight / container.scrollHeight;
    const isInsideViewport = pointer >= viewportTop && pointer <= viewportTop + viewportHeight;
    dragOffsetRef.current = isInsideViewport ? pointer - viewportTop : viewportHeight / 2;
    scrollToPointer(event.clientY, dragOffsetRef.current);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOffsetRef.current === null) return;
    scrollToPointer(event.clientY, dragOffsetRef.current);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffsetRef.current = null;
    minimapRef.current?.releasePointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const isDragging = dragOffsetRef.current !== null;
    endDrag(event);
    const container = scrollContainerRef.current;
    const contentY = toContentY(event.clientY);
    if (!isDragging || !container || contentY === null) return;
    const anchor = findScrollAnchor(measureFileLayouts(container), contentY);
    if (!anchor) return;
    pinnedPositionRef.current = { anchor, viewportOffset: contentY - container.scrollTop };
    container.style.overflowAnchor = 'none';
    pinTimeoutRef.current = window.setTimeout(unpinPosition, PIN_DURATION_MS);
  };

  const { scrollHeight } = measurement;
  return (
    <div
      ref={minimapRef}
      data-testid="diff-minimap"
      aria-hidden="true"
      className="relative w-[48px] shrink-0 cursor-pointer touch-none select-none overflow-hidden border-l border-github-border bg-github-bg-secondary"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endDrag}
    >
      {markerElements}
      {scrollHeight > 0 && (
        <div
          data-marker="viewport"
          className="pointer-events-none absolute inset-x-0 border-y border-github-text-muted bg-github-text-primary/10"
          style={{
            top: toPercent(viewport.scrollTop / scrollHeight),
            height: toPercent(Math.min(viewport.clientHeight / scrollHeight, 1)),
          }}
        />
      )}
    </div>
  );
}
