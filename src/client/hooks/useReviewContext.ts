import { useCallback, useEffect, useState } from 'react';

import type { ReviewerState } from '../../types/review';
import { fetchJson, isRecord } from '../utils/fetchJson';

import type { ReviewContextEventType } from './useFileWatch';

const isReviewerState = (value: unknown): value is ReviewerState =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  (value.status === 'running' || value.status === 'done') &&
  typeof value.updatedAt === 'string';

async function fetchOverview(): Promise<string | null> {
  const payload = await fetchJson('/api/overview');
  if (!isRecord(payload) || typeof payload.markdown !== 'string') return null;
  return payload.markdown.trim() ? payload.markdown : null;
}

async function fetchReviewers(): Promise<ReviewerState[]> {
  const payload = await fetchJson('/api/reviewers');
  if (!isRecord(payload) || !Array.isArray(payload.reviewers)) return [];
  return payload.reviewers.filter(isReviewerState);
}

export function useReviewContext() {
  const [overview, setOverview] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerState[]>([]);

  const refreshOverview = useCallback(async () => {
    setOverview(await fetchOverview());
  }, []);

  const refreshReviewers = useCallback(async () => {
    setReviewers(await fetchReviewers());
  }, []);

  useEffect(() => {
    void refreshOverview();
    void refreshReviewers();
  }, [refreshOverview, refreshReviewers]);

  const handleReviewContextChanged = useCallback(
    (type: ReviewContextEventType) => {
      void (type === 'overviewChanged' ? refreshOverview() : refreshReviewers());
    },
    [refreshOverview, refreshReviewers],
  );

  return { overview, reviewers, handleReviewContextChanged };
}
