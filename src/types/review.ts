export type ReviewerStatus = 'running' | 'done';

export interface ReviewerState {
  name: string;
  status: ReviewerStatus;
  updatedAt: string;
}
