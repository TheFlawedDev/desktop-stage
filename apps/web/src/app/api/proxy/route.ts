import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side web proxy for the Arc browser Stage app.
 *
 * Browsers refuse to iframe most external sites because the origin sends
 * `X-Frame-Options` or a `Content-Security-Policy: frame-ancestors` directive.
 * This handler fetches the page server-side, injects a `<base>` tag so
 * relative assets resolve, and deliberately omits those two headers from the
 * response so the proxied document can be embedded.
 *
 * It also neutralises frame-busting scripts that reference `top.location` or
 * `parent.location`, which would otherwise navigate the whole editor away.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": DESKTOP_USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Removes frame-busting scripts. Any `<script>` block that references
 * `top.location`, `parent.location`, or `self.location` is dropped, and the
 * remaining inline assignments to those properties are blanked out.
 */
function stripFrameBustingScripts(html: string): string {
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?(?:top\.location|parent\.location|self\.location)[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(
      /(?:top|parent|self)\.location(?:\.href)?\s*=\s*[^;\n]*;?/gi,
      "",
    );
}

/**
 * Injects `<base href="${targetUrl}">` as the first child of `<head>` so
 * relative links, stylesheets, scripts, and images resolve against the origin
 * page rather than the local proxy.
 */
function injectBaseHref(html: string, targetUrl: string): string {
  const baseTag = `<base href="${targetUrl}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n    ${baseTag}`);
  }
  return `${baseTag}\n${html}`;
}

/**
 * Injects an in-page navigation interceptor `<script>`.
 *
 * When the proxied document is embedded in the Arc iframe, a normal link click
 * or GET form submission would either load the destination directly (and be
 * blocked by `X-Frame-Options`) or navigate the whole editor away. The
 * interceptor rewrites anchors and GET forms so they keep browsing through
 * `/api/proxy?url=...`, giving continuous in-iframe navigation.
 */
function injectNavigationInterceptor(html: string): string {
  const interceptor = `<script>
(function () {
  function toProxyUrl(rawUrl) {
    try {
      var resolved = new URL(rawUrl, document.baseURI).toString();
      return "/api/proxy?url=" + encodeURIComponent(resolved);
    } catch (err) {
      return rawUrl;
    }
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href");
    if (!href) return;
    if (anchor.target && anchor.target.toLowerCase() === "_blank") return;
    if (/^(javascript:|#|mailto:|tel:)/i.test(href)) return;
    event.preventDefault();
    window.location.href = toProxyUrl(href);
  }, true);
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;
    var method = (form.getAttribute("method") || "GET").toUpperCase();
    if (method !== "GET") return;
    event.preventDefault();
    try {
      var action = form.getAttribute("action") || document.baseURI;
      var resolved = new URL(action, document.baseURI);
      var data = new FormData(form);
      data.forEach(function (value, key) {
        resolved.searchParams.set(key, String(value));
      });
      window.location.href = toProxyUrl(resolved.toString());
    } catch (err) {
      /* fall through without navigation */
    }
  }, true);
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${interceptor}\n</body>`);
  }
  return `${html}\n${interceptor}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const targetUrl = request.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return badRequest("Missing url parameter");
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return badRequest("Invalid url parameter");
  }

  if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
    return badRequest("Only http and https URLs can be proxied");
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsedTarget.toString(), {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch the target URL" },
      { status: 502 },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const isHtml = contentType.toLowerCase().includes("text/html");

  if (!isHtml) {
    // Binary/static asset: pipe the bytes through with permissive CORS.
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=3600",
        // Intentionally no X-Frame-Options / CSP frame-ancestors.
      },
    });
  }

  const html = await upstream.text();
  const rewritten = stripFrameBustingScripts(
    injectNavigationInterceptor(injectBaseHref(html, parsedTarget.toString())),
  );

  return new NextResponse(rewritten, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
      // Intentionally omit X-Frame-Options and CSP frame-ancestors so the Arc
      // iframe is allowed to embed the proxied page.
    },
  });
}
