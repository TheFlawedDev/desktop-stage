import type {
  ITemplateSanitizer,
  Rect,
  StageAppKind,
  VirtualFileNode,
} from "@cutaway/types";
import {
  MemoryVirtualFileSystem,
  normalizeVirtualPath,
} from "../vfs/index";

// ==========================================
// 1. App Catalog & Customization
// ==========================================

export interface AppDefinition {
  kind: StageAppKind;
  name: string;
  iconUri?: string;
}

export const APP_DEFINITIONS: ReadonlyArray<AppDefinition> = Object.freeze([
  Object.freeze({ kind: "finder" as StageAppKind, name: "Finder" }),
  Object.freeze({ kind: "iterm" as StageAppKind, name: "iTerm" }),
  Object.freeze({ kind: "arc" as StageAppKind, name: "Arc" }),
  Object.freeze({ kind: "quicktime" as StageAppKind, name: "QuickTime" }),
  Object.freeze({ kind: "photobooth" as StageAppKind, name: "Photo Booth" }),
]);

const DEFAULT_APP_NAMES: Record<string, string> = {
  finder: "Finder",
  iterm: "iTerm",
  arc: "Arc",
  quicktime: "QuickTime",
  photobooth: "Photo Booth",
};

export interface CustomizeAppOptions {
  name?: string;
  iconUri?: string;
}

export function customizeApp(kind: StageAppKind, options?: CustomizeAppOptions): AppDefinition {
  if (!(kind in DEFAULT_APP_NAMES)) {
    throw new Error(`Unsupported app kind for customization: ${kind}`);
  }

  let finalName = DEFAULT_APP_NAMES[kind]!;
  let finalIconUri: string | undefined = undefined;

  if (options?.name !== undefined) {
    const trimmed = options.name.trim();
    if (trimmed.length === 0 || trimmed.length > 80 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
      throw new Error(`Invalid custom app name: ${options.name}`);
    }
    finalName = trimmed;
  }

  if (options?.iconUri !== undefined) {
    const uri = options.iconUri.trim();
    const isBlob = /^blob:[^\s\u0000-\u001F\u007F]+$/i.test(uri);
    const isRasterData = /^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/i.test(uri);
    if (!isBlob && !isRasterData) {
      throw new Error(`Invalid icon URI: ${options.iconUri}`);
    }
    finalIconUri = uri;
  }

  return {
    kind,
    name: finalName,
    ...(finalIconUri ? { iconUri: finalIconUri } : {}),
  };
}

// ==========================================
// 2. Template Sanitizer
// ==========================================

const DANGEROUS_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "svg", "math", "template", "form"
]);

const ALLOWED_TAGS = new Set([
  "div", "span", "p", "header", "footer", "main", "nav", "section",
  "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "button",
  "input", "img", "label", "ul", "ol", "li", "b", "strong", "i",
  "em", "small", "code", "pre", "hr", "br"
]);

const ALLOWED_ATTRS = new Set([
  "class", "title", "role", "aria-label", "aria-hidden", "placeholder",
  "value", "disabled", "data-slot", "data-action", "type", "src", "alt"
]);

const ALLOWED_SLOTS = new Set(["content", "title", "icon"]);
const ALLOWED_ACTIONS = new Set([
  "close", "minimize", "maximize", "back", "forward", "reload", "play", "pause"
]);

const ALLOWED_PROPERTIES = new Set([
  "display", "color", "background-color", "border", "border-radius",
  "opacity", "overflow", "transform", "font-size", "font-family", "font-weight",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "width", "min-width", "max-width", "height", "min-height", "max-height",
  "flex", "flex-direction", "flex-wrap", "align-items", "justify-content",
  "gap", "line-height", "text-align"
]);

export class TemplateSanitizer implements ITemplateSanitizer {
  constructor(private readonly doc?: Document) {}

  sanitizeHtml(rawHtml: string): string {
    if (typeof rawHtml !== "string") return "";

    const activeDoc = this.doc ?? (typeof document !== "undefined" ? document : null);
    if (!activeDoc) {
      return rawHtml;
    }

    const template = activeDoc.createElement("template");
    template.innerHTML = rawHtml;
    const fragment = template.content;

    this.cleanFragment(fragment);

    const div = activeDoc.createElement("div");
    div.appendChild(fragment.cloneNode(true));
    return div.innerHTML;
  }

