import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, DiffFile } from '../../types/diff';

import { DiffMinimap } from './DiffMinimap';

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 200;

const files: DiffFile[] = [
  {
    path: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks: [
      {
        header: '@@',
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { type: 'normal', content: '', oldLineNumber: 1, newLineNumber: 1 },
          { type: 'delete', content: '', oldLineNumber: 2 },
          { type: 'add', content: '', newLineNumber: 2 },
          { type: 'normal', content: '', oldLineNumber: 3, newLineNumber: 3 },
        ],
      },
    ],
  },
];

const threads: DiffCommentThread[] = [
  {
    id: 'finding-1',
    filePath: 'src/a.ts',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    position: { side: 'new', line: 2 },
    messages: [],
    kind: 'finding',
    finding: { reviewer: 'correctness', severity: 'warn', title: 't' },
  },
];

const rect = (top: number, height: number) => ({
  top,
  height,
  bottom: top + height,
  left: 0,
  right: 0,
  width: 0,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const NO_COLLAPSED_FILES = new Set<string>();

function Harness({
  collapsedFiles = NO_COLLAPSED_FILES,
  isRendered = true,
}: {
  collapsedFiles?: Set<string>;
  isRendered?: boolean;
}) {
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  return (
    <div>
      <main ref={scrollContainerRef} data-testid="scroll-container">
        <div data-file-path="src/a.ts" data-testid="file">
          {isRendered && <div data-diff-body data-testid="body" />}
        </div>
      </main>
      <DiffMinimap
        scrollContainerRef={scrollContainerRef}
        files={files}
        threads={threads}
        collapsedFiles={collapsedFiles}
      />
    </div>
  );
}

const renderMinimap = (props: { collapsedFiles?: Set<string>; isRendered?: boolean } = {}) => {
  const result = render(<Harness {...props} />);
  const scrollContainer = result.getByTestId('scroll-container');
  const minimap = result.getByTestId('diff-minimap');
  return { ...result, scrollContainer, minimap };
};

let content = { fileTop: 100, fileHeight: 300, bodyTop: 140, bodyHeight: 200 };
let resizeCallbacks: ResizeObserverCallback[] = [];

const scrollTopOfContainer = () =>
  document.querySelector<HTMLElement>('[data-testid="scroll-container"]')?.scrollTop ?? 0;

const resizeContent = async (next: typeof content) => {
  content = next;
  await act(async () => {
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};

describe('DiffMinimap', () => {
  beforeEach(() => {
    content = { fileTop: 100, fileHeight: 300, bodyTop: 140, bodyHeight: 200 };
    resizeCallbacks = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const testId = this.dataset.testid;
        const scrollTop = scrollTopOfContainer();
        if (testId === 'file') return rect(content.fileTop - scrollTop, content.fileHeight);
        if (testId === 'body') return rect(content.bodyTop - scrollTop, content.bodyHeight);
        if (testId === 'diff-minimap') return rect(0, 100);
        return rect(0, CLIENT_HEIGHT);
      },
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(SCROLL_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(CLIENT_HEIGHT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders change, thread and file boundary markers at their scroll positions', () => {
    const { minimap } = renderMinimap();

    const deletion = minimap.querySelector<HTMLElement>('[data-marker="delete"]');
    const addition = minimap.querySelector<HTMLElement>('[data-marker="add"]');
    const finding = minimap.querySelector<HTMLElement>('[data-marker="finding"]');
    const boundary = minimap.querySelector<HTMLElement>('[data-marker="boundary"]');

    expect(deletion?.style.top).toBe('19%');
    expect(deletion?.style.height).toBe('5%');
    expect(addition?.style.top).toBe('24%');
    expect(finding?.style.top).toBe('26.5%');
    expect(boundary?.style.top).toBe('10%');
  });

  it('omits line markers for a collapsed file', () => {
    const { minimap } = renderMinimap({ collapsedFiles: new Set(['src/a.ts']) });

    expect(minimap.querySelector('[data-marker="add"]')).toBeNull();
    expect(minimap.querySelector('[data-marker="finding"]')).toBeNull();
    expect(minimap.querySelector('[data-marker="boundary"]')).not.toBeNull();
  });

  it('spreads markers over the placeholder of a file whose diff is not rendered yet', () => {
    const { minimap } = renderMinimap({ isRendered: false });

    const deletion = minimap.querySelector<HTMLElement>('[data-marker="delete"]');
    expect(deletion?.style.top).toBe('17.5%');
    expect(deletion?.style.height).toBe('7.5%');
  });

  it('shows the visible part of the scroll container as the viewport box', () => {
    const { minimap } = renderMinimap();

    const viewport = minimap.querySelector<HTMLElement>('[data-marker="viewport"]');
    expect(viewport?.style.top).toBe('0%');
    expect(viewport?.style.height).toBe('20%');
  });

  it('centers the clicked position in the viewport', () => {
    const { minimap, scrollContainer } = renderMinimap();

    fireEvent.pointerDown(minimap, { button: 0, clientY: 50, pointerId: 1 });

    expect(scrollContainer.scrollTop).toBe(400);
  });

  it('moves the viewport by the drag distance when dragging the viewport box', () => {
    const { minimap, scrollContainer } = renderMinimap();

    fireEvent.pointerDown(minimap, { button: 0, clientY: 5, pointerId: 1 });
    expect(scrollContainer.scrollTop).toBe(0);

    fireEvent.pointerMove(minimap, { clientY: 35, pointerId: 1 });
    expect(scrollContainer.scrollTop).toBe(300);

    fireEvent.pointerUp(minimap, { clientY: 35, pointerId: 1 });
    fireEvent.pointerMove(minimap, { clientY: 80, pointerId: 1 });
    expect(scrollContainer.scrollTop).toBe(300);
  });

  it('keeps the clicked position in place when the content above it grows', async () => {
    const { minimap, scrollContainer } = renderMinimap();

    fireEvent.pointerDown(minimap, { button: 0, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(minimap, { clientY: 25, pointerId: 1 });
    expect(scrollContainer.scrollTop).toBe(150);

    await resizeContent({ fileTop: 500, fileHeight: 500, bodyTop: 540, bodyHeight: 400 });

    expect(scrollContainer.scrollTop).toBe(660);
  });

  it('stops keeping the position once the user scrolls with the wheel', async () => {
    const { minimap, scrollContainer } = renderMinimap();

    fireEvent.pointerDown(minimap, { button: 0, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(minimap, { clientY: 25, pointerId: 1 });
    fireEvent.wheel(scrollContainer);

    await resizeContent({ fileTop: 500, fileHeight: 500, bodyTop: 540, bodyHeight: 400 });

    expect(scrollContainer.scrollTop).toBe(150);
  });

  it('does not correct the scroll position while dragging', async () => {
    const { minimap, scrollContainer } = renderMinimap();

    fireEvent.pointerDown(minimap, { button: 0, clientY: 25, pointerId: 1 });

    await resizeContent({ fileTop: 500, fileHeight: 500, bodyTop: 540, bodyHeight: 400 });

    expect(scrollContainer.scrollTop).toBe(150);
  });
});
