// @vitest-environment jsdom
/// <reference lib="dom" />
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import type { ITemplateSanitizer } from "@cutaway/types";
import { TemplateSanitizer } from "../../packages/desktop-engine/src/stage/apps/index";

const DANGEROUS_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "template",
  "form",
];

const DATA_SLOTS = ["content", "title", "icon"];
const DATA_ACTIONS = [
  "close",
  "minimize",
  "maximize",
  "back",
  "forward",
  "reload",
  "play",
  "pause",
];

function parse(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

/**
 * Structural safety check: dangerous input must be gone from the parsed DOM,
 * not merely absent from the serialized string.
 */
function expectStructurallySafe(html: string): HTMLElement {
  const container = parse(html);
  for (const tag of DANGEROUS_TAGS) {
    expect(container.querySelectorAll(tag), `unexpected <${tag}>`).toHaveLength(0);
  }

  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      expect(name.startsWith("on"), `event handler ${name} survived`).toBe(false);
      expect(["id", "style", "href", "srcset", "form", "srcdoc", "formaction"]).not.toContain(
        name,
      );
      if (name === "src") {
        expect(value.trim().toLowerCase()).toMatch(
          /^(blob:[^\s]+|data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+)$/i,
        );
      }
      if (name === "data-slot") {
        expect(DATA_SLOTS).toContain(value);
      }
      if (name === "data-action") {
        expect(DATA_ACTIONS).toContain(value);
      }
    }

    if (element.tagName === "INPUT" || element.tagName === "BUTTON") {
      const type = element.getAttribute("type");
      if (type !== null) {
        expect(["text", "button"]).toContain(type.toLowerCase());
      }
    }
  }

  const serialized = container.innerHTML.toLowerCase();
  expect(serialized).not.toContain("<script");
  expect(serialized).not.toContain("javascript:");
  expect(serialized).not.toContain("srcdoc");
  return container;
}

