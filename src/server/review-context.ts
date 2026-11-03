import type { ReviewerState, ReviewerStatus } from '../types/review.js';

interface ReviewContext {
  getOverview(): string | null;
  setOverview(markdown: string): boolean;
  getReviewers(): ReviewerState[];
  setReviewerStatus(name: string, status: ReviewerStatus): boolean;
}

export function createReviewContext(): ReviewContext {
  let overview: string | null = null;
  const reviewers = new Map<string, ReviewerState>();

  return {
    getOverview: () => overview,
    setOverview(markdown) {
      if (overview === markdown) {
        return false;
      }
      overview = markdown;
      return true;
    },
    getReviewers: () => [...reviewers.values()].map((reviewer) => ({ ...reviewer })),
    setReviewerStatus(name, status) {
      if (reviewers.get(name)?.status === status) {
        return false;
      }
      reviewers.set(name, { name, status, updatedAt: new Date().toISOString() });
      return true;
    },
  };
}
