import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DiffCommentThread, FindingMeta } from '../../types/diff';

import { FindingsPanel } from './FindingsPanel';

function createFinding(id: string, finding: FindingMeta, line = 10): DiffCommentThread {
  const timestamp = '2024-01-01T00:00:00.000Z';
  return {
    id,
    filePath: 'src/a.ts',
    createdAt: timestamp,
    updatedAt: timestamp,
    position: { side: 'new', line },
    messages: [{ id, body: `Body ${id}`, createdAt: timestamp, updatedAt: timestamp }],
    kind: 'finding',
    finding,
  };
}

const threads = [
  createFinding('a', { reviewer: 'security', severity: 'error', title: 'SQL injection' }),
  createFinding('b', { reviewer: 'correctness', severity: 'warn', title: 'Off by one' }, 20),
  createFinding('c', {
    reviewer: 'security',
    severity: 'info',
    title: 'Weak hash',
    decision: 'rejected',
  }),
];

const renderPanel = () => {
  const onNavigate = vi.fn();
  const onSetFindingDecision = vi.fn();
  render(
    <FindingsPanel
      threads={threads}
      onNavigate={onNavigate}
      onSetFindingDecision={onSetFindingDecision}
    />,
  );
  return { onNavigate, onSetFindingDecision };
};

describe('FindingsPanel', () => {
  it('groups findings by reviewer and hides rejected ones by default', () => {
    renderPanel();

    const security = screen.getByRole('region', { name: 'security' });
    expect(within(security).getByText('SQL injection')).toBeInTheDocument();
    expect(within(security).queryByText('Weak hash')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'correctness' })).getByText('Off by one'),
    ).toBeInTheDocument();
  });

  it('shows rejected findings when the toggle is on', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Show rejected'));

    expect(screen.getByText('Weak hash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('navigates to the finding location when clicked', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPanel();

    await user.click(screen.getByText('Off by one'));

    expect(onNavigate).toHaveBeenCalledWith('b');
    expect(screen.getByText('src/a.ts:20')).toBeInTheDocument();
  });

  it('changes decisions without navigating', async () => {
    const user = userEvent.setup();
    const { onNavigate, onSetFindingDecision } = renderPanel();

    const security = screen.getByRole('region', { name: 'security' });
    await user.click(within(security).getByRole('button', { name: 'Reject' }));

    expect(onSetFindingDecision).toHaveBeenCalledWith('a', 'rejected');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('explains when there are no findings', () => {
    render(<FindingsPanel threads={[]} onNavigate={vi.fn()} onSetFindingDecision={vi.fn()} />);

    expect(screen.getByText('No AI findings to show.')).toBeInTheDocument();
  });
});
