import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReviewTabs } from './ReviewTabs';

describe('ReviewTabs', () => {
  it('renders the three tabs with the finding count and marks the active one', () => {
    render(<ReviewTabs activeTab="files" findingCount={3} onChange={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Files changed' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'AI review (3)' })).toBeInTheDocument();
  });

  it('notifies the selected tab', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewTabs activeTab="overview" findingCount={0} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: 'AI review (0)' }));

    expect(onChange).toHaveBeenCalledWith('findings');
  });
});
