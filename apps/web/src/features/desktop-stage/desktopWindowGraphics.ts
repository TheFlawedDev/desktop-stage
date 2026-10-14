"use client";

/**
 * The PixiJS drawing of one simulated desktop window.
 *
 * `@desktop-stage/desktop-engine` decided *what* is on screen — one node per app
 * instance, carrying a `DesktopWindowNodePayload`. This module answers *how a
 * window looks*, and nothing here resolves frames or reads a document.
 *
 * Split in two on purpose:
 *
 * - **Pure geometry** ({@link layoutDesktopWindow}, {@link windowPalette},
 *   {@link estimateTextWidth}, {@link clampTextToWidth}) is plain data in and
 *   plain data out. It is the part with real decisions in it — where the title
 *   sits, how much room the body has, what an unreadable accent colour falls
 *   back to — so it is the part that is unit tested.
 * - **Pixi objects** ({@link createDesktopWindow}) consume that data and issue
 *   draw calls. The object is kept and re-synced across frames rather than
 *   rebuilt, because the desktop engine keys a window by `instanceId`: splitting
 *   an app's lifetime across two clips must not tear down and recreate its text
 *   every time the playhead crosses the cut.
 *
 * Coordinate convention follows the compositor: a window's local origin is its
 * **top-left** corner, and the container is positioned by the node's resolved
 * centre with a 0.5 anchor. Everything here is therefore drawn in `0..width` /
 * `0..height` space and never needs to know where the window sits on the stage.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { DesktopAppKind } from "@cutaway/types";
import {
  readDesktopWindowPayload,
  type DesktopWindowNodePayload,
} from "@desktop-stage/desktop-engine";

/** Zoom-invariant type sizes, in project pixels. */
const TITLE_FONT_SIZE = 13;
const BODY_FONT_SIZE = 13;

/** Fixed vertical metrics of the chrome, in project pixels. */
const TITLE_BAR_HEIGHT = 30;
const TOOLBAR_HEIGHT = 30;
const CHROME_PADDING_X = 12;
const BODY_PADDING_X = 14;
const BODY_PADDING_Y = 10;

/** Side of the round close/minimise/zoom marks drawn in the title bar. */
const TRAFFIC_LIGHT_SIZE = 9;
/** Horizontal step between those marks. */
const TRAFFIC_LIGHT_GAP = 16;

/** Columns a tab occupies when it is drawn, so a tab cannot collapse to nothing. */
const TAB_WIDTH = 4;

/** Opacity applied to secondary text runs (line numbers, muted labels). */
const MUTED_TEXT_ALPHA = 0.75;

/** Font family used for window bodies that are not code. */
const UI_FONT = "Inter, Segoe UI, Helvetica Neue, Arial, sans-serif";
/** Font family used for code and terminal windows on every platform. */
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Fallback accent for a payload whose accent colour cannot be parsed. */
const FALLBACK_ACCENT = "#7c6cff";
const FALLBACK_INK = "#e8eaf0";

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): Rgb | null {
  const raw = value.trim().replace(/^#/, "");
  const expanded = raw.length === 3 ? raw.replace(/./g, (digit) => digit + digit) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  const value24 = Number.parseInt(expanded, 16);
  return { r: (value24 >> 16) & 255, g: (value24 >> 8) & 255, b: value24 & 255 };
}

/** Mixes towards white; `amount` 0 returns the colour unchanged, 1 returns white. */
function lighten(color: Rgb, amount: number): Rgb {
  const ratio = Math.min(1, Math.max(0, amount));
  return {
    r: color.r + (255 - color.r) * ratio,
    g: color.g + (255 - color.g) * ratio,
    b: color.b + (255 - color.b) * ratio,
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  return `#${((channel(r) << 16) | (channel(g) << 8) | channel(b)).toString(16).padStart(6, "0")}`;
}

/** The colours one window is drawn with, derived from its authored look. */
export interface WindowPalette {
  /** Window frame: the title bar and any toolbar. */
  chrome: string;
  /** Body background. */
  background: string;
  /** Raised element inside the body, such as an address pill. */
  panel: string;
  /** Primary text. */
  text: string;
  /** Secondary text: line numbers, prompts, inactive tabs. */
  mutedText: string;
  /** The app's authored accent, adjusted so it stays legible on the theme. */
  accent: string;
  /** Close / minimise / zoom marks. */
  trafficLights: [string, string, string];
}

/**
 * Colours for one window.
 *
 * An unparseable accent falls back rather than propagating `NaN` into every
 * fill: a project with a hand-edited colour should still draw.
 */
export function windowPalette(payload: DesktopWindowNodePayload): WindowPalette {
  const parsedAccent = parseHexColor(payload.look.accentColor);
  const accentRgb = parsedAccent ?? parseHexColor(FALLBACK_ACCENT)!;
  const dark = payload.look.theme === "dark";

  // A dark accent vanishes against dark chrome and a pale one against light
  // chrome, so the authored colour is lifted towards the theme before it is used
  // for marks. The hue — the app's identity — survives the lift.
  const accent = toHex(lighten(accentRgb, dark ? 0.12 : 0.3));

  return {
    chrome: dark ? "#20232b" : "#eceef3",
    background: dark ? "#14161c" : "#ffffff",
    panel: dark ? "#2b2f39" : "#dfe3ea",
    text: dark ? FALLBACK_INK : "#1b1e25",
    mutedText: dark ? "#8f96a6" : "#5f6675",
    accent,
    trafficLights: ["#ff5f57", "#febc2e", "#28c840"],
  };
}

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

function isWideCharacter(code: number): boolean {
  // Rough CJK/fullwidth ranges. Cyrillic and Greek are narrow in most UI fonts,
  // so only the genuinely double-width blocks are included.
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff)
  );
}

