import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FindingDisposition = "Open" | "Fixed" | "Superseded" | "Not PR-unique";

export interface ReviewerFindingInput {
  severity: "BLOCKER" | "WARNING" | "SUGGESTION";
  file: string;
  line: number | null;
  message: string;
  recommendation: string;
}

export interface ReviewerFindingRecord extends ReviewerFindingInput {
  id: string;
  disposition: FindingDisposition;
  firstSeenAt: string;
  firstSeenHead: string;
  lastReviewedAt: string;
  lastReviewedHead: string;
  evidence: string;
}

interface FindingsLedger {
  version: 3;
  findings: Record<string, ReviewerFindingRecord[]>;
  reviewSnapshots: Record<string, ReviewSnapshot>;
  reviewRounds: Record<string, number>;
}

interface PersistedFindingsLedger {
  version?: number;
  findings?: Record<string, ReviewerFindingRecord[]>;
  reviewSnapshots?: Record<string, Omit<ReviewSnapshot, "reviewRound"> & { reviewRound?: number }>;
  reviewRounds?: Record<string, number>;
}

export interface ReviewSnapshot {
  headSha: string;
  reviewIds: number[];
  capturedAt: string;
  reviewRound: number;
}

const LEDGER_PATH = path.join(os.homedir(), ".copilot", "code-reviewer", "review-findings.json");

function prKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}/${repo}#${prNumber}`;
}

function fingerprint(finding: ReviewerFindingInput): string {
  const normalizedMessage = finding.message.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update(`${finding.file}\0${finding.line ?? ""}\0${normalizedMessage}`)
    .digest("hex")
    .slice(0, 16);
}

async function loadLedger(): Promise<FindingsLedger> {
  try {
    const parsed = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as PersistedFindingsLedger;
    if (parsed.version === 1 && parsed.findings) {
      return { version: 3, findings: parsed.findings, reviewSnapshots: {}, reviewRounds: {} };
    }
    if (parsed.version === 2 && parsed.findings && parsed.reviewSnapshots) {
      const reviewSnapshots = Object.fromEntries(
        Object.entries(parsed.reviewSnapshots).map(([key, snapshot]) => [
          key,
          { ...snapshot, reviewRound: snapshot.reviewRound ?? 1 },
        ])
      );
      return {
        version: 3,
        findings: parsed.findings,
        reviewSnapshots,
        reviewRounds: Object.fromEntries(
          Object.entries(reviewSnapshots).map(([key, snapshot]) => [key, snapshot.reviewRound])
        ),
      };
    }
    if (parsed.version !== 3 || !parsed.findings || !parsed.reviewSnapshots || !parsed.reviewRounds) {
      throw new Error(`Unsupported reviewer-finding ledger format at ${LEDGER_PATH}.`);
    }
    return parsed as FindingsLedger;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 3, findings: {}, reviewSnapshots: {}, reviewRounds: {} };
    }
    throw error;
  }
}

async function saveLedger(ledger: FindingsLedger): Promise<void> {
  await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  const temporaryPath = `${LEDGER_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(temporaryPath, LEDGER_PATH);
}

export async function getReviewerFindings(
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewerFindingRecord[]> {
  const ledger = await loadLedger();
  return ledger.findings[prKey(owner, repo, prNumber)] ?? [];
}

export async function getReviewerReviewRound(owner: string, repo: string, prNumber: number): Promise<number> {
  const ledger = await loadLedger();
  return ledger.reviewRounds[prKey(owner, repo, prNumber)] ?? 0;
}

export interface FindingReconciliation {
  id?: string;
  disposition: FindingDisposition;
  evidence: string;
  finding?: ReviewerFindingInput;
}

export interface ReviewerFindingFinalization {
  findings: ReviewerFindingRecord[];
  openFindings: ReviewerFindingRecord[];
  reviewSnapshot: ReviewSnapshot;
}

export async function reconcileReviewerFindings(
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  reviewSnapshot: Omit<ReviewSnapshot, "reviewRound">,
  reconciliations: FindingReconciliation[]
): Promise<ReviewerFindingFinalization> {
  if (reviewSnapshot.headSha !== headSha) {
    throw new Error("Reviewer-finding finalization snapshot does not match the reviewed PR head.");
  }
  const ledger = await loadLedger();
  const key = prKey(owner, repo, prNumber);
  const existing = ledger.findings[key] ?? [];
  const existingById = new Map(existing.map((finding) => [finding.id, finding]));
  const reconciledIds = new Set<string>();
  const now = new Date().toISOString();
  const reviewRound = (ledger.reviewRounds[key] ?? 0) + 1;
  const finalizedSnapshot: ReviewSnapshot = { ...reviewSnapshot, reviewRound };

  for (const reconciliation of reconciliations) {
    if (!reconciliation.evidence.trim()) {
      throw new Error("Each reviewer-finding reconciliation requires current source or commit evidence.");
    }

    if (reconciliation.id) {
      const finding = existingById.get(reconciliation.id);
      if (!finding) {
        throw new Error(`Unknown reviewer-finding ledger ID: ${reconciliation.id}.`);
      }
      if (reconciliation.finding) {
        throw new Error(`Existing finding ${reconciliation.id} must not include a replacement finding payload.`);
      }
      if (reconciledIds.has(finding.id)) {
        throw new Error(`Reviewer finding ${finding.id} was reconciled more than once.`);
      }
      finding.disposition = reconciliation.disposition;
      finding.evidence = reconciliation.evidence;
      finding.lastReviewedAt = now;
      finding.lastReviewedHead = headSha;
      reconciledIds.add(finding.id);
      continue;
    }

    if (!reconciliation.finding) {
      throw new Error("New reviewer findings require severity, file, line, message, and recommendation.");
    }
    const id = fingerprint(reconciliation.finding);
    const existingMatch = existingById.get(id);
    if (existingMatch) {
      throw new Error(
        `Finding ${id} already exists. Reconcile it by ID instead of creating a duplicate finding.`
      );
    }
    if (reconciledIds.has(id)) {
      throw new Error(`New reviewer finding ${id} was supplied more than once.`);
    }
    existing.push({
      id,
      ...reconciliation.finding,
      disposition: reconciliation.disposition,
      evidence: reconciliation.evidence,
      firstSeenAt: now,
      firstSeenHead: headSha,
      lastReviewedAt: now,
      lastReviewedHead: headSha,
    });
    reconciledIds.add(id);
  }

  const unaccountedOpen = existing.filter(
    (finding) => finding.disposition === "Open" && !reconciledIds.has(finding.id)
  );
  if (unaccountedOpen.length > 0) {
    throw new Error(
      `Every previously Open reviewer finding must be reconciled before a verdict. Missing: ${unaccountedOpen
        .map((finding) => `${finding.id} (${finding.file}${finding.line === null ? "" : `:${finding.line}`})`)
        .join(", ")}.`
    );
  }

  ledger.findings[key] = existing;
  ledger.reviewSnapshots[key] = finalizedSnapshot;
  ledger.reviewRounds[key] = reviewRound;
  await saveLedger(ledger);
  return {
    findings: existing,
    openFindings: existing.filter((finding) => finding.disposition === "Open"),
    reviewSnapshot: finalizedSnapshot,
  };
}
