import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LspLocation, LspStatusResponse } from '../../types/lsp';
import type { SymbolLookup } from '../hooks/useSymbolNavigation';

import { SymbolPanel } from './SymbolPanel';

const fetchMock = vi.fn();

const status: LspStatusResponse = {
  enabled: true,
  servers: [
    { language: 'ruby', state: 'idle' },
    { language: 'typescript', state: 'ready' },
    { language: 'python', state: 'unavailable', detail: 'spawn pyright-langserver ENOENT' },
  ],
};

const location = (overrides: Partial<LspLocation>): LspLocation => ({
  filePath: 'src/b.ts',
  line: 5,
  character: 2,
  inDiff: true,
  preview: ['// before', 'export const value = 1;', '// after'],
  previewStartLine: 4,
  ...overrides,
});

const lookup: SymbolLookup = {
  symbol: 'value',
  origin: { filePath: 'src/a.ts', line: 12, character: 6 },
  definition: [location({})],
  references: [
    location({}),
    location({
      filePath: 'src/c.ts',
      line: 30,
      inDiff: false,
      preview: ['use(value);'],
      previewStartLine: 30,
    }),
    location({
      filePath: '/usr/lib/node/value.d.ts',
      line: 1,
      inDiff: false,
      preview: ['declare const value: number;'],
      previewStartLine: 1,
    }),
  ],
};

const longFile = Array.from({ length: 300 }, (_, index) =>
  index === 4 ? 'export const value = 1;' : `const line${index + 1} = ${index + 1};`,
).join('\n');

const respondWithFile = (content: string) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: `${content}\n` }) });
};

const renderPanel = (overrides: Partial<Parameters<typeof SymbolPanel>[0]> = {}) => {
  const props = {
    status,
    current: lookup,
    view: { filePath: 'src/b.ts', line: 5 },
    isLoading: false,
    error: null,
    canGoBack: false,
    width: 560,
    onOpenLocation: vi.fn(),
    onShowInDiff: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SymbolPanel {...props} />);
  return props;
};

const fileRegion = () => screen.getByRole('region', { name: 'File content' });

const fileRows = () => Array.from(fileRegion().querySelectorAll<HTMLElement>('[data-line-number]'));

const waitForRows = (count: number) => waitFor(() => expect(fileRows()).toHaveLength(count));

describe('SymbolPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the whole viewed file with every line numbered', async () => {
    respondWithFile(longFile);
    renderPanel();

    await waitForRows(300);
    const rows = fileRows();
    expect(rows[0]).toHaveTextContent('1const line1 = 1;');
    expect(rows[299]).toHaveTextContent('300const line300 = 300;');
    expect(fetchMock).toHaveBeenCalledWith('/api/lsp/file?path=src%2Fb.ts');
  });

  it('highlights the viewed line', async () => {
    respondWithFile(longFile);
    renderPanel();

    await waitForRows(300);
    const highlighted = fileRows().filter((row) => row.dataset.targetLine === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveAttribute('data-line-number', '5');
    expect(highlighted[0]).toHaveTextContent('export const value = 1;');
  });

  it('shows the viewed file path in full', async () => {
    respondWithFile('');
    renderPanel({ view: { filePath: 'src/very/deeply/nested/module/b.ts', line: 5 } });

    const path = screen.getByText('src/very/deeply/nested/module/b.ts:5');
    expect(path).not.toHaveClass('truncate');
    expect(path).toHaveClass('break-all');
    await waitForRows(1);
  });

  it('shows loading and file errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'File not found' }) });
    renderPanel();

    expect(screen.getByText('Loading file…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('File not found');
  });

  it('lists references with their count', () => {
    respondWithFile('');
    renderPanel();

    const references = screen.getByRole('region', { name: 'References (3)' });
    expect(within(references).getByText('src/c.ts:30')).toBeInTheDocument();
    expect(within(references).getByText('use(value);')).toBeInTheDocument();
  });

  it('opens repository locations in the panel but not locations outside of it', async () => {
    const user = userEvent.setup();
    respondWithFile('');
    const { onOpenLocation, onShowInDiff } = renderPanel();

    await user.click(screen.getByRole('button', { name: /src\/c\.ts:30/ }));

    expect(onOpenLocation).toHaveBeenCalledWith(lookup.references[1]);
    expect(onShowInDiff).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /value\.d\.ts/ })).not.toBeInTheDocument();
    expect(screen.getByText('/usr/lib/node/value.d.ts:1')).toBeInTheDocument();
  });

  it('opens definition entries in the panel', async () => {
    const user = userEvent.setup();
    respondWithFile('');
    const { onOpenLocation } = renderPanel();

    const definition = screen.getByRole('region', { name: 'Definition' });
    await user.click(within(definition).getByRole('button', { name: /src\/b\.ts:5/ }));

    expect(onOpenLocation).toHaveBeenCalledWith(lookup.definition[0]);
  });

  it('shows locations in the diff only through the show in diff action', async () => {
    const user = userEvent.setup();
    respondWithFile('');
    const { onShowInDiff } = renderPanel();

    const references = screen.getByRole('region', { name: 'References (3)' });
    expect(within(references).getAllByRole('button', { name: 'Show in diff' })).toHaveLength(1);
    await user.click(within(references).getByRole('button', { name: 'Show in diff' }));

    expect(onShowInDiff).toHaveBeenCalledWith('src/b.ts', 5);
  });

  it('jumps to where the lookup started in the diff', async () => {
    const user = userEvent.setup();
    respondWithFile('');
    const { onShowInDiff } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'src/a.ts:12' }));

    expect(onShowInDiff).toHaveBeenCalledWith('src/a.ts', 12);
  });

  it('offers back only when there is a previous view and can be closed', async () => {
    const user = userEvent.setup();
    respondWithFile('');
    const { onBack, onClose } = renderPanel({ canGoBack: true });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Close symbol panel' }));

    expect(onBack).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('hides back without history', () => {
    respondWithFile('');
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('shows language server states, loading and errors', () => {
    renderPanel({ view: null, isLoading: true, error: 'Language server timed out' });

    expect(screen.getByText('Looking up…')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Language server timed out');
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByTitle('spawn pyright-langserver ENOENT')).toHaveTextContent('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the given width', () => {
    renderPanel({ view: null, width: 640 });

    expect(screen.getByRole('complementary').style.width).toBe('640px');
  });
});
