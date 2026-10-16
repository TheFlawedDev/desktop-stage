# Audit: fix-arc-browser-recording-and-proxy

- **Auditor:** Auditor (DeepSeek Subagent)
- **Phase:** Phase 3 - Audit
- **Date:** 2026-10-15
- **Scope Tier:** Lightweight Pipeline
- **Raw logs:** `docs/handoffs/fix-arc-browser-recording-and-proxy/logs/`

## Check summary

```
test:      PASS  (1154/1154, 60 files)
typecheck: PASS  (17/17 turbo tasks; see environment note)
lint:      FAIL  (7 errors, all pre-existing at HEAD; 0 new errors introduced)
build:     PASS  (next build compiled, /api/proxy emitted as dynamic route ƒ)
```

| Check | Command | Exit | Result |
|---|---|---|---|
| Tests | `pnpm test` | 0 | PASS — 1154/1154 across 60 files |
| Typecheck | `pnpm typecheck` | 0 | PASS — 17/17 tasks (after stale-artifact cleanup; see below) |
| Lint | `pnpm lint` | 1 | FAIL — 7 errors, all present at HEAD (pre-existing) |
| Build | `pnpm build` | 0 | PASS — compiled + static generation + traces |

## Evidence

### Tests — PASS
- `pnpm test` → `Test Files 60 passed (60)`, `Tests 1154 passed (1154)`.
- Targeted AC test `tests/stage-studio/arcBrowserProxyAndCanvas.test.ts` → 4/4 passed.
- No tests deleted, skipped, or `only`-focused. New test file contains no `.skip`/`.todo`/`.only`.
- Count (1154) satisfies AC-5 (1150+).

### Typecheck — PASS (with environment note)
- First official run `pnpm typecheck` exited **2**. Every reported error came from stale,
  gitignored duplicate generated files under `apps/web/.next/`:
  - `.next/dev/types/cache-life.d 2.ts` → TS6200 (duplicate identifiers)
  - `.next/dev/types/routes.d 2.ts` → TS2717, TS2300
  - **No error referenced any source file.**
- Cause: macOS/iCloud-style `" 2"` duplicate copies of Next.js generated type files
  (timestamps 11:04/12:51, older than the live 14:00 files; a `next dev` server was running
  since 11:03). `tsconfig.json` includes `.next/dev/types/**/*.ts`, so `tsc` saw both copies.
- Action taken: removed only the verified, `git check-ignore`-confirmed stale duplicates
  (5 files + 2 empty dirs). No application source was touched.
- Re-run `pnpm typecheck` → **0**, `17 successful, 17 total`. Re-confirmed after build → **0**.
- A fresh environment that still contains such `" 2"` duplicate copies will fail typecheck
  until they are removed; this is an environment artifact, not a source defect.

### Lint — FAIL (pre-existing, not a regression)
- `pnpm lint` → exit 1: **7 errors, 18 warnings** (`@desktop-stage/web:lint`).
- Errors by file/line: `PreviewPanel.tsx` 447, 458 (`no-explicit-any`);
  `InteractiveStage.tsx` 806, 2189 (`no-explicit-any`) and 2926 ×2 (`no-unescaped-entities`);
  `restoreStoredProject.test.ts` 163 (`no-explicit-any`).
- Baseline check (ESLint over `git show HEAD:<file>`, non-destructive) reproduces the same
  7 errors at HEAD:
  - `PreviewPanel.tsx`: 2 errors (HEAD lines 448, 457)
  - `InteractiveStage.tsx`: 4 errors (HEAD lines 691, 2088, 2817×2)
  - `restoreStoredProject.test.ts`: 1 error (HEAD line 163)
- The two `PreviewPanel.tsx` errors are on unchanged context lines in the diff.
- Conclusion: **0 new lint errors**; the task introduced no lint regression. The spec's gates
  only require tests, typecheck, and build to pass.

### Build — PASS
- `pnpm build` → `Compiled successfully`, `Finished TypeScript`, 4/4 static pages,
  `Tasks: 1 successful, 1 total`.
- Route table confirms the conditional static-export fix works: `/api/proxy` is emitted as a
  **dynamic (ƒ)** route rather than being force-exported.

## Allowlist / workspace check
- `git status` (tracked) shows only allowlisted files modified:
  - `apps/web/next.config.ts`
  - `apps/web/src/features/editor/PreviewPanel.tsx`
  - `apps/web/src/features/stage-studio/InteractiveStage.tsx`
- Untracked task artifact present: `apps/web/src/app/api/proxy/route.ts` (allowlisted path).
- Pre-existing untracked files not added by this task: `tests/stage-studio/customWallpaperRecording.test.ts`,
  `tests/stage-studio/screenSizeAndButtons.test.ts`, `AGENTS.md`, `scripts/deepseek-subagent.mjs`,
  `docs/handoffs/`.
- Auditor modified **no** application source; the only deletions were gitignored `.next` build output.

## Escalation flags
1. **Lint gate (non-blocking per spec):** `pnpm lint` is red, but all 7 errors pre-date this
   change. Lead should decide whether to accept lint as a known baseline failure or open a
   separate cleanup task. Not a regression from this implementation.
2. **Typecheck environment artifact:** stale `" 2"` duplicate generated files can recur if the
   dev server / cloud-sync reproduces them. If reported by the lead, clear the duplicates under
   `apps/web/.next/dev/types/` (gitignored) before running `pnpm typecheck`.
