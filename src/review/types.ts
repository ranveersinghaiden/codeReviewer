import type { PrReviewComment } from "./collectors/github.js";

export interface ChangedFileTarget {
  path: string;
  content?: string | null;
  truncated?: boolean;
}

export interface PriorFeedbackCheck {
  comment: PrReviewComment;
}

export interface DuplicateSimilarityCheck {
  path: string;
  isCode: boolean;
}

export interface WorkflowShellFinding {
  line: number;
  message: string;
}

export interface WorkflowShellCheck {
  path: string;
  findings: WorkflowShellFinding[];
  unavailableReason: string | null;
}

export interface ReviewEvidence {
  priorFeedback: PriorFeedbackCheck[];
  duplicateSimilarity: DuplicateSimilarityCheck[];
  workflowShell: WorkflowShellCheck[];
}
