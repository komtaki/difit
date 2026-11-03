import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { LspLocation, LspStatusResponse } from '../../types/lsp';
import type { SymbolLookup } from '../hooks/useSymbolNavigation';

import { SymbolPanel } from './SymbolPanel';

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

const renderPanel = (overrides: Partial<Parameters<typeof SymbolPanel>[0]> = {}) => {
  const props = {
    status,
    current: lookup,
    isLoading: false,
    error: null,
    canGoBack: false,
    onSelectLocation: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SymbolPanel {...props} />);
  return props;
};

describe('SymbolPanel', () => {
  it('shows the definition preview with the target line marked', () => {
    renderPanel();

    const definition = screen.getByRole('region', { name: 'Definition' });
    expect(within(definition).getByText('export const value = 1;')).toHaveAttribute(
      'data-target-line',
      'true',
    );
    expect(within(definition).getByText('// before')).not.toHaveAttribute('data-target-line');
  });

  it('lists references with their count', () => {
    renderPanel();

    const references = screen.getByRole('region', { name: 'References (3)' });
    expect(within(references).getByText('src/c.ts:30')).toBeInTheDocument();
    expect(within(references).getByText('use(value);')).toBeInTheDocument();
  });

  it('selects locations inside the repository but not outside of it', async () => {
    const user = userEvent.setup();
    const { onSelectLocation } = renderPanel();

    await user.click(screen.getByRole('button', { name: /src\/c\.ts:30/ }));

    expect(onSelectLocation).toHaveBeenCalledWith(lookup.references[1]);
    expect(screen.queryByRole('button', { name: /value\.d\.ts/ })).not.toBeInTheDocument();
    expect(screen.getByText('/usr/lib/node/value.d.ts:1')).toBeInTheDocument();
  });

  it('jumps back to where the lookup started', async () => {
    const user = userEvent.setup();
    const { onSelectLocation } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'src/a.ts:12' }));

    expect(onSelectLocation).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'src/a.ts', line: 12, inDiff: true }),
    );
  });

  it('offers back only when there is a previous lookup and can be closed', async () => {
    const user = userEvent.setup();
    const { onBack, onClose } = renderPanel({ canGoBack: true });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Close symbol panel' }));

    expect(onBack).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('hides back without history', () => {
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('shows language server states, loading and errors', () => {
    renderPanel({ isLoading: true, error: 'Language server timed out' });

    expect(screen.getByText('Looking up…')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Language server timed out');
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByTitle('spawn pyright-langserver ENOENT')).toHaveTextContent('unavailable');
  });
});
