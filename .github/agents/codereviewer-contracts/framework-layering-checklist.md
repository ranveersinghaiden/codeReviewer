# Test Automation Framework Layering Checklist (Playwright/Appium)

Apply on every review, referenced from `CodeReviewer.agent.md` Mandatory Checklists.

- **`WebAction` (Playwright) / `MobileAction` (Appium)**: these low-level
  action classes should contain only raw driver/browser/screen actions
  (click, tap, type, swipe, wait, navigate, find element, etc.) — not
  business logic and not embedded validations/assertions. Treat as a
  judgment call (WARNING, or SUGGESTION if borderline), not an automatic
  BLOCKER — weigh how far the new code strays from the existing pattern.
- **Duplicate/parameterization check (apply before flagging any new method)**:
  before flagging a new `WebAction`/`MobileAction` (or page/screen object)
  method as a layering violation or as new surface area, check whether it
  duplicates an existing method's behavior, differing only in a literal
  (selector, timeout, string, boolean flag). If the same result could be
  achieved by parameterizing an existing method, prefer a SUGGESTION to
  reuse/parameterize over treating it as a new violation — cite the
  specific existing method it overlaps with.
- **Playwright single-init**: Playwright/browser/context must be initialized
  exactly once, in hooks (`Hooks.java`/`@Before`/`@BeforeAll` or equivalent).
  Grep for duplicate `Playwright.create()`/`.launch(` call sites when
  bootstrap code is touched — a second init path is a BLOCKER.
- **Validations placement**: prefer validations/assertions in page or screen
  objects, not in `WebAction`/`MobileAction` or inline in step definitions.
- **Step definitions**: should ideally be thin bindings (Gherkin string →
  page/screen object call) — no business logic, no direct low-level action
  calls, no inline assertions. Flag bulkier step methods as a refactor
  SUGGESTION.
- **Locator strategy**: prefer `id`/class name/stable attribute locators over
  fragile CSS/XPath chains, text-based, or positional selectors — flag
  fragile new locators unless the file already self-documents the
  limitation (e.g. "no stable id found, prefer one if it appears later").

## Scope & Framework-File Flags (from the tool)

- Treat `outOfScopeFiles` (files not sharing the diff's dominant module) as
  a scope-creep signal to explicitly question, not auto-reject.
- Treat framework/protected-file flags as requiring full inspection and
  per-file reporting. An author's explicit PR-description confirmation that
  the protected change is intentional and verified is sufficient process
  evidence; evaluate technical correctness independently and do not require
  a second person's approval.