/**
 * Estimated advance width of `text` at `fontSize`, in project pixels.
 *
 * Deliberately an estimate: measuring for real would mean asking a canvas for
 * metrics, which is neither pure nor available during export. Judging by code
 * point rather than `length` keeps emoji and CJK from being under-measured,
 * which is the direction that matters — an over-long line is clipped, an
 * under-measured one is drawn over the window edge.
 */
export function estimateTextWidth(text: string, fontSize: number, monospace = false): number {
  if (monospace) {
    // Monospace advance is a constant, so a column count is exact enough.
    let columns = 0;
    for (const character of text) {
      columns += character === "\t" ? TAB_WIDTH : 1;
    }
    return columns * fontSize * 0.6;
  }

  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\t") width += TAB_WIDTH * fontSize * 0.5;
    else if (isWideCharacter(code)) width += fontSize;
    else if (character === " ") width += fontSize * 0.28;
    else if ("iljtIf.,:;'|!".includes(character)) width += fontSize * 0.32;
    else if ("mwMW@%".includes(character)) width += fontSize * 0.85;
    else if (character >= "A" && character <= "Z") width += fontSize * 0.64;
    else width += fontSize * 0.52;
  }
  return width;
}

/** A string trimmed to fit a width, with the width it will actually occupy. */
export interface FittedText {
  text: string;
  /** Estimated width of {@link text}, never above the requested maximum. */
  width: number;
  /** True when characters were dropped to make it fit. */
  truncated: boolean;
}

/**
 * Trims `text` so it fits `maxWidth`, appending an ellipsis when it does not.
 *
 * Binary search rather than a character-by-character walk: the estimate is
 * monotonic in the prefix length, and window bodies re-fit on every content
 * change, so the cheaper the better.
 */
