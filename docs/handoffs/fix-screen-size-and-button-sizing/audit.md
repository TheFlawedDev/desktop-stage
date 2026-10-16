# Audit: fix-screen-size-and-button-sizing

- **Phase:** Phase 3 — Audit
- **Auditor:** DeepSeek Subagent (Economy)
- **Date:** 2026-10-15 11:40 MDT
- **Attempt:** 1
- **Verdict:** **CONDITIONAL PASS** — functional checks (test, typecheck, build) all pass; `lint` exits non-zero on pre-existing baseline debt (no new violations from this change). Flagged for lead review.

## Check summary

| Check | Command | Exit | Result | Detail |
|---|---|---|---|---|
| Test | `pnpm test` | 0 | **PASS** | 58 files / 1147 tests passed |
| Typecheck | `pnpm typecheck` | 0 | **PASS** | 17/17 turbo tasks successful |
| Lint | `pnpm lint` | 1 | **FAIL (pre-existing)** | 7 errors, 18 warnings — all on baseline lines |
| Build | `pnpm build` | 0 | **PASS** | Next.js 16.2.10 production build compiled |

Raw logs: `logs/test.log`, `logs/typecheck.log`, `logs/lint.log`, `logs/build.log`.

## Test results

- `Test Files  58 passed (58)`
- `Tests  1147 passed (1147)`
- New suite `tests/stage-studio/screenSizeAndButtons.test.ts` (2 tests) passes.
- Test count is higher than the spec's stated baseline of 57 suites; no tests were deleted or skipped.

## Typecheck results

- `Tasks: 17 successful, 17 total`, exit 0.

## Build results

- `@desktop-stage/web` `next build --webpack` compiled successfully (27.0s), generated static pages, exit 0.

## Lint results (failure — pre-existing)

`pnpm lint` exits 1. Breakdown:

- `apps/web/src/features/editor/PreviewPanel.tsx` — 2 errors, 1 warning (the two `as any` casts on the recording mode/engine `onChange` handlers, unchanged context lines).
- `apps/web/src/features/stage-studio/InteractiveStage.tsx` — 4 errors, 10 warnings (pre-existing `any` and unescaped-entity issues, on lines untouched by this change).
- `apps/web/src/features/stage-studio/StageDebugHUD.tsx` — 3 warnings (untouched file).
- `apps/web/src/features/project/restoreStoredProject.test.ts` — 1 error, 1 warning (untouched file).

**Baseline verification (no working-tree mutation):** the `HEAD` versions of both changed files were linted through `eslint --stdin --stdin-filename`:

- `PreviewPanel.tsx` @ HEAD: 2 errors, 1 warning — identical to current.
- `InteractiveStage.tsx` @ HEAD: 4 errors, 10 warnings — identical to current.

Every reported error/warning also exists on the unmodified baseline; line-number shifts account for the moved locations. This change introduces **no new lint violations**. The failure is repository-wide pre-existing debt, not a regression from this task.

## Acceptance criteria

- [x] AC-1: `computeDesktopDimensions` returns 16:9 → 1280×720, 1:1 → 720×720, 9:16 → 720×1280, 4:5 → 720×900, 21:9 → 1680×720, default → 1280×720. Covered by `screenSizeAndButtons.test.ts`; passes.
- [x] AC-2: `InteractiveStage` accepts `resolution` and derives dynamic desktop dimensions; `shrink-0` present on `stageRef` container; `resolution={resolution}` passed from `PreviewPanel`. Covered by test; passes.
- [x] AC-3: Bottom control bar uses `h-9 shrink-0 px-3`; buttons/selects use `whitespace-nowrap` with compact heights (`h-6.5`/`h-7`) and `text-xs`. Covered by test; passes.
- [x] AC-4: Full suite passes with no regressions (58/58 files, 1147/1147 tests).

## Working tree / scope

`git status --short`:

```
 M apps/web/src/features/editor/PreviewPanel.tsx
 M apps/web/src/features/stage-studio/InteractiveStage.tsx
?? AGENTS.md
?? docs/handoffs/
?? scripts/deepseek-subagent.mjs
?? tests/stage-studio/screenSizeAndButtons.test.ts
```

Both modified source files are on the spec's allowed list. The untracked paths are protocol/handoff artifacts and the new test file, also on the allowed list. No out-of-scope source edits detected.

## Escalation note

- The only failing command is `lint`, which fails for reasons that pre-date this task. It is **not** a regression.
- Auditor does not interpret ambiguous results; per protocol this is flagged for the lead. Recommended lead action: record the pre-existing lint debt as accepted, or open a separate cleanup task. Do not route this back to the Implementer for the current scope, since no changed line contributed a violation.
- Functional acceptance (test + typecheck + build) is green.
