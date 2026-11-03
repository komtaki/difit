import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadOnlyFileModal } from './ReadOnlyFileModal';

const fetchMock = vi.fn();

const renderModal = (onClose = vi.fn()) => {
  render(
    <HotkeysProvider initiallyActiveScopes={['navigation']}>
      <ReadOnlyFileModal filePath="lib/helper.rb" line={2} onClose={onClose} />
    </HotkeysProvider>,
  );
  return onClose;
};

describe('ReadOnlyFileModal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the file with the target line highlighted', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'module Helper\n  def call; end\nend\n' }),
    });

    renderModal();

    expect(await screen.findByText('def call; end')).toHaveAttribute('data-target-line', 'true');
    expect(screen.getByText('module Helper')).not.toHaveAttribute('data-target-line');
    expect(screen.getByRole('dialog', { name: 'lib/helper.rb:2' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/lsp/file?path=lib%2Fhelper.rb');
  });

  it('shows the server error message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'File not found' }),
    });

    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent('File not found');
  });

  it('closes with the close button and Escape', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: '' }) });
    const onClose = renderModal();

    await user.click(screen.getByRole('button', { name: 'Close file preview' }));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