export function clampTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  monospace = false,
): FittedText {
  if (maxWidth <= 0) return { text: "", width: 0, truncated: text.length > 0 };

  const full = estimateTextWidth(text, fontSize, monospace);
  if (full <= maxWidth) return { text, width: full, truncated: false };

  const characters = [...text];
  const ellipsis = "…";
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize, monospace);

  // Longest prefix that still leaves room for the ellipsis. The estimate is
  // monotonic in the prefix length, so the binary search finds it.
  let withEllipsis = 0;
  if (ellipsisWidth <= maxWidth) {
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = characters.slice(0, mid).join("") + ellipsis;
      if (estimateTextWidth(candidate, fontSize, monospace) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    withEllipsis = low;
  }

  // The ellipsis cannot join even one character — the window is narrower than
  // `ellipsis + one glyph` — so keep the longest plain prefix instead. A narrow
  // window degrades to a cut-off label rather than drawing nothing.
  if (withEllipsis === 0) {
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const prefix = characters.slice(0, mid).join("");
      if (estimateTextWidth(prefix, fontSize, monospace) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    const kept = characters.slice(0, low).join("");
    return { text: kept, width: estimateTextWidth(kept, fontSize, monospace), truncated: true };
  }

  const result = characters.slice(0, withEllipsis).join("") + ellipsis;
  return { text: result, width: estimateTextWidth(result, fontSize, monospace), truncated: true };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** One text run, placed inside the window's local coordinate space. */
export interface WindowTextRun {
  text: string;
  x: number;
  /** Top edge of the text box. */
  y: number;
  fontSize: number;
  color: string;
  monospace: boolean;
  /** Drawn dimmer than primary text (line numbers, address bars). */
  muted: boolean;
}

/** A drawn rectangle inside the window's local coordinate space. */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Corner radius; 0 draws square corners. */
  radius: number;
}

/** A drawn circle inside the window's local coordinate space. */
export interface WindowDot {
  x: number;
  y: number;
  radius: number;
  color: string;
}

/** Everything needed to draw one window at one size, as plain data. */
export interface DesktopWindowLayout {
  width: number;
  height: number;
  palette: WindowPalette;
  /** Window frame, drawn first. */
  background: WindowRect;
  /** True when the app's chrome draws a title bar at all. */
  showTitleBar: boolean;
  titleBarHeight: number;
  title: WindowTextRun;
  /** The three window marks, present only with window chrome. */
  trafficLights: WindowDot[];
  /** Toolbar strip height; 0 when the app has none. */
  toolbarHeight: number;
  /** Rectangles belonging to the toolbar (tabs, address pill, accent stripe). */
  toolbarRects: WindowRect[];
  /** Text runs belonging to the toolbar (tab label, address). */
  toolbarText: WindowTextRun[];
  /** Body text runs, already trimmed to the body width. */
  bodyLines: WindowTextRun[];
  /** Left inset of the body, past any line-number gutter. */
  bodyX: number;
  /** Top of the body, below the chrome. */
  bodyY: number;
  /** Vertical step between body lines. */
  lineHeight: number;
}

function showsTitleBar(payload: DesktopWindowNodePayload): boolean {
  return payload.look.chrome === "window" && payload.look.showTitleBar;
}

/** Toolbar height each app kind reserves, in project pixels. */
function toolbarHeightFor(appKind: DesktopAppKind): number {
  return appKind === "browser" || appKind === "code" ? TOOLBAR_HEIGHT : 0;
}

/** True when the app's body is drawn in a monospace face. */
export function isMonospaceApp(appKind: DesktopAppKind): boolean {
  return appKind === "code" || appKind === "terminal";
}

/** Left inset reserved for line numbers. Only code windows number their lines. */
function gutterWidthFor(appKind: DesktopAppKind): number {
  return appKind === "code" ? 30 : 0;
}

/**
 * Lays one window out at `width` × `height` project pixels.
 *
 * Sizes come from the resolved frame (authored size × the clip's animated
 * scale), so a window scaled down mid-animation gets proportionally less room
 * rather than overflowing. Lines that fall outside the body are dropped here;
 * every run that remains lies inside the frame.
 */
export function layoutDesktopWindow(
  payload: DesktopWindowNodePayload,
  width: number,
  height: number,
): DesktopWindowLayout {
  const palette = windowPalette(payload);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  const showTitleBar = showsTitleBar(payload);
  const titleBarHeight = showTitleBar ? TITLE_BAR_HEIGHT : 0;
  const toolbarHeight = toolbarHeightFor(payload.appKind);
  const bodyY = titleBarHeight + toolbarHeight;
  const bodyHeight = Math.max(0, safeHeight - bodyY);
  const lineHeight = BODY_FONT_SIZE * 1.5;

  const titleLeft =
    CHROME_PADDING_X + (showTitleBar && payload.look.chrome === "window" ? TRAFFIC_LIGHT_GAP * 3 : 0);
  // A hidden title bar draws no text, so the layout carries none either: an
  // invisible run would still contribute to the container's measured bounds.
  const fittedTitle = showTitleBar
    ? clampTextToWidth(
        payload.title,
        Math.max(0, safeWidth - titleLeft - CHROME_PADDING_X),
        TITLE_FONT_SIZE,
        false,
      )
    : { text: "", width: 0, truncated: false };

  const trafficLights: WindowDot[] = [];
  if (showTitleBar && payload.look.chrome === "window") {
    for (let index = 0; index < 3; index += 1) {
      trafficLights.push({
        x: CHROME_PADDING_X + index * TRAFFIC_LIGHT_GAP,
        y: titleBarHeight / 2,
        radius: TRAFFIC_LIGHT_SIZE / 2,
        color: palette.trafficLights[index] ?? palette.accent,
      });
    }
  }

  const toolbarRects: WindowRect[] = [];
  const toolbarText: WindowTextRun[] = [];

  if (toolbarHeight > 0) {
    const top = titleBarHeight + 5;
    const stripHeight = toolbarHeight - 10;

    if (payload.appKind === "browser") {
      // A tab, then an address pill carrying the window's title. The title
      // doubles as the address because the document has no second string to
      // hold one — inventing a URL would put words in the author's mouth.
      const tabWidth = Math.min(120, safeWidth * 0.3);
      toolbarRects.push({
        x: CHROME_PADDING_X,
        y: top,
        width: tabWidth,
        height: stripHeight,
        color: palette.background,
        radius: Math.min(payload.look.cornerRadius, stripHeight / 2),
      });

      const pillX = CHROME_PADDING_X + tabWidth + 8;
      const pillWidth = Math.max(0, safeWidth - pillX - CHROME_PADDING_X);
      if (pillWidth > 0) {
        toolbarRects.push({
          x: pillX,
          y: top,
          width: pillWidth,
          height: stripHeight,
          color: palette.panel,
          radius: stripHeight / 2,
        });

        const address = clampTextToWidth(payload.title, Math.max(0, pillWidth - 24), TITLE_FONT_SIZE, false);
        if (address.text.length > 0) {
          toolbarText.push({
            text: address.text,
            x: pillX + 12,
            y: top + (stripHeight - TITLE_FONT_SIZE * 1.3) / 2,
            fontSize: TITLE_FONT_SIZE,
            color: palette.accent,
            monospace: false,
            muted: false,
          });
        }
      }
    } else if (payload.appKind === "code") {
      // One active file tab. The document stores the file name as the window
      // title, so that is the tab label.
      const tabWidth = Math.min(160, safeWidth * 0.5);
      toolbarRects.push({
        x: CHROME_PADDING_X,
        y: top,
        width: tabWidth,
        height: stripHeight,
        color: palette.background,
        radius: Math.min(payload.look.cornerRadius / 2, stripHeight / 2),
      });
      // The accent stripe is what makes the active tab read as active without a
      // second colour in the document.
      toolbarRects.push({
        x: CHROME_PADDING_X,
        y: top,
        width: 2,
        height: stripHeight,
        color: palette.accent,
        radius: 1,
      });

      const label = clampTextToWidth(payload.title, Math.max(0, tabWidth - 20), TITLE_FONT_SIZE, false);
      if (label.text.length > 0) {
        toolbarText.push({
          text: label.text,
          x: CHROME_PADDING_X + 10,
          y: top + (stripHeight - TITLE_FONT_SIZE * 1.3) / 2,
          fontSize: TITLE_FONT_SIZE,
          color: palette.text,
          monospace: false,
          muted: false,
        });
      }
    }
  }

  const monospace = isMonospaceApp(payload.appKind);
  const gutter = gutterWidthFor(payload.appKind);
  const bodyX = BODY_PADDING_X + gutter;
  const bodyWidth = Math.max(0, safeWidth - bodyX - BODY_PADDING_X);

  const fittedLines =
    bodyHeight > 0
      ? payload.lines.map(
          (line) => clampTextToWidth(line, bodyWidth, BODY_FONT_SIZE, monospace).text,
        )
      : [];
  // Padding is reserved at both ends of the body before lines are counted, so
  // the last line cannot end up half outside the window.
  const roomForLines = Math.max(0, Math.floor((bodyHeight - BODY_PADDING_Y * 2) / lineHeight));
  const visibleLines = Math.min(fittedLines.length, roomForLines);

  const bodyLines: WindowTextRun[] = [];
  for (let index = 0; index < visibleLines; index += 1) {
    const y = bodyY + BODY_PADDING_Y + index * lineHeight;

    if (gutter > 0) {
      bodyLines.push({
        text: String(index + 1),
        x: BODY_PADDING_X,
        y,
        fontSize: BODY_FONT_SIZE,
        color: palette.mutedText,
        monospace: true,
        muted: true,
      });
    }

    bodyLines.push({
      text: fittedLines[index] ?? "",
      x: bodyX,
      y,
      fontSize: BODY_FONT_SIZE,
      color: palette.text,
      monospace,
      muted: false,
    });
  }

  return {
    width: safeWidth,
    height: safeHeight,
    palette,
    background: {
      x: 0,
      y: 0,
      width: safeWidth,
      height: safeHeight,
      color: palette.background,
      radius: payload.look.cornerRadius,
    },
    showTitleBar,
    titleBarHeight,
    title: {
      text: fittedTitle.text,
      x: titleLeft,
      y: (titleBarHeight - TITLE_FONT_SIZE * 1.3) / 2,
      fontSize: TITLE_FONT_SIZE,
      color: palette.text,
      monospace: false,
      muted: false,
    },
    trafficLights,
    toolbarHeight,
    toolbarRects,
    toolbarText,
    bodyLines,
    bodyX,
    bodyY,
    lineHeight,
  };
}

/**
 * A shell prompt line: `user@host [path] % command`.
 *
 * The first token is the user/host (or the working directory), an optional
 * second token is a path (`~`, `~/project`, `/srv/app`), and the marker must be
 * followed by whitespace and the command it introduces. Output that merely
 * contains a marker character — `Total: 50 % done` — has no such shape and is
 * left in the primary text colour.
 */
const SHELL_PROMPT = /^[^\s]+\s+(?:~[^\s]*|\/[^\s]*)?\s*[%$#>]\s+\S/;

/**
 * Colour for one body line.
 *
 * A terminal's prompt lines are drawn in the accent, which is what makes an
 * otherwise flat block of monospace read as a session rather than a listing.
 * Everything else is primary text; the check is deliberately a shell-prompt
 * shape (`user@host ~ %`) and nothing more elaborate, so it cannot mis-colour
 * ordinary output.
 */
export function bodyLineColor(
  payload: DesktopWindowNodePayload,
  palette: WindowPalette,
  line: string,
): string {
  if (payload.appKind !== "terminal") return palette.text;
  return SHELL_PROMPT.test(line) ? palette.accent : palette.text;
}

// ---------------------------------------------------------------------------
// Pixi objects
// ---------------------------------------------------------------------------

function toTextStyle(run: WindowTextRun): TextStyle {
  return new TextStyle({
    fontFamily: run.monospace ? MONO_FONT : UI_FONT,
    fontSize: run.fontSize,
    fill: run.color,
    fontWeight: "500",
    lineHeight: run.fontSize * 1.5,
  });
}

/** One app window as a Pixi container. Updated in place; never rebuilt. */
export class DesktopWindowView extends Container {
  private readonly frame = new Graphics();
  private readonly titleText = new Text({ text: "" });
  private readonly toolbarTexts: Text[] = [];
  private readonly bodyTexts: Text[] = [];
  /** Shape of the last synced window, so an unchanged window costs one compare. */
  private lastKey: string | null = null;

  constructor() {
    super();
    this.titleText.anchor.set(0, 0);
    this.addChild(this.frame, this.titleText);
  }

  /**
   * Draws `payload` at `width` × `height`.
   *
   * Called on every frame the window is on screen — including the many frames
   * where only its position changed. Those frames return immediately: the
   * layout is a pure function of the window's shape, so an unchanged shape means
   * the geometry and the text runs are already right.
   */
  sync(payload: DesktopWindowNodePayload, width: number, height: number): void {
    const key = syncKey(payload, width, height);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const layout = layoutDesktopWindow(payload, width, height);

    this.drawFrame(layout, payload);
    this.syncTitle(layout);
    reconcileTexts(this.toolbarTexts, layout.toolbarText, this);
    reconcileTexts(
      this.bodyTexts,
      layout.bodyLines.map((run) => ({
        ...run,
        color: bodyLineColor(payload, layout.palette, run.text),
      })),
      this,
    );
  }

  private drawFrame(layout: DesktopWindowLayout, payload: DesktopWindowNodePayload): void {
    const { background, palette, showTitleBar, titleBarHeight, toolbarHeight, toolbarRects } = layout;

    this.frame.clear();
    this.frame
      .roundRect(background.x, background.y, background.width, background.height, background.radius)
      .fill(palette.background);

    if (showTitleBar) {
      this.frame.rect(0, 0, layout.width, titleBarHeight).fill(palette.chrome);
    }

    if (toolbarHeight > 0) {
      this.frame.rect(0, titleBarHeight, layout.width, toolbarHeight).fill(palette.chrome);
      // A hairline under the chrome, so the body reads as its own surface.
      this.frame
        .rect(0, titleBarHeight + toolbarHeight - 1, layout.width, 1)
        .fill(palette.background);
    }

    if (payload.appKind === "terminal") {
      // The prototype's terminal had no title bar of its own; the accent bar
      // along the top edge is what identifies it.
      this.frame.rect(0, 0, layout.width, 3).fill(palette.accent);
    }

    for (const dot of layout.trafficLights) {
      this.frame.circle(dot.x, dot.y, dot.radius).fill(dot.color);
    }

    for (const rect of toolbarRects) {
      this.frame.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius).fill(rect.color);
    }

    this.frame
      .roundRect(background.x, background.y, background.width, background.height, background.radius)
      .stroke({ color: palette.chrome, width: 1 });
  }

  private syncTitle(layout: DesktopWindowLayout): void {
    const run = layout.title;
    const visible = layout.showTitleBar && run.text.length > 0;
    this.titleText.visible = visible;
    if (!visible) return;

    applyTextRun(this.titleText, run);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    // Text owns an atlas entry per style; releasing them here keeps a long
    // editing session from accumulating one per window that ever appeared.
    this.titleText.destroy();
    for (const text of this.toolbarTexts) text.destroy();
    for (const text of this.bodyTexts) text.destroy();
    this.toolbarTexts.length = 0;
    this.bodyTexts.length = 0;
    super.destroy(options);
  }
}

/**
 * Everything the drawn window depends on, as one comparable string.
 *
 * Position is deliberately absent: a window that only moved needs no redraw, and
 * its node transform carries the movement. Rotating a title or appending a
 * terminal line changes this key and the window is rebuilt.
 */
function syncKey(payload: DesktopWindowNodePayload, width: number, height: number): string {
  const { look } = payload;
  return [
    payload.instanceId,
    payload.appKind,
    payload.title,
    payload.lines.join("\u0000"),
    look.accentColor,
    look.theme,
    look.chrome,
    look.cornerRadius,
    look.showTitleBar,
    width,
    height,
  ].join("\u0001");
}

function applyTextRun(text: Text, run: WindowTextRun): void {
  if (text.text !== run.text) text.text = run.text;
  text.style = toTextStyle(run);
  // Muted runs are the app's own secondary text (line numbers, an address), so
  // they are dimmed in place rather than given a second colour. Opacity lives
  // on the display object; TextStyle has no top-level `alpha`.
  text.alpha = run.muted ? MUTED_TEXT_ALPHA : 1;
  text.position.set(run.x, run.y);
}

/**
 * Grows, shrinks, and re-styles a pool of `Text` objects to match `runs`.
 *
 * Reusing the objects rather than recreating them is what keeps a playing
 * timeline from allocating a new text atlas on every frame; the pool is walked
 * backwards so surplus entries can be released and spliced away.
 */
function reconcileTexts(pool: Text[], runs: WindowTextRun[], parent: Container): void {
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    let text = pool[index];

    if (!text) {
      text = new Text({ text: run.text });
      text.anchor.set(0, 0);
      pool[index] = text;
      parent.addChild(text);
    }

    applyTextRun(text, run);
  }

  for (let index = pool.length - 1; index >= runs.length; index -= 1) {
    const text = pool[index];
    if (!text) continue;
    pool.splice(index, 1);
    parent.removeChild(text);
    text.destroy();
  }
}

/**
 * Builds the display object for a Desktop Stage window node.
 *
 * Returns `null` when the node's payload is not a window this build understands,
 * so the renderer leaves a hole instead of crashing on a project written by a
 * newer version.
 */
export function createDesktopWindow(data: unknown): DesktopWindowView | null {
  const payload = readDesktopWindowPayload(data);
  if (!payload) return null;

  const view = new DesktopWindowView();
  view.sync(payload, payload.width, payload.height);
  return view;
}
