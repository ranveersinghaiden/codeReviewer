import type { PrReviewComment } from "./collectors/github.js";

export interface ChangedFileTarget {
  path: string;
}

export interface PriorFeedbackCheck {
  comment: PrReviewComment;
}

export interface DuplicateSimilarityCheck {
  path: string;
  isCode: boolean;
}

export interface ReviewEvidence {
  priorFeedback: PriorFeedbackCheck[];
  duplicateSimilarity: DuplicateSimilarityCheck[];
}