  private cleanFragment(parent: Node): void {
    const children = Array.from(parent.childNodes);

    for (const child of children) {
      if (child.nodeType === 1 /* ELEMENT_NODE */) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();

        if (DANGEROUS_TAGS.has(tag)) {
          el.remove();
          continue;
        }

        if (!ALLOWED_TAGS.has(tag)) {
          this.cleanFragment(el);
          while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
          }
          el.remove();
          continue;
        }

        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          const val = attr.value;

          if (name.startsWith("on") || !ALLOWED_ATTRS.has(name)) {
            el.removeAttribute(attr.name);
            continue;
          }

          if (name === "type") {
            const low = val.trim().toLowerCase();
            if (low !== "text" && low !== "button") {
              el.removeAttribute(attr.name);
            }
            continue;
          }

          if (name === "src") {
            const trimmed = val.trim().toLowerCase();
            const isSafe =
              /^blob:[^\s]+$/.test(trimmed) ||
              /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(trimmed);
            if (!isSafe) {
              el.removeAttribute(attr.name);
            }
            continue;
          }

          if (name === "data-slot" && !ALLOWED_SLOTS.has(val)) {
            el.removeAttribute(attr.name);
            continue;
          }

          if (name === "data-action" && !ALLOWED_ACTIONS.has(val)) {
            el.removeAttribute(attr.name);
            continue;
          }
        }

        this.cleanFragment(el);
      }
    }
  }

  scopeCss(rawCss: string, scopeClass: string): string {
    if (typeof rawCss !== "string") return "";

    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(scopeClass)) {
      throw new Error(`Invalid scope class: ${scopeClass}`);
    }

    const cleanClass = `.${scopeClass}`;

    let css = rawCss.replace(/@[^{]+?\{[\s\S]*?\}\s*/g, "");
    css = css.replace(/@[^;]+;\s*/g, "");

    const outRules: string[] = [];
    const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = ruleRegex.exec(css)) !== null) {
      const rawSelectors = match[1]!.trim();
      const rawDeclarations = match[2]!.trim();

      const selectors = rawSelectors.split(",").map((s) => s.trim()).filter(Boolean);
      const validScopedSelectors: string[] = [];

      for (const sel of selectors) {
        if (
          sel.includes(":host") ||
          sel.includes(":global") ||
          sel.includes(":has") ||
          sel.includes("\\") ||
          sel.includes("@")
        ) {
          continue;
        }

        if (sel === ":root" || sel === "html" || sel === "body") {
          validScopedSelectors.push(cleanClass);
        } else {
          validScopedSelectors.push(`${cleanClass} ${sel}`);
        }
      }

      if (validScopedSelectors.length === 0) continue;

      const decls = rawDeclarations.split(";").map((d) => d.trim()).filter(Boolean);
      const validDecls: string[] = [];

      for (const decl of decls) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;

        const prop = decl.slice(0, colonIdx).trim().toLowerCase();
        const val = decl.slice(colonIdx + 1).trim();
        const lowVal = val.toLowerCase();

        if (
          lowVal.includes("url(") ||
          lowVal.includes("image-set(") ||
          lowVal.includes("var(") ||
          lowVal.includes("expression(") ||
          lowVal.includes("behavior") ||
          lowVal.includes("-moz-binding") ||
          lowVal.includes("!important") ||
          lowVal.includes("\\") ||
          prop.startsWith("--")
        ) {
          continue;
        }

        if (prop === "position" && (lowVal.includes("fixed") || lowVal.includes("absolute"))) {
          continue;
        }
        if (prop === "z-index") {
          continue;
        }

        if (ALLOWED_PROPERTIES.has(prop)) {
          validDecls.push(`${prop}: ${val};`);
        }
      }

      if (validDecls.length === 0) continue;

      outRules.push(`${validScopedSelectors.join(", ")} { ${validDecls.join(" ")} }`);
    }

    return outRules.join(" ");
  }
}

