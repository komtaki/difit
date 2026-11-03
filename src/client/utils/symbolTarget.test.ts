import { afterEach, describe, expect, it, vi } from 'vitest';

import { findSymbolTarget } from './symbolTarget';

function renderLine(lineAttribute: string | null = '12') {
  document.body.innerHTML = `
    <div data-file-path="src/a.ts">
      <div ${lineAttribute === null ? '' : `data-symbol-line="${lineAttribute}"`}><span data-diff-prefix="true">+</span><span id="code"><span class="word-token" id="const">const</span><span> </span><span class="word-token" id="value">value</span><span id="rest"> = other.call();</span></span></div>
    </div>
  `;
}

const byId = (id: string) => document.getElementById(id);

describe('findSymbolTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
  });

  it('resolves the clicked word token to a 0-based character on the new line', () => {
    renderLine();

    expect(findSymbolTarget({ target: byId('value'), clientX: 0, clientY: 0 })).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      character: 6,
      symbol: 'value',
    });
  });

  it('uses the caret position when the browser provides it', () => {
    renderLine();
    const restText = byId('rest')?.firstChild;
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: vi.fn(() => ({ startContainer: restText, startOffset: 5 })),
    });

    expect(findSymbolTarget({ target: byId('rest'), clientX: 10, clientY: 10 })).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      character: 14,
      symbol: 'other',
    });
  });

  it('ignores clicks outside code on the new side', () => {
    renderLine(null);
    expect(findSymbolTarget({ target: byId('value'), clientX: 0, clientY: 0 })).toBeNull();

    renderLine();
    const prefix = document.querySelector('[data-diff-prefix]');
    expect(findSymbolTarget({ target: prefix, clientX: 0, clientY: 0 })).toBeNull();
  });
});
