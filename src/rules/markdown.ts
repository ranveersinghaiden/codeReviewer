export const markdownRules: string[] = [
  "Use one H1 (`#`) per document for the title; don't skip heading levels (e.g. H2 straight to H4).",
  "Use ATX-style headings (`#`, `##`) with a space after the hashes, not Setext (`===`/`---`) underlines.",
  "Use fenced code blocks with a language identifier (```ts, ```python) for syntax highlighting; use single backticks for inline code.",
  "Keep bullet/numbered list markers consistent within a list (don't mix `-` and `*`, or `1.` and `1)`).",
  "Use descriptive link text (not 'click here'); provide alt text for images.",
  "Trim trailing whitespace and avoid multiple consecutive blank lines.",
  "Keep documentation in sync with the code change — update README/usage docs when behavior changes in the same PR.",
];
