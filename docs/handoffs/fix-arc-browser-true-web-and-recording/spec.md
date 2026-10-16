# Spec: Fix Arc Browser True Web Browsing & Live Recording

## Goal
Enable true unrestricted web browsing in the Arc browser by rewriting in-page links and forms to stay within `/api/proxy`, removing fake intercept UI widgets, connecting real web search, and defaulting to `display-media` for 1:1 live iframe screen recording.

## Type contracts
In `apps/web/src/features/stage-studio/InteractiveStage.tsx`:
```typescript
export function getArcIframeUrl(rawUrl: string): string;
```

In `apps/web/src/app/api/proxy/route.ts`:
```typescript
export async function GET(request: NextRequest): Promise<NextResponse>;
```

## Behavior
1. **In-Page Proxy Interception (`apps/web/src/app/api/proxy/route.ts`)**:
   - In addition to `<base href="${targetUrl}">`, inject an in-page navigation interceptor `<script>`:
     - Intercepts `click` events on `<a>` tags (unless `target="_blank"` or `javascript:`/`#`/`mailto:`) and navigates to `/api/proxy?url=${encodeURIComponent(resolvedUrl)}`.
     - Intercepts `submit` events on `<form>` tags with method `GET` and navigates to `/api/proxy?url=${encodeURIComponent(formUrlWithQueryParams)}`.
   - This ensures continuous browsing across external sites inside the iframe without getting blocked by `X-Frame-Options`.

2. **Real Web Search & No Fake Intercepts (`apps/web/src/features/stage-studio/InteractiveStage.tsx`)**:
   - Remove the fake DuckDuckGo mockup block (`arcActiveUrl.includes("duckduckgo.com") ? (...) : ...`). The real site must render in the `<iframe>`.
   - Update bookmark list:
     - DuckDuckGo: `https://html.duckduckgo.com/html/` (or `https://duckduckgo.com`).
     - Hacker News: `https://news.ycombinator.com` (remove the forced `setArcReaderMode(true)` call).
   - In `handleArcNavigate`: when a user submits a search query (not starting with http/https and without a domain dot), navigate to `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` so the user is taken to real web search results inside the browser iframe.

3. **Recording Fidelity (`apps/web/src/features/editor/PreviewPanel.tsx` & `InteractiveStage.tsx`)**:
   - In `PreviewPanel.tsx`, default `recordingEngine` to `"display-media"` (`🖥️ DisplayMedia — Real 1:1 Live Screen Record`) so clicking "Record Stage" captures the real live browser and DOM by default.
   - In `InteractiveStage.tsx`'s canvas fallback (`drawFrame`), remove the hardcoded static Wikipedia card stub (`en.m.wikipedia.org is an encyclopedia topic documented on Wikipedia...`). Replace it with a clean browser view displaying the real `currentUrlText`, domain, and status.

## Acceptance criteria
- [ ] AC-1: `api/proxy/route.ts` injects in-page link and form interceptor script so clicked links navigate through `/api/proxy?url=...`. (maps to test: `api/proxy route injects navigation interceptor script`)
- [ ] AC-2: `InteractiveStage.tsx` does not contain the fake DuckDuckGo mockup and does not force reader mode on Hacker News bookmark. (maps to test: `InteractiveStage renders real iframe without fake intercepts`)
- [ ] AC-3: `handleArcNavigate` routes web searches to DuckDuckGo HTML search. (maps to test: `handleArcNavigate routes queries to real web search`)
- [ ] AC-4: `PreviewPanel.tsx` defaults `recordingEngine` to `"display-media"`. (maps to test: `PreviewPanel defaults recordingEngine to display-media`)
- [ ] AC-5: Full test suite passes without regressions (1154+ tests).

## Allowed files
- `apps/web/src/app/api/proxy/route.ts`
- `apps/web/src/features/stage-studio/InteractiveStage.tsx`
- `apps/web/src/features/editor/PreviewPanel.tsx`
- `tests/stage-studio/arcBrowserFullWeb.test.ts`

## Out of scope
- Modifying underlying browser security sandbox rules
- Third-party browser extension requirements

## Known risks
- Some sites with complex CAPTCHAs or WebSockets may have limitations, but standard search, reading, documentation, and news sites will browse freely.