describe("TemplateSanitizer", () => {
  let sanitizer: TemplateSanitizer;

  beforeEach(() => {
    sanitizer = new TemplateSanitizer(document);
  });

  it("conforms to the shared ITemplateSanitizer contract", () => {
    expectTypeOf<TemplateSanitizer>().toMatchTypeOf<ITemplateSanitizer>();
  });

  describe("sanitizeHtml", () => {
    it("keeps the safe tag and attribute vocabulary", () => {
      const out = sanitizer.sanitizeHtml(
        '<div class="card" title="t" role="group" aria-label="x" data-slot="content" data-action="close">' +
          "<header><h1>Hi</h1></header><p>Body</p>" +
          '<button type="button">Go</button>' +
          '<input type="text" placeholder="p" value="v" disabled />' +
          "</div>",
      );
      const container = parse(out);

      expect(container.querySelector("div.card")).not.toBeNull();
      expect(container.querySelector("h1")?.textContent).toBe("Hi");
      expect(container.querySelector("p")?.textContent).toBe("Body");
      expect(container.querySelector("button")?.getAttribute("type")).toBe("button");
      expect(container.querySelector('[data-slot="content"]')).not.toBeNull();
      expect(container.querySelector('[data-action="close"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="x"]')).not.toBeNull();
      expect(container.querySelector('[role="group"]')).not.toBeNull();
      expect(container.querySelector('[title="t"]')).not.toBeNull();

      const input = container.querySelector("input");
      expect(input?.getAttribute("type")).toBe("text");
      expect(input?.getAttribute("placeholder")).toBe("p");
      expect(input?.getAttribute("value")).toBe("v");
      expect(input?.hasAttribute("disabled")).toBe(true);
    });

    it("removes dangerous elements together with their descendants", () => {
      const cases = [
        ['<div>a<script>alert("pwned")</script>b</div>', "ab", "pwned"],
        ['<style>body{background:url("https://evil.example/x")}</style><p>ok</p>', "ok", "evil"],
        ["<iframe src=\"https://evil.example\"></iframe>", "", "evil"],
        ['<object data="https://evil.example"></object>', "", "evil"],
        ['<embed src="https://evil.example/x.swf">', "", "evil"],
        ['<link rel="stylesheet" href="https://evil.example/x.css">', "", "evil"],
        ['<meta http-equiv="refresh" content="0;url=https://evil.example">', "", "evil"],
        ['<base href="https://evil.example/">', "", "evil"],
        ["<svg><script>alert(1)</script><circle /></svg>", "", "alert"],
        ["<math><mtext>boom</mtext></math>", "", "boom"],
        ["<template><div>hidden</div></template>", "", "hidden"],
      ] as const;

      for (const [raw, expectedText, mustNotContain] of cases) {
        const out = sanitizer.sanitizeHtml(raw);
        const container = expectStructurallySafe(out);
        expect(container.textContent?.trim() ?? "").toBe(expectedText);
        expect(out.toLowerCase()).not.toContain(mustNotContain);
      }
    });

    it("unwraps harmless unknown tags but keeps their text", () => {
      const out = sanitizer.sanitizeHtml(
        '<custom-el class="x">hello</custom-el><font color="red">red</font><table><tr><td>cell</td></tr></table>',
      );
      const container = expectStructurallySafe(out);

      expect(container.querySelector("custom-el")).toBeNull();
      expect(container.querySelector("font")).toBeNull();
      expect(container.querySelector("table")).toBeNull();
      expect(container.querySelector("td")).toBeNull();
      expect(container.textContent).toBe("helloredcell");
    });

    it("strips id, style, event handlers, href, srcset, form and srcdoc", () => {
      const out = sanitizer.sanitizeHtml(
        '<div id="main" style="color:red" onclick="alert(1)" onmouseover="x()" class="keep" form="f" srcdoc="<script>1</script>">text</div>' +
          '<img alt="a" src="https://evil.example/x.png" srcset="https://evil.example/x.png 2x" />',
      );
      const container = expectStructurallySafe(out);

      const div = container.querySelector("div");
      expect(div?.getAttribute("class")).toBe("keep");
      expect(div?.hasAttribute("id")).toBe(false);
      expect(div?.hasAttribute("style")).toBe(false);
      expect(div?.hasAttribute("onclick")).toBe(false);
      expect(div?.hasAttribute("onmouseover")).toBe(false);
      expect(div?.hasAttribute("form")).toBe(false);
      expect(div?.hasAttribute("srcdoc")).toBe(false);

      const img = container.querySelector("img");
      expect(img?.getAttribute("alt")).toBe("a");
      expect(img?.hasAttribute("src")).toBe(false);
      expect(img?.hasAttribute("srcset")).toBe(false);
    });

    it("restricts data-slot and data-action to the documented values", () => {
      const out = sanitizer.sanitizeHtml(
        '<div><span data-slot="content">1</span><span data-slot="title">2</span><span data-slot="icon">3</span>' +
          '<span data-slot="header">4</span><span data-slot="style">5</span></div>' +
          DATA_ACTIONS.map((action) => `<button data-action="${action}">${action}</button>`).join("") +
          '<button data-action="delete">x</button><button data-action="eval">y</button>',
      );
      const container = expectStructurallySafe(out);

      for (const slot of DATA_SLOTS) {
        expect(container.querySelectorAll(`[data-slot="${slot}"]`)).toHaveLength(1);
      }
      expect(container.querySelectorAll("[data-slot]")).toHaveLength(3);
      expect(container.querySelectorAll("[data-action]")).toHaveLength(DATA_ACTIONS.length);
      expect(container.querySelector('[data-action="delete"]')).toBeNull();
      expect(container.querySelector('[data-action="eval"]')).toBeNull();
    });

    it("restricts input and button types", () => {
      const out = sanitizer.sanitizeHtml(
        '<input type="password" /><input type="hidden" /><input type="submit" />' +
          '<input type="text" /><input type="button" />' +
          '<button type="submit">s</button><button type="button">b</button>',
      );
      const container = expectStructurallySafe(out);

      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(container.querySelector('input[type="hidden"]')).toBeNull();
      expect(container.querySelector('input[type="submit"]')).toBeNull();
      expect(container.querySelector('input[type="text"]')).not.toBeNull();
      expect(container.querySelector('input[type="button"]')).not.toBeNull();
      expect(container.querySelector('button[type="submit"]')).toBeNull();
      expect(container.querySelector('button[type="button"]')).not.toBeNull();
    });

    it("allows only blob and base64 raster image sources", () => {
      const allowed = [
        '<img src="blob:https://app.example/1234" alt="a" />',
        '<img src="data:image/png;base64,iVBORw0KGgo=" />',
        '<img src="data:image/jpeg;base64,/9j/4AAQ==" />',
        '<img src="data:image/gif;base64,R0lGODlh" />',
        '<img src="data:image/webp;base64,UklGRg==" />',
      ];
      for (const raw of allowed) {
        const container = expectStructurallySafe(sanitizer.sanitizeHtml(raw));
        expect(container.querySelector("img")?.getAttribute("src")).toBe(
          parse(raw).querySelector("img")?.getAttribute("src"),
        );
      }

      const rejected = [
        '<img src="https://evil.example/x.png" />',
        '<img src="javascript:alert(1)" />',
        '<img src="file:///icon.png" />',
        '<img src="data:image/svg+xml;base64,PHN2Zz4=" />',
        '<img src="data:image/svg+xml,<svg onload=alert(1)>" />',
        '<img src="data:image/png,not-base64" />',
        '<img src="data:image/png;base64,@@@@" />',
        '<img src="data:text/html;base64,PHNjcmlwdD4=" />',
      ];
      for (const raw of rejected) {
        const container = expectStructurallySafe(sanitizer.sanitizeHtml(raw));
        expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
      }
    });

    it("keeps declarative action attributes inert", () => {
      const out = sanitizer.sanitizeHtml(
        '<button data-action="close" onclick="alert(1)">x</button>' +
          '<img src="data:image/png;base64,AAAA" onerror="alert(1)" />',
      );
      const container = expectStructurallySafe(out);
      expect(container.querySelector('[data-action="close"]')).not.toBeNull();
      expect(out.toLowerCase()).not.toContain("alert");
    });

    it("treats markup-looking text as text", () => {
      const out = sanitizer.sanitizeHtml("<p>a &amp; b &lt;img src=x onerror=1&gt;</p>");
      const container = expectStructurallySafe(out);
      expect(container.querySelectorAll("img")).toHaveLength(0);
      expect(container.textContent).toBe("a & b <img src=x onerror=1>");
    });

    it("leaves no dangerous markup behind for adversarial input", () => {
      const attacks = [
        "<script>alert(1)</script>",
        "<div><script>alert(1)</script></div>",
        "<img src=x onerror=alert(1)>",
        '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
        "<svg/onload=alert(1)>",
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<a href="javascript:alert(1)">x</a>',
        '<form action="https://evil.example"><input name="x" /></form>',
        "<style>@import url(https://evil.example/x.css);</style>",
        "<link rel=stylesheet href=https://evil.example/x.css>",
        '<meta http-equiv=refresh content="0;url=https://evil.example">',
        '<object data="data:text/html,<script>alert(1)</script>"></object>',
        '<embed src="https://evil.example/x.swf">',
        '<base href="https://evil.example/">',
        "<template><script>alert(1)</script></template>",
        "<math><mtext><script>alert(1)</script></mtext></math>",
        '<div id="x" style="background:url(javascript:alert(1))" onclick="alert(1)">y</div>',
        '<input type="hidden" value="x" />',
        '<button type="submit" formaction="https://evil.example">go</button>',
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "<SCRIPT>alert(1)</SCRIPT>",
        '<div STYLE="color:red" ONCLICK="alert(1)">z</div>',
      ];

      for (const attack of attacks) {
        const out = sanitizer.sanitizeHtml(attack);
        expectStructurallySafe(out);
        const lowered = out.toLowerCase();
        expect(lowered).not.toContain("http://");
        expect(lowered).not.toContain("https://");
        expect(lowered).not.toContain("evil.example");
      }
    });

    it("is idempotent", () => {
      const once = sanitizer.sanitizeHtml('<div class="a"><script>x</script><p>hi</p></div>');
      const twice = sanitizer.sanitizeHtml(once);
      expect(parse(twice).textContent).toBe(parse(once).textContent);
      expectStructurallySafe(twice);
    });
  });

  describe("scopeCss", () => {
    it("requires a safe scope class", () => {
      const invalid = [
        "",
        "1abc",
        "app scope",
        ".app",
        "#app",
        "a.b",
        "a#b",
        "a:hover",
        "a{b}",
        "-app",
        "app>div",
        "app[data-x]",
        "\u0000",
      ];
      for (const scope of invalid) {
        expect(() => sanitizer.scopeCss("div { color: red; }", scope)).toThrow();
      }

      for (const scope of ["app", "_app", "App-1", "a_b-c"]) {
        expect(() => sanitizer.scopeCss("div { color: red; }", scope)).not.toThrow();
      }
    });

    it("scopes plain selectors under the scope class", () => {
      const out = sanitizer.scopeCss("div { color: #ff0000; display: flex; }", "app");
      expect(out).toMatch(/\.app\s+div/);
      expect(out).toMatch(/display\s*:\s*flex/i);
      expect(out).toMatch(/color\s*:/i);
      expect(out).toMatch(/#ff0000|rgb\(255,\s*0,\s*0\)/i);
    });

    it("maps root selectors onto the scope itself", () => {
      const root = sanitizer.scopeCss(":root { opacity: 1; }", "app");
      expect(root).toMatch(/\.app/);
      expect(root).not.toMatch(/:root/);

      const html = sanitizer.scopeCss("html { opacity: 1; }", "app");
      expect(html).not.toMatch(/\bhtml\b/);

      const body = sanitizer.scopeCss("body { opacity: 1; }", "app");
      expect(body).not.toMatch(/\bbody\b/);
    });

    it("scopes every selector of a comma list", () => {
      const out = sanitizer.scopeCss("h1, h2 { opacity: 1; }", "app");
      expect(out).toMatch(/\.app\s+h1/);
      expect(out).toMatch(/\.app\s+h2/);
    });

    it("drops selectors that reach outside the scope", () => {
      const out = sanitizer.scopeCss(
        ":host { opacity: 1; } :host(.x) { opacity: 1; } :global(.y) { opacity: 1; } .a:has(.b) { opacity: 1; } .\\31 23 { opacity: 1; }",
        "app",
      );
      expect(out).not.toMatch(/:host/);
      expect(out).not.toMatch(/:global/);
      expect(out).not.toMatch(/:has/);
      expect(out).not.toContain("\\");
    });

    it("keeps the safe declarations of a mixed selector list", () => {
      const out = sanitizer.scopeCss("div, :host { opacity: 1; }", "app");
      expect(out).toMatch(/\.app\s+div/);
      expect(out).not.toMatch(/:host/);
    });

    it("rejects every at-rule", () => {
      const out = sanitizer.scopeCss(
        '@import url("https://evil.example/x.css");' +
          "@font-face { font-family: x; src: url(https://evil.example/f.woff); }" +
          "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }" +
          "@media screen { div { opacity: 1; } }" +
          "p { opacity: 1; }",
        "app",
      );
      expect(out).not.toContain("@import");
      expect(out).not.toContain("@font-face");
      expect(out).not.toContain("@keyframes");
      expect(out).not.toContain("@media");
      expect(out).not.toContain("@");
      expect(out.toLowerCase()).not.toContain("evil.example");
      expect(out).toMatch(/\.app\s+p/);
    });

    it("keeps allowlisted declarations and drops the rest", () => {
      const out = sanitizer.scopeCss(
        "div { display: flex; color: #ff0000; background-color: #ffffff; border: 1px solid #000000;" +
          " opacity: 0.5; overflow: hidden; transform: translateX(4px); font-size: 12px;" +
          " position: fixed; z-index: 9999; }",
        "app",
      );
      expect(out).toMatch(/display\s*:\s*flex/i);
      expect(out).toMatch(/background-color\s*:/i);
      expect(out).toMatch(/border\s*:/i);
      expect(out).toMatch(/opacity\s*:/i);
      expect(out).toMatch(/overflow\s*:/i);
      expect(out).toMatch(/transform\s*:/i);
      expect(out).toMatch(/font-size\s*:/i);
      expect(out).not.toMatch(/position\s*:\s*fixed/i);
      expect(out).not.toMatch(/z-index/i);
    });

    it("drops network loads, CSS escapes and custom properties", () => {
      const out = sanitizer.scopeCss(
        "div { color: var(--brand);" +
          ' background: url("https://evil.example/x.png");' +
          ' background-image: image-set("https://evil.example/x.png");' +
          " width: expression(alert(1));" +
          " behavior: url(#default#time2);" +
          " -moz-binding: url(x);" +
          " --custom: red;" +
          " opacity: 1 !important; }",
        "app",
      );
      expect(out).not.toMatch(/var\(/i);
      expect(out).not.toMatch(/url\(/i);
      expect(out).not.toMatch(/image-set\(/i);
      expect(out).not.toMatch(/expression\(/i);
      expect(out).not.toMatch(/-moz-binding/i);
      expect(out).not.toMatch(/behavior/i);
      expect(out).not.toMatch(/--custom/);
      expect(out).not.toMatch(/!important/i);
      expect(out.toLowerCase()).not.toContain("evil.example");
      expect(out).not.toMatch(/\\([0-9a-f]{1,6}\s?)/i);
    });

    it("never crashes on malformed CSS", () => {
      const inputs = ["", "   ", "div { color: ", "}{", "div { color: red", "\u0000", "@", "/*"];
      for (const input of inputs) {
        let out = "";
        expect(() => {
          out = sanitizer.scopeCss(input, "app");
        }).not.toThrow();
        expect(typeof out).toBe("string");
      }
      expect(sanitizer.scopeCss("", "app")).toBe("");
    });
  });
});
