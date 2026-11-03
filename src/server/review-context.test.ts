import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReviewContext } from './review-context.js';

describe('createReviewContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts without an overview or reviewers', () => {
    const context = createReviewContext();

    expect(context.getOverview()).toBeNull();
    expect(context.getReviewers()).toEqual([]);
  });

  it('stores the overview and reports whether it changed', () => {
    const context = createReviewContext();

    expect(context.setOverview('# Summary')).toBe(true);
    expect(context.setOverview('# Summary')).toBe(false);
    expect(context.getOverview()).toBe('# Summary');
  });

  it('tracks reviewer status in start order', () => {
    const context = createReviewContext();

    context.setReviewerStatus('correctness', 'running');
    context.setReviewerStatus('security', 'running');
    vi.setSystemTime(new Date('2024-01-01T00:01:00.000Z'));
    context.setReviewerStatus('correctness', 'done');

    expect(context.getReviewers()).toEqual([
      { name: 'correctness', status: 'done', updatedAt: '2024-01-01T00:01:00.000Z' },
      { name: 'security', status: 'running', updatedAt: '2024-01-01T00:00:00.000Z' },
    ]);
  });

  it('returns a reviewer to running when started again', () => {
    const context = createReviewContext();

    context.setReviewerStatus('correctness', 'done');
    expect(context.setReviewerStatus('correctness', 'running')).toBe(true);

    expect(context.getReviewers()[0]?.status).toBe('running');
  });

  it('reports no change when the reviewer status is unchanged', () => {
    const context = createReviewContext();

    expect(context.setReviewerStatus('correctness', 'running')).toBe(true);
    expect(context.setReviewerStatus('correctness', 'running')).toBe(false);
  });

  it('returns copies so callers cannot mutate the stored state', () => {
    const context = createReviewContext();
    context.setReviewerStatus('correctness', 'running');

    const [reviewer] = context.getReviewers();
    if (reviewer) reviewer.status = 'done';

    expect(context.getReviewers()[0]?.status).toBe('running');
  });
});
