# Audit: fix-arc-browser-true-web-and-recording

- **Auditor:** Auditor (DeepSeek Subagent, Economy)
- **Phase:** Phase 3 — Audit
- **Date:** 2026-10-15 14:31 MDT
- **Scope Tier:** Lightweight Pipeline
- **Attempt:** 1
- **Verdict:** **CONDITIONAL PASS** — functional gates (`test`, `typecheck`, `build`) all pass; `lint` exits non-zero on pre-existing baseline debt with **0 new violations** from this change. Flagged for lead review.

## Check summary

```
test:      PASS  (1158/1158, 61 files)
typecheck: PASS  (17/17 turbo tasks)
lint:      FAIL  (7 errors, all present at HEAD; 0 new errors introduced)
build:     PASS  (next build compiled; /api/proxy emitted as dynamic route ƒ)
```

| Check | Command | Exit | Result | Detail |
|---|---|---|---|---|
| Tests | `pnpm test` | 0 | **PASS** | 61 files / 1158 tests passed |
| Typecheck | `pnpm typecheck` | 0 | **PASS** | 17/17 turbo tasks successful |
| Lint | `pnpm lint` | 1 | **FAIL (pre-existing)** | 7 errors, 19 warnings — all baseline debt |
| Build | `pnpm build` | 0 | **PASS** | Next.js 16.2.10 production build; `/api/proxy` dynamic |

Raw logs (this folder): `logs/test.log`, `logs/typecheck.log`, `logs/lint.log`, `logs/build.log`.

## Test results — PASS

- `Test Files  61 passed (61)`, `Tests  1158 passed (1158)`, exit 0.
- Full suite includes the task's new suite `tests/stage-studio/arcBrowserFullWeb.test.ts` → **4/4 passed**.
- Re-ran the target suite in isolation: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- No tests deleted, skipped, or focused: no `.skip` / `.only` / `.todo` in the new or adjacent task suites.
- Count (1158) is 4 higher than the previous task baseline (1154) and satisfies AC-5 (1154+). No regressions.

## Typecheck results — PASS

- `pnpm typecheck` → exit 0, `Tasks: 17 successful, 17 total` (16 cached, 1 executed: `@desktop-stage/web`).

## Lint results — FAIL (pre-existing, not a regression)

- `pnpm lint` → exit 1: **7 errors, 19 warnings** (`@desktop-stage/web:lint`). Only `@desktop-stage/web` defines a lint script.
- Errors by file/line (working tree):
  - `apps/web/src/features/editor/PreviewPanel.tsx` — 445:71, 456:73 (`@typescript-eslint/no-explicit-any`)
  - `apps/web/src/features/stage-studio/InteractiveStage.tsx` — 806:19, 2146:25 (`no-explicit-any`); 2882:89, 2882:106 (`react/no-unescaped-entities`)
  - `apps/web/src/features/project/restoreStoredProject.test.ts` — 163:124 (`no-explicit-any`, untouched file)
- **Baseline verification (non-destructive):** linted the `HEAD` revision of each changed file through `eslint --stdin --stdin-filename`, without touching the working tree:
  - `HEAD:PreviewPanel.tsx` → same 2 errors (HEAD lines 448, 457).
  - `HEAD:InteractiveStage.tsx` → same 4 errors (HEAD lines 691, 2088, 2817 ×2).
  - Every current error also exists on the unmodified baseline; only line numbers shifted due to the diff. The two `PreviewPanel.tsx` errors are on unchanged context lines.
- **New files produced no lint errors:** `apps/web/src/app/api/proxy/route.ts` and `tests/stage-studio/arcBrowserFullWeb.test.ts` do not appear in the lint output.
- Conclusion: **0 new lint violations**. This is repository-wide pre-existing debt, not a regression from this task. The spec's explicit gates are tests, typecheck, and build.

## Build results — PASS

- `pnpm build` → exit 0, `Tasks: 1 successful, 1 total`.
- `next build --webpack` compiled successfully, TypeScript finished, 4/4 static pages generated.
- Route table confirms the conditional static-export config works:
  - `○ /` (static)
  - `○ /_not-found` (static)
  - **`ƒ /api/proxy` (dynamic, server-rendered on demand)** — required so the proxy route can run and strip `X-Frame-Options` / CSP.

## Acceptance criteria

- [x] AC-1: `api/proxy/route.ts` injects in-page link + form interceptor script → covered by `api/proxy route injects navigation interceptor script`; passes.
- [x] AC-2: `InteractiveStage.tsx` has no fake DuckDuckGo mockup and no forced reader mode on the Hacker News bookmark → covered by `InteractiveStage renders real iframe without fake intercepts`; passes.
- [x] AC-3: `handleArcNavigate` routes web-search queries to DuckDuckGo HTML → covered by `handleArcNavigate routes queries to real web search`; passes.
- [x] AC-4: `PreviewPanel.tsx` defaults `recordingEngine` to `"display-media"` → covered by `PreviewPanel defaults recordingEngine to display-media`; passes.
- [x] AC-5: Full suite passes with no regressions (61/61 files, 1158/1158 tests).

## Working tree / scope check

`git status --porcelain` (relative to `HEAD`):

```
 M apps/web/next.config.ts
 M apps/web/src/features/editor/PreviewPanel.tsx
 M apps/web/src/features/stage-studio/InteractiveStage.tsx
?? AGENTS.md
?? apps/web/src/app/api/
?? docs/handoffs/
?? scripts/deepseek-subagent.mjs
?? tests/stage-studio/arcBrowserFullWeb.test.ts
?? tests/stage-studio/arcBrowserProxyAndCanvas.test.ts
?? tests/stage-studio/customWallpaperRecording.test.ts
?? tests/stage-studio/screenSizeAndButtons.test.ts
```

- This task's allowlisted artifacts are present and modified/added: `PreviewPanel.tsx`, `InteractiveStage.tsx`, `apps/web/src/app/api/proxy/route.ts`, `tests/stage-studio/arcBrowserFullWeb.test.ts`.
- `apps/web/next.config.ts` is modified but is **not on this task's allowlist**. Its mtime (14:00) predates this task's implementation writes (14:28–14:29) and it was on the allowlist of the earlier `fix-arc-browser-recording-and-proxy` task, so it is carried-over uncommitted work from that task rather than an edit by this task's Implementer. Flagged for the lead to confirm.
- The other untracked test files (`arcBrowserProxyAndCanvas.test.ts`, `customWallpaperRecording.test.ts`, `screenSizeAndButtons.test.ts`) and protocol files (`AGENTS.md`, `scripts/deepseek-subagent.mjs`, `docs/handoffs/`) are pre-existing/out-of-task artifacts, not produced by this change.
- The **Auditor modified no application source code**. The only files written were this `audit.md` and raw logs under `logs/`.

## Escalation flags

1. **Lint gate (non-blocking per spec):** `pnpm lint` is red, but all 7 errors pre-date this change (verified against `HEAD`). Recommend the lead accept lint as known baseline debt or open a separate cleanup task; do not route back to the Implementer, since no changed line contributed a violation.
2. **Out-of-allowlist file `apps/web/next.config.ts`:** modified in the working tree but not on this task's allowlist. Evidence indicates it is inherited from the prior `fix-arc-browser-recording-and-proxy` task and is functionally required for `/api/proxy` to build as a dynamic route (build confirms `ƒ /api/proxy`). Lead should confirm it is intended.
- No ambiguous results; no other failures to escalate.
