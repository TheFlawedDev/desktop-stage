# Audit: fix-custom-wallpaper-recording

- **Phase:** Phase 3 — Audit
- **Auditor:** DeepSeek Subagent (Economy)
- **Date:** 2026-10-15 12:53 MDT
- **Attempt:** 1
- **Verdict:** **CONDITIONAL PASS** — functional checks (`test`, `typecheck`, `build`) all pass; `lint` exits non-zero on pre-existing repository baseline debt with **no new violations** from this change. Flagged for lead review.

## Check summary

| Check | Command | Exit | Result | Detail |
|---|---|---|---|---|
| Test | `pnpm test` | 0 | **PASS** | 59 files / 1150 tests passed |
| Typecheck | `pnpm typecheck` | 0 | **PASS** | 17/17 turbo tasks successful |
| Lint | `pnpm lint` | 1 | **FAIL (pre-existing)** | 7 errors, 18 warnings — same counts/locations as the prior audit baseline |
| Build | `pnpm build` | 0 | **PASS** | Next.js 16.2.10 production build compiled, static pages generated |

Raw logs: `logs/test.log`, `logs/typecheck.log`, `logs/lint.log`, `logs/build.log` (plus `*.exit`).

## Test results

- `Test Files  59 passed (59)`
- `Tests  1150 passed (1150)`
- New suite `tests/stage-studio/customWallpaperRecording.test.ts` (3 tests) passes:
  - AC-1 `computeWallpaperCoverDimensions` cover-crop geometry (wider / taller / exact).
  - AC-2 live `wallpaperRef` presence and `drawFrame` reading `wallpaperRef.current === "custom"`.
  - AC-3 `useImperativeHandle` dependency array contains `wallpaper` and `customWallpaperUrl`.
- Test count increased vs. the previous audit's 58 files / 1147 tests (+1 file, +3 tests). No tests were deleted or skipped.

## Typecheck results

- `Tasks: 17 successful, 17 total`, exit 0.

## Build results

- `@desktop-stage/web` `next build --webpack` — `✓ Compiled successfully`, `Finished TypeScript`, static pages generated, exit 0.

## Lint results (failure — pre-existing)

`pnpm lint` exits 1 with **25 problems (7 errors, 18 warnings)**. This is the identical count reported at baseline in the immediately preceding audit (`docs/handoffs/fix-screen-size-and-button-sizing/audit.md`: 7 errors, 18 warnings).

Violations by file:

- `apps/web/src/features/editor/PreviewPanel.tsx` — 2 errors, 1 warning (pre-existing `any` casts / unused import; file belongs to the prior task, not this one).
- `apps/web/src/features/stage-studio/InteractiveStage.tsx` — 4 errors, 10 warnings (errors: `any` at 778, 2161; unescaped `"` at 2898; warnings: unused imports, `react-hooks/exhaustive-deps` at 520, 529, 2243).
- `apps/web/src/features/project/restoreStoredProject.test.ts` — 1 error, 1 warning (untouched file).
- `apps/web/src/features/stage-studio/StageDebugHUD.tsx` — 3 warnings (untouched file).
- `apps/web/src/features/stage-studio/__tests__/interactiveStage.test.ts` — 3 warnings (untouched file).

**No new violations:** none of the reported lines correspond to this task's additions (the `wallpaperRef`/`customWallpaperUrlRef` declarations at ~341–347, the `img.crossOrigin` / `img.complete` handling at ~354 and ~2395, the exported `computeWallpaperCoverDimensions` helper at ~64–92, or the `wallpaperRef.current` reads in `drawFrame` at ~1047–1083). The failure is repository-wide pre-existing debt, not a regression from this task.

## Acceptance criteria

- [x] AC-1: `computeWallpaperCoverDimensions` returns cover geometry — wider image matches height and centers X; taller/matching image matches width and centers Y. Covered by `customWallpaperRecording.test.ts`; passes.
- [x] AC-2: `InteractiveStage` maintains `const wallpaperRef = useRef(wallpaper);`, `wallpaperRef.current = wallpaper;`, `customWallpaperUrlRef` equivalent, and `drawFrame` reads `wallpaperRef.current` for both custom wallpaper and preset gradients. Covered by test; passes.
- [x] AC-3: `useImperativeHandle` dependency array (lines 2243–2255) includes `wallpaper` and `customWallpaperUrl`. Covered by test; passes.
- [x] AC-4: Full test suite passes with no regressions (59/59 files, 1150/1150 tests).

## Working tree / scope

`git status --short`:

```
 M apps/web/src/features/editor/PreviewPanel.tsx
 M apps/web/src/features/stage-studio/InteractiveStage.tsx
?? AGENTS.md
?? docs/handoffs/
?? scripts/deepseek-subagent.mjs
?? tests/stage-studio/customWallpaperRecording.test.ts
?? tests/stage-studio/screenSizeAndButtons.test.ts
```

- `InteractiveStage.tsx` and `customWallpaperRecording.test.ts` are on this task's allowlist.
- `PreviewPanel.tsx` and `tests/stage-studio/screenSizeAndButtons.test.ts` are carry-over from the sibling `fix-screen-size-and-button-sizing` task still uncommitted in the working tree; they are outside this task's allowlist but were not touched by this change.
- `AGENTS.md`, `docs/handoffs/`, and `scripts/deepseek-subagent.mjs` are protocol/handoff artifacts.
- No out-of-scope source edits attributable to this task were detected.

## Escalation note

- The only failing command is `lint`, which fails for reasons that pre-date this task and match the prior audit's baseline exactly. It is **not** a regression.
- Per protocol, the Auditor does not interpret ambiguous results: flagged for the lead. Recommended action: record the pre-existing lint debt as accepted (or open a separate cleanup task); do not route this back to the Implementer, since no changed line contributed a violation.
- Functional acceptance (`test` + `typecheck` + `build`) is green.
