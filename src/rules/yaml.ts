export const yamlRules: string[] = [
  "Use spaces only, never tabs; be consistent with indentation (2 spaces is the common convention, especially for GitHub Actions).",
  "Child keys must be indented further than their parent; don't mix indentation widths in the same file.",
  "Quote ambiguous scalars that YAML 1.1 could misparse as booleans/other types: yes/no/on/off, version-looking strings, leading-zero numbers.",
  "Keep key naming consistent (snake_case is typical); don't mix naming conventions within one file.",
  "Avoid duplicate keys in the same mapping (silently overwrites and is easy to miss in review).",
  "Pin third-party GitHub Actions to a version/SHA rather than `@main`/`@master` for reproducibility and supply-chain safety.",
  "Remove trailing whitespace and unnecessary blank lines; keep list/mapping formatting consistent throughout the file.",
  "For CI workflow files, verify job/step names are descriptive and secrets are referenced via `${{ secrets.* }}`, never hard-coded.",
];
