# Spec: Fix Arc Browser Recording Mismatch & Enable Web Browsing via Proxy

## Goal
Enable full web browsing in the Arc browser by routing external sites through a server-side proxy that strips `X-Frame-Options` and `Content-Security-Policy`, and clarify/improve browser recording fidelity across Canvas and DisplayMedia modes.

## Type contracts
Export helper in `apps/web/src/features/stage-studio/InteractiveStage.tsx`:
```typescript
export function getArcIframeUrl(rawUrl: string): string;
```

Export GET handler in `apps/web/src/app/api/proxy/route.ts`:
```typescript
export async function GET(request: NextRequest): Promise<NextResponse>;
```

## Behavior
1. **Next.js Config (`apps/web/next.config.ts`)**:
   - `output: "export"` must be conditional: only active when `process.env.STATIC_EXPORT === "true"`.
   - Standard builds and dev servers must allow dynamic API Route Handlers.
2. **API Proxy Route (`apps/web/src/app/api/proxy/route.ts`)**:
   - Accepts `url` query parameter. Returns HTTP 400 if `url` is missing or protocol is not `http:` or `https:`.
   - Fetches the target web page with standard desktop User-Agent and headers.
   - For non-HTML content (images, fonts, stylesheets, scripts), pipes binary data with `Content-Type` and `Access-Control-Allow-Origin: *`.
   - For HTML content:
     - Injects `<base href="${targetUrl}">` into `<head>` so relative assets/links resolve correctly.
     - Strips `top.location` and `parent.location` frame-busting scripts.
     - Deliberately omits `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` from the response headers.
3. **InteractiveStage Arc Browser Integration (`apps/web/src/features/stage-studio/InteractiveStage.tsx`)**:
   - `getArcIframeUrl(rawUrl)`:
     - Returns raw URL if empty, or if it already starts with `/api/proxy`, `data:`, or `blob:`.
     - Returns raw URL if it includes `wikipedia.org` (Wikipedia mobile already permits iframe embedding).
     - For other `http://` or `https://` URLs, returns `/api/proxy?url=${encodeURIComponent(rawUrl)}`.
   - The Arc browser `<iframe>` element must use `src={getArcIframeUrl(arcActiveUrl)}`.
   - Bookmark buttons in the Arc browser navigation bar (DuckDuckGo, DevDocs, Example Domain, Hacker News) set the clean target URL into `arcUrl` and `arcActiveUrl`, allowing `getArcIframeUrl` to handle proxying.
4. **Recording Fidelity (`PreviewPanel.tsx` & `InteractiveStage.tsx`)**:
   - In `PreviewPanel.tsx`, the recording engine dropdown options clearly label `display-media` for true 1:1 live iframe screen recording.
   - All existing tests, typechecks, and builds must pass.

## Acceptance criteria
- [ ] AC-1: `getArcIframeUrl` leaves Wikipedia and proxy URLs direct, and proxies other external URLs. (maps to test: `getArcIframeUrl resolves proxy URLs correctly`)
- [ ] AC-2: `apps/web/src/app/api/proxy/route.ts` is implemented, validates input URL, and handles fetching and header stripping. (maps to test: `api/proxy route validates URLs and handles requests`)
- [ ] AC-3: `apps/web/next.config.ts` makes `output: "export"` conditional on `STATIC_EXPORT === "true"`. (maps to test: `next.config.ts has conditional static export`)
- [ ] AC-4: `InteractiveStage.tsx` renders Arc iframe using `getArcIframeUrl(arcActiveUrl)`. (maps to test: `InteractiveStage uses getArcIframeUrl for iframe src`)
- [ ] AC-5: Full test suite passes without regressions (1150+ tests).

## Allowed files
- `apps/web/next.config.ts`
- `apps/web/src/app/api/proxy/route.ts`
- `apps/web/src/features/stage-studio/InteractiveStage.tsx`
- `apps/web/src/features/editor/PreviewPanel.tsx`
- `tests/stage-studio/arcBrowserProxyAndCanvas.test.ts`

## Out of scope
- Modifying underlying browser security sandbox rules
- Third-party browser extension requirements

## Known risks
- Some complex JavaScript-heavy web applications may perform origin checks; standard static/reading web content works seamlessly.
