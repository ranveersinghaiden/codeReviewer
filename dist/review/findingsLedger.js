import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const LEDGER_PATH = path.join(os.homedir(), ".copilot", "code-reviewer", "review-findings.json");
function prKey(owner, repo, prNumber) {
    return `${owner}/${repo}#${prNumber}`;
}
function fingerprint(finding) {
    const normalizedMessage = finding.message.replace(/\s+/g, " ").trim().toLowerCase();
    return createHash("sha256")
        .update(`${finding.file}\0${finding.line ?? ""}\0${normalizedMessage}`)
        .digest("hex")
        .slice(0, 16);
}
async function loadLedger() {
    try {
        const parsed = JSON.parse(await readFile(LEDGER_PATH, "utf8"));
        if (parsed.version !== 1 || !parsed.findings) {
            throw new Error(`Unsupported reviewer-finding ledger format at ${LEDGER_PATH}.`);
        }
        return parsed;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return { version: 1, findings: {} };
        }
        throw error;
    }
}
async function saveLedger(ledger) {
    await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
    const temporaryPath = `${LEDGER_PATH}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await rename(temporaryPath, LEDGER_PATH);
}
export async function getReviewerFindings(owner, repo, prNumber) {
    const ledger = await loadLedger();
    return ledger.findings[prKey(owner, repo, prNumber)] ?? [];
}
export async function reconcileReviewerFindings(owner, repo, prNumber, headSha, reconciliations) {
    const ledger = await loadLedger();
    const key = prKey(owner, repo, prNumber);
    const existing = ledger.findings[key] ?? [];
    const existingById = new Map(existing.map((finding) => [finding.id, finding]));
    const reconciledIds = new Set();
    const now = new Date().toISOString();
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
            throw new Error(`Finding ${id} already exists. Reconcile it by ID instead of creating a duplicate finding.`);
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
    const unaccountedOpen = existing.filter((finding) => finding.disposition === "Open" && !reconciledIds.has(finding.id));
    if (unaccountedOpen.length > 0) {
        throw new Error(`Every previously Open reviewer finding must be reconciled before a verdict. Missing: ${unaccountedOpen
            .map((finding) => `${finding.id} (${finding.file}${finding.line === null ? "" : `:${finding.line}`})`)
            .join(", ")}.`);
    }
    ledger.findings[key] = existing;
    await saveLedger(ledger);
    return existing;
}
