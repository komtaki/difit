import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewerState } from '../../types/review';

import { OverviewPanel } from './OverviewPanel';

const reviewers: ReviewerState[] = [
  { name: 'security', status: 'running', updatedAt: '2024-01-01T00:00:00Z' },
  { name: 'correctness', status: 'done', updatedAt: '2024-01-01T00:00:00Z' },
];

const renderPanel = (markdown: string | null, onOpenFileReference = vi.fn()) => {
  render(
    <OverviewPanel
      markdown={markdown}
      reviewers={reviewers}
      findingCountByReviewer={new Map([['correctness', 2]])}
      isFileInDiff={(filePath) => filePath === 'src/server/server.ts'}
      onOpenFileReference={onOpenFileReference}
    />,
  );
  return onOpenFileReference;
};

describe('OverviewPanel', () => {
  it('renders the overview markdown', () => {
    renderPanel('# Change summary\n\nAdds **review** support.');

    expect(screen.getByRole('heading', { name: 'Change summary' })).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
  });

  it('opens file references that point into the diff', async () => {
    const user = userEvent.setup();
    const onOpenFileReference = renderPanel(
      'See `src/server/server.ts:120` and `src/other.ts:3` and `pnpm build`.',
    );

    await user.click(screen.getByRole('button', { name: 'src/server/server.ts:120' }));

    expect(onOpenFileReference).toHaveBeenCalledWith('src/server/server.ts', 120);
    expect(screen.queryByRole('button', { name: 'src/other.ts:3' })).not.toBeInTheDocument();
    expect(screen.getByText('src/other.ts:3')).toBeInTheDocument();
  });

  it('lists reviewers with their status and finding counts', () => {
    renderPanel(null);

    expect(screen.getByText('No overview has been provided.')).toBeInTheDocument();
    expect(screen.getByText('security')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('done · 2 findings')).toBeInTheDocument();
  });
});
