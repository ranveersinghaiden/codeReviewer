# Cross-Reference Checklist

Apply on every review, referenced from `CodeReviewer.agent.md` Mandatory Checklists.

- **File moves/renames**: any `Path(__file__).resolve().parents[N]` (or
  equivalent) literal must be recomputed for the new depth — actually
  resolve it with a one-off `python3 -c "..."`, don't just eyeball it. Moved
  files' non-code dependencies (fixtures, config, data assets) must move
  with them. Grep the *whole repo*, not just the diff, for stale references
  to the old path/module name.
- **Docs vs. actual code/script behavior**: a doc's usage example must match
  the script's real env-var/flag names. A doc's referenced path must
  actually exist (`ls`/`find`, don't assume).
- **Untrusted input reaching a shell**: any `${{ inputs.* }}` /
  `${{ github.event.* }}` / `${{ steps.*.outputs.* }}` value that originates
  from a workflow_dispatch input or PR-controlled data, interpolated
  directly into a `run:` shell body, is a BLOCKER — require `env:` +
  quoted `"$VAR"` instead, even for values that look "internal." Also check
  CLI-arg validation regexes reject a leading `-`/`--` (option-injection).
- **Dry-run discipline**: don't approve on read-through alone when a
  runnable test suite exists for the changed assertions — regex/path bugs
  are often only caught by running the code.
- **Workflow step ordering (CI/CD YAML)**: read the *full job* top-to-bottom,
  not just the diff hunk. If a step invokes a tool (`python3`, `node`, a
  pinned SDK) that's only guaranteed available via an earlier setup step
  (`actions/setup-python`, `setup-node`, `setup-java`, etc.), confirm that
  setup step actually comes *before* it in that same job. Check every job in
  the file independently — a fix in one job doesn't guarantee the same in a
  sibling job.
- **Protected-file portability/process**: a build-file change that wires a
  new lifecycle step shelling out to a platform-specific interpreter (bash,
  POSIX-only script) and defaults to running unconditionally (no opt-out
  flag defaulting to skip) is worth flagging as a **SUGGESTION** (not a
  WARNING) — a documented, discoverable skip/opt-out for platforms lacking
  the interpreter (e.g. native Windows without WSL/git-bash) is nice-to-have
  polish, not a release-blocking portability defect, unless the repo's own
  rules say otherwise for that specific file.
- **Maven multi-module lifecycle-binding duplication**: when a `pom.xml`
  change adds/wires a plugin execution (e.g. `exec-maven-plugin`,
  `maven-antrun-plugin`) bound to an early, always-run phase
  (`validate`/`initialize`/`generate-sources`) and the *same* binding
  (same `<id>`/goal) is copy-pasted into multiple sibling module `pom.xml`
  files in one PR, grep the whole repo for that execution `<id>` across all
  poms. If it's duplicated across ≥2 modules that participate in the same
  reactor build (a root/parent `mvn clean install` from repo root touches
  all of them), flag a WARNING: the step will re-run once per wired module
  (redundant network calls, repeated overwrite of any shared output
  directory, multiplied chance of transient failure). Suggest moving the
  execution to the root pom with `<inherited>false</inherited>`, or making
  the underlying script idempotent (skip if already synced to the target
  version), before treating it as done.
- **Multi-module `mvn -pl` invocation from CI scripts**: even when a
  lifecycle-bound plugin execution (e.g. `sync-product-experts`) is wired
  correctly and only once per module (no pom duplication issue), check any
  workflow/script that *invokes* Maven against a resolved, possibly-plural
  module list (`-pl "$MODULES"` / `--projects "$MODULES"` where `$MODULES`
  can be a comma-separated string). `mvn -pl "a,b,c" <phase>` builds/runs
  that phase once per listed module — if the bound execution's output is a
  single shared/repo-root destination (not per-module), this redundantly
  repeats the same work once per module in the list, same root problem as
  pom-level duplication above, just triggered by the invocation instead of
  the wiring. Flag a WARNING and suggest running the shared-output step
  against only one representative module (e.g. `${MODULE_ARR[0]}`, after
  validating all listed modules are correctly wired) rather than the full
  comma-list. Check every call site independently — grep the whole
  workflow/script tree for the same `-pl "$MODULES"` pattern, since it's
  often copy-pasted across multiple jobs/files (e.g. an initial-generation
  job and a rejection-retry job in sibling workflow files) and fixing one
  occurrence doesn't guarantee the others were updated too.
