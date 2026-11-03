import type { SymbolTarget } from '../hooks/useSymbolNavigation';

interface SymbolClick {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}

interface Caret {
  node: Node;
  offset: number;
}

const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/g;

function getCaretFromPoint(x: number, y: number): Caret | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

function measureCodeText(lineElement: HTMLElement, caret: Caret) {
  const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
  let text = '';
  let offset: number | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-diff-prefix]')) continue;
    if (offset === null) {
      if (node === caret.node) {
        offset = text.length + caret.offset;
      } else if (caret.node.contains(node)) {
        offset = text.length;
      }
    }
    text += node.textContent ?? '';
  }
  return { text, offset };
}

export function findSymbolTarget({ target, clientX, clientY }: SymbolClick): SymbolTarget | null {
  if (!(target instanceof Element) || target.closest('[data-diff-prefix]')) return null;

  const lineElement = target.closest<HTMLElement>('[data-symbol-line]');
  const filePath = lineElement?.closest<HTMLElement>('[data-file-path]')?.dataset.filePath;
  const line = Number(lineElement?.dataset.symbolLine);
  if (!lineElement || !filePath || !Number.isInteger(line) || line < 1) return null;

  const pointCaret = getCaretFromPoint(clientX, clientY);
  const caret =
    pointCaret && lineElement.contains(pointCaret.node) ? pointCaret : { node: target, offset: 0 };
  const { text, offset } = measureCodeText(lineElement, caret);
  if (offset === null) return null;

  for (const match of text.matchAll(IDENTIFIER_PATTERN)) {
    const start = match.index;
    if (offset >= start && offset < start + match[0].length) {
      return { filePath, line, character: start, symbol: match[0] };
    }
  }
  return null;
}
