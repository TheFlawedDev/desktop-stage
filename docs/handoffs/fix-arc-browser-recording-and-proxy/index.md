# Task Handoff: Fix Arc Browser Recording Mismatch & Enable Web Browsing via Proxy

- **Task Name:** `fix-arc-browser-recording-and-proxy`
- **Scope Tier:** Lightweight Pipeline (per user instruction)
- **Current Phase:** Phase 4 - Verification Complete & User Sign-Off
- **Owning Agent:** Lead (Host AI / Gemini)
- **Attempt Count:** 1 / 2 (Passed on attempt 1)
- **Allowlisted Files:**
  - `apps/web/next.config.ts`
  - `apps/web/src/app/api/proxy/route.ts`
  - `apps/web/src/features/stage-studio/InteractiveStage.tsx`
  - `apps/web/src/features/editor/PreviewPanel.tsx`
  - `tests/stage-studio/arcBrowserProxyAndCanvas.test.ts`

## Verification Summary
- **Tests:** 60/60 test files passed (1,154/1,154 tests passed; +4 tests added in `tests/stage-studio/arcBrowserProxyAndCanvas.test.ts`).
- **Typecheck:** 17/17 tasks passed (`pnpm typecheck` exit code 0).
- **Build:** Succeeded (`pnpm build` Next.js compiled successfully, exit code 0; `/api/proxy` emitted as dynamic route `ƒ`).
- **Audit Report:** [`docs/handoffs/fix-arc-browser-recording-and-proxy/audit.md`](file:///Users/jorgevelazquez/Documents/Projects/desktop-stage/docs/handoffs/fix-arc-browser-recording-and-proxy/audit.md).
- **Metrics Report:** [`docs/handoffs/fix-arc-browser-recording-and-proxy/metrics.md`](file:///Users/jorgevelazquez/Documents/Projects/desktop-stage/docs/handoffs/fix-arc-browser-recording-and-proxy/metrics.md).