// ==========================================
// 3. iTerm Evaluator
// ==========================================

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  clear?: boolean;
}

export class ItermEvaluator {
  constructor(private readonly vfs: MemoryVirtualFileSystem) {}

  async execute(commandLine: string, currentWorkingDir: string): Promise<TerminalResult> {
    const cwd = normalizeVirtualPath(currentWorkingDir);

    const trimmed = commandLine.trim();
    if (!trimmed) {
      return { stdout: "", stderr: "", exitCode: 0, cwd };
    }

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let isEscaped = false;

    for (let i = 0; i < commandLine.length; i++) {
      const c = commandLine[i]!;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (c === "\\") {
        isEscaped = true;
        continue;
      }
      if (c === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (c === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote) {
        if (c === ";" || c === "|" || c === "&" || c === "`") {
          return { stdout: "", stderr: `Metacharacter '${c}' rejected\n`, exitCode: 1, cwd };
        }
        if (c === "$" && i + 1 < commandLine.length && (commandLine[i + 1] === "(" || commandLine[i + 1] === "{")) {
          return { stdout: "", stderr: "Command substitution rejected\n", exitCode: 1, cwd };
        }
      }
      if (inDoubleQuote) {
        if (c === "`" || (c === "$" && i + 1 < commandLine.length && commandLine[i + 1] === "(")) {
          return { stdout: "", stderr: "Command substitution rejected\n", exitCode: 1, cwd };
        }
      }
    }

    let commandPart = trimmed;
    let redirectFile: string | null = null;
    let append = false;

    if (commandPart.includes("<") || commandPart.includes("2>")) {
      return { stdout: "", stderr: "Unsupported redirection\n", exitCode: 1, cwd };
    }

    if (commandPart.includes(">>")) {
      const parts = commandPart.split(">>");
      if (parts.length !== 2 || !parts[1]!.trim()) {
        return { stdout: "", stderr: "Syntax error near unexpected token '>>'\n", exitCode: 1, cwd };
      }
      commandPart = parts[0]!.trim();
      redirectFile = parts[1]!.trim();
      append = true;
    } else if (commandPart.includes(">")) {
      const parts = commandPart.split(">");
      if (parts.length !== 2 || !parts[1]!.trim()) {
        return { stdout: "", stderr: "Syntax error near unexpected token '>'\n", exitCode: 1, cwd };
      }
      commandPart = parts[0]!.trim();
      redirectFile = parts[1]!.trim();
      append = false;
    }

    if (redirectFile && redirectFile.split(/\s+/).length > 1) {
      return { stdout: "", stderr: "Ambiguous redirect\n", exitCode: 1, cwd };
    }

    const tokens: string[] = [];
    let currentToken = "";
    let quoteMode: '"' | "'" | null = null;
    let tokenEscaped = false;

    for (let i = 0; i < commandPart.length; i++) {
      const char = commandPart[i]!;

      if (tokenEscaped) {
        currentToken += char;
        tokenEscaped = false;
        continue;
      }

      if (char === "\\") {
        tokenEscaped = true;
        continue;
      }

      if (quoteMode) {
        if (char === quoteMode) {
          quoteMode = null;
        } else {
          currentToken += char;
        }
      } else {
        if (char === '"' || char === "'") {
          quoteMode = char;
        } else if (/\s/.test(char)) {
          if (currentToken) {
            tokens.push(currentToken);
            currentToken = "";
          }
        } else {
          currentToken += char;
        }
      }
    }

    if (quoteMode || tokenEscaped) {
      return { stdout: "", stderr: "Unterminated quote or escape\n", exitCode: 1, cwd };
    }

    if (currentToken) {
      tokens.push(currentToken);
    }

    if (tokens.length === 0) {
      return { stdout: "", stderr: "", exitCode: 0, cwd };
    }

    const command = tokens[0]!;
    const args = tokens.slice(1);

    let result: { stdout: string; stderr: string; exitCode: number; newCwd?: string; clear?: boolean };

    try {
      switch (command) {
        case "pwd": {
          if (args.length > 0) {
            result = { stdout: "", stderr: "pwd: too many arguments\n", exitCode: 1 };
          } else {
            result = { stdout: `${cwd}\n`, stderr: "", exitCode: 0 };
          }
          break;
        }

        case "clear": {
          result = { stdout: "", stderr: "", exitCode: 0, clear: true };
          break;
        }

        case "help": {
          result = {
            stdout: "pwd, ls, cat, echo, mkdir, touch, rm, mv, cd, clear\n",
            stderr: "",
            exitCode: 0,
          };
          break;
        }

        case "cd": {
          if (args.length > 1) {
            result = { stdout: "", stderr: "cd: too many arguments\n", exitCode: 1 };
            break;
          }
          const target = args[0] ?? "/";
          let newPath: string;
          try {
            newPath = normalizeVirtualPath(target, cwd);
          } catch {
            result = { stdout: "", stderr: `cd: ${target}: Invalid path\n`, exitCode: 1 };
            break;
          }

          const stat = await this.vfs.stat(newPath).catch(() => null);
          if (!stat || !stat.isDirectory) {
            result = { stdout: "", stderr: `cd: ${target}: No such file or directory\n`, exitCode: 1 };
          } else {
            result = { stdout: "", stderr: "", exitCode: 0, newCwd: newPath };
          }
          break;
        }

        case "ls": {
          if (args.some((a) => a.startsWith("-"))) {
            result = { stdout: "", stderr: "ls: options not supported\n", exitCode: 1 };
            break;
          }
          let targetDir: string;
          try {
            targetDir = args[0] ? normalizeVirtualPath(args[0], cwd) : cwd;
          } catch {
            result = { stdout: "", stderr: `ls: cannot access '${args[0]}': Invalid path\n`, exitCode: 1 };
            break;
          }

          const stat = await this.vfs.stat(targetDir).catch(() => null);
          if (!stat || !stat.isDirectory) {
            result = { stdout: "", stderr: `ls: cannot access '${args[0] ?? cwd}': No such directory\n`, exitCode: 1 };
          } else {
            const list = await this.vfs.listDirectory(targetDir);
            const isRootWithoutArgs = args.length === 0 && targetDir === "/";
            const lines = list.map((item) =>
              isRootWithoutArgs ? item.name : item.isDirectory ? `${item.name}/` : item.name
            );
            result = { stdout: lines.length > 0 ? `${lines.join("\n")}\n` : "", stderr: "", exitCode: 0 };
          }
          break;
        }

        case "cat": {
          if (args.length === 0) {
            result = { stdout: "", stderr: "cat: missing operand\n", exitCode: 1 };
            break;
          }
          let out = "";
          let fail = false;
          for (const arg of args) {
            try {
              const target = normalizeVirtualPath(arg, cwd);
              const stat = await this.vfs.stat(target);
              if (stat.isDirectory) {
                fail = true;
                break;
              }
              const content = await this.vfs.readFile(target);
              out += typeof content === "string" ? content : new TextDecoder().decode(content);
            } catch {
              fail = true;
              break;
            }
          }
          if (fail) {
            result = { stdout: "", stderr: "cat: error reading file\n", exitCode: 1 };
          } else {
            result = { stdout: out, stderr: "", exitCode: 0 };
          }
          break;
        }

        case "echo": {
          const out = args.join(" ") + "\n";
          result = { stdout: out, stderr: "", exitCode: 0 };
          break;
        }

        case "touch": {
          if (args.length === 0) {
            result = { stdout: "", stderr: "touch: missing operand\n", exitCode: 1 };
            break;
          }
          const target = normalizeVirtualPath(args[0]!, cwd);
          const exists = await this.vfs.exists(target);
          if (!exists) {
            await this.vfs.writeFile(target, "");
          }
          result = { stdout: "", stderr: "", exitCode: 0 };
          break;
        }

        case "mkdir": {
          let recursive = false;
          let targetArg: string | undefined;
          for (const arg of args) {
            if (arg === "-p") {
              recursive = true;
            } else if (arg.startsWith("-")) {
              result = { stdout: "", stderr: `mkdir: invalid option -- '${arg}'\n`, exitCode: 1 };
              return { ...result, cwd };
            } else {
              targetArg = arg;
            }
          }

          if (!targetArg) {
            result = { stdout: "", stderr: "mkdir: missing operand\n", exitCode: 1 };
            break;
          }

          const target = normalizeVirtualPath(targetArg, cwd);
          if (await this.vfs.exists(target)) {
            result = { stdout: "", stderr: `mkdir: cannot create directory '${targetArg}': File exists\n`, exitCode: 1 };
          } else {
            await this.vfs.mkdir(target, recursive);
            result = { stdout: "", stderr: "", exitCode: 0 };
          }
          break;
        }

        case "rm": {
          let recursive = false;
          let targetArg: string | undefined;
          for (const arg of args) {
            if (arg === "-r") {
              recursive = true;
            } else if (arg.startsWith("-")) {
              result = { stdout: "", stderr: `rm: invalid option '${arg}'\n`, exitCode: 1 };
              return { ...result, cwd };
            } else {
              targetArg = arg;
            }
          }

          if (!targetArg) {
            result = { stdout: "", stderr: "rm: missing operand\n", exitCode: 1 };
            break;
          }

          const target = normalizeVirtualPath(targetArg, cwd);
          if (target === "/") {
            result = { stdout: "", stderr: "rm: refusing to remove '/'\n", exitCode: 1 };
            break;
          }

          const stat = await this.vfs.stat(target).catch(() => null);
          if (!stat) {
            result = { stdout: "", stderr: `rm: cannot remove '${targetArg}': No such file\n`, exitCode: 1 };
          } else if (stat.isDirectory && !recursive) {
            result = { stdout: "", stderr: `rm: cannot remove '${targetArg}': Is a directory\n`, exitCode: 1 };
          } else {
            await this.vfs.deleteNode(target);
            result = { stdout: "", stderr: "", exitCode: 0 };
          }
          break;
        }

        case "mv": {
          if (args.length !== 2) {
            result = { stdout: "", stderr: "mv: invalid operands\n", exitCode: 1 };
            break;
          }
          const from = normalizeVirtualPath(args[0]!, cwd);
          const to = normalizeVirtualPath(args[1]!, cwd);
          await this.vfs.renameNode(from, to);
          result = { stdout: "", stderr: "", exitCode: 0 };
          break;
        }

        default: {
          return { stdout: "", stderr: `${command}: command not found\n`, exitCode: 127, cwd };
        }
      }
    } catch (err: any) {
      return { stdout: "", stderr: `${err.message}\n`, exitCode: 1, cwd };
    }

    if (result.exitCode === 0 && redirectFile !== null) {
      try {
        const dest = normalizeVirtualPath(redirectFile, cwd);
        if (append) {
          const prev = await this.vfs.readFile(dest).catch(() => "");
          const text = (typeof prev === "string" ? prev : new TextDecoder().decode(prev)) + result.stdout;
          await this.vfs.writeFile(dest, text);
        } else {
          await this.vfs.writeFile(dest, result.stdout);
        }
        return { stdout: "", stderr: "", exitCode: 0, cwd: result.newCwd ?? cwd };
      } catch (err: any) {
        return { stdout: "", stderr: `Redirect failed: ${err.message}\n`, exitCode: 1, cwd };
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      cwd: result.newCwd ?? cwd,
      clear: result.clear,
    };
  }
}

// ==========================================
// 4. Finder Controller
// ==========================================

function assertValidEntryName(name: string): void {
  if (
    !name ||
    typeof name !== "string" ||
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".." ||
    name.trim().length === 0
  ) {
    throw new Error(`Invalid entry name: ${name}`);
  }
}

export class FinderController {
  private path: string;

  constructor(private readonly vfs: MemoryVirtualFileSystem, initialPath = "/") {
    this.path = normalizeVirtualPath(initialPath);
  }

  get currentPath(): string {
    return this.path;
  }

  async list(): Promise<VirtualFileNode[]> {
    return this.vfs.listDirectory(this.path);
  }

  async openFolder(target: string): Promise<void> {
    const nextPath = normalizeVirtualPath(target, this.path);
    const stat = await this.vfs.stat(nextPath);
    if (!stat.isDirectory) {
      throw new Error(`Path is not a directory: ${nextPath}`);
    }
    this.path = nextPath;
  }

  async up(): Promise<void> {
    if (this.path === "/") return;
    const lastSlash = this.path.lastIndexOf("/");
    this.path = lastSlash === 0 ? "/" : this.path.slice(0, lastSlash);
  }

  async createFolder(name: string): Promise<void> {
    assertValidEntryName(name);
    const target = normalizeVirtualPath(name, this.path);
    if (await this.vfs.exists(target)) {
      throw new Error(`Node already exists: ${target}`);
    }
    await this.vfs.mkdir(target);
  }

  async importFile(name: string, data: Uint8Array | string): Promise<void> {
    assertValidEntryName(name);
    const target = normalizeVirtualPath(name, this.path);
    const stat = await this.vfs.stat(target).catch(() => null);
    if (stat && stat.isDirectory) {
      throw new Error(`Cannot overwrite directory with file: ${target}`);
    }
    await this.vfs.writeFile(target, data);
  }

  async rename(from: string, to: string): Promise<void> {
    assertValidEntryName(from);
    assertValidEntryName(to);
    const fromPath = normalizeVirtualPath(from, this.path);
    const toPath = normalizeVirtualPath(to, this.path);
    await this.vfs.renameNode(fromPath, toPath);
  }

  async delete(target: string): Promise<void> {
    assertValidEntryName(target);
    const targetPath = normalizeVirtualPath(target, this.path);
    await this.vfs.deleteNode(targetPath);
  }
}

// ==========================================
// 5. Arc Controller
// ==========================================

export interface ArcView {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  setAudioMuted(muted: boolean): void;
  setBounds(rect: Rect): void;
  destroy(): void;
}

export interface ArcViewOptions {
  bounds?: Rect;
  webPreferences: {
    nodeIntegration: boolean;
    contextIsolation: boolean;
    sandbox: boolean;
    webSecurity: boolean;
    allowRunningInsecureContent: boolean;
  };
  navigationAllowed: (url: string) => boolean;
  permissionAllowed: (permission: string) => boolean;
  downloadAllowed: (url: string) => boolean;
  popupAllowed: (url: string) => boolean;
}

export type ArcViewFactory = (options: ArcViewOptions) => ArcView;

function isValidArcUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== "string") return false;
  if (/[\s\u0000-\u001F\u007F]/.test(urlStr)) return false;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!u.hostname) return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidRect(rect: Rect): boolean {
  return (
    typeof rect === "object" &&
    rect !== null &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    rect.width > 0 &&
    Number.isFinite(rect.height) &&
    rect.height > 0
  );
}

