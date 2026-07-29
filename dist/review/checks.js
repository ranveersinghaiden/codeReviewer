const CODE_FILE_PATTERN = /\.(?:java|kt|kts|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|cs|cpp|c|h|hpp|php|scala|groovy|sh|bash|zsh)$/i;
/**
 * Creates review obligations for every prior comment and changed file. Semantic
 * comparison remains reviewer judgment; this typed model prevents omission.
 */
export function buildReviewEvidence(priorReviewComments, changedFiles) {
    const priorFeedback = priorReviewComments.map((comment) => ({ comment }));
    const duplicateSimilarity = changedFiles.map((file) => ({
        path: file.path,
        isCode: CODE_FILE_PATTERN.test(file.path),
    }));
    return { priorFeedback, duplicateSimilarity };
}