export class ArcController {
  private view: ArcView | null = null;
  private activeUrl: string | null = null;
  private latestRequestId = 0;
  private isDisposed = false;
  private userMuted = false;
  private isRecording = false;

  constructor(private readonly factory?: ArcViewFactory) {
    if (this.factory) {
      this.ensureView();
    }
  }

  private checkDisposed(): void {
    if (this.isDisposed) {
      throw new Error("ArcController is disposed");
    }
  }

  get currentUrl(): string | null {
    return this.activeUrl;
  }

  private ensureView(bounds?: Rect): ArcView | null {
    if (!this.view && this.factory && !this.isDisposed) {
      const options: ArcViewOptions = {
        bounds: bounds ? { ...bounds } : undefined,
        webPreferences: Object.freeze({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        }),
        navigationAllowed: (url: string) => isValidArcUrl(url),
        permissionAllowed: (_perm: string) => false,
        downloadAllowed: (_url: string) => false,
        popupAllowed: (_url: string) => false,
      };
      this.view = this.factory(options);
    }
    return this.view;
  }

  async navigate(targetUrl: string, bounds?: Rect): Promise<void> {
    this.checkDisposed();

    if (!isValidArcUrl(targetUrl)) {
      throw new Error(`Invalid navigation URL: ${targetUrl}`);
    }

    if (bounds && !isValidRect(bounds)) {
      throw new Error("Invalid bounds");
    }

    const view = this.ensureView(bounds);
    if (bounds && view) {
      view.setBounds({ ...bounds });
    }

    const requestId = ++this.latestRequestId;
    if (view) {
      await view.loadURL(targetUrl);
    }

    if (!this.isDisposed && requestId === this.latestRequestId) {
      this.activeUrl = targetUrl;
    }
  }

  back(): void {
    this.checkDisposed();
    if (this.canGoBack()) {
      this.view?.goBack();
    }
  }

  forward(): void {
    this.checkDisposed();
    if (this.canGoForward()) {
      this.view?.goForward();
    }
  }

  reload(): void {
    this.checkDisposed();
    this.view?.reload();
  }

  canGoBack(): boolean {
    this.checkDisposed();
    return this.view?.canGoBack() ?? false;
  }

  canGoForward(): boolean {
    this.checkDisposed();
    return this.view?.canGoForward() ?? false;
  }

  setBounds(rect: Rect): void {
    this.checkDisposed();
    if (!isValidRect(rect)) {
      throw new Error("Invalid bounds");
    }
    this.view?.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  setMuted(muted: boolean): void {
    this.checkDisposed();
    this.userMuted = muted;
    if (!this.isRecording) {
      this.view?.setAudioMuted(muted);
    }
  }

  setRecording(recording: boolean): void {
    this.checkDisposed();
    this.isRecording = recording;
    if (recording) {
      this.view?.setAudioMuted(true);
    } else {
      this.view?.setAudioMuted(this.userMuted);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.view?.destroy();
    this.view = null;
  }
}

// ==========================================
// 6. Media Playback Controller
// ==========================================

export interface MediaElementLike {
  src: string;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
}

export class MediaPlaybackController {
  private isDisposed = false;

  constructor(
    readonly element: MediaElementLike,
    readonly appKind: "quicktime" | "photobooth"
  ) {}

  private checkDisposed(): void {
    if (this.isDisposed) {
      throw new Error("MediaPlaybackController is disposed");
    }
  }

  setSource(uri: string, kind: "audio" | "video"): void {
    this.checkDisposed();

    if (
      typeof uri !== "string" ||
      !uri.startsWith("blob:") ||
      /[\s\u0000-\u001F\u007F]/.test(uri) ||
      uri === "blob:"
    ) {
      throw new Error(`Invalid source URI: ${uri}`);
    }

    if (this.appKind === "photobooth" && kind === "audio") {
      throw new Error("Photo Booth only accepts video sources");
    }

    this.element.pause();
    this.element.currentTime = 0;
    this.element.src = uri;
    this.element.load();
  }

  async play(): Promise<void> {
    this.checkDisposed();
    await this.element.play();
  }

  pause(): void {
    this.checkDisposed();
    this.element.pause();
  }

  seek(time: number): void {
    this.checkDisposed();
    if (!Number.isFinite(time)) {
      return;
    }

    const dur = this.element.duration;
    const max = Number.isFinite(dur) && dur > 0 ? dur : 0;
    this.element.currentTime = Math.max(0, Math.min(max, time));
  }

  setVolume(vol: number): void {
    this.checkDisposed();
    if (!Number.isFinite(vol)) {
      return;
    }
    this.element.volume = Math.max(0, Math.min(1, vol));
  }

  setMuted(muted: boolean): void {
    this.checkDisposed();
    this.element.muted = muted;
  }

  getAudioStream(): any | null {
    if (this.isDisposed) return null;
    try {
      const el = this.element as any;
      const capture = el.captureStream ?? el.mozCaptureStream;
      if (typeof capture !== "function") return null;
      const stream = capture.call(el);
      if (!stream || typeof stream.getAudioTracks !== "function") return null;
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return null;

      const GlobalMediaStream = (globalThis as any).MediaStream;
      if (typeof GlobalMediaStream === "function") {
        return new GlobalMediaStream(audioTracks);
      }
      return stream;
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.element.pause();
    this.element.src = "";
    this.element.load();
  }
}
