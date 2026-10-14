import type { IVirtualFileSystem, VirtualFileNode } from "@cutaway/types";

export interface VfsFileEntry {
  path: string;
  isDirectory: false;
  data: number[] | string;
  lastModifiedMs: number;
}

export interface VfsDirectoryEntry {
  path: string;
  isDirectory: true;
  lastModifiedMs: number;
}

export type VfsEntry = VfsFileEntry | VfsDirectoryEntry;

export interface VfsSnapshot {
  version: 1;
  entries: VfsEntry[];
}

export interface MemoryVirtualFileSystemOptions {
  now?: () => number;
  snapshot?: VfsSnapshot;
}

export function normalizeVirtualPath(input: string, cwd = "/"): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("Path must be a non-empty string");
  }

  if (input.includes("\0") || input.includes("\\") || /^[a-zA-Z]:/.test(input)) {
    throw new Error(`Path contains invalid characters or drive specifiers: ${input}`);
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
    throw new Error(`Path contains URI scheme: ${input}`);
  }

  let full = input.startsWith("/") ? input : `${cwd.endsWith("/") ? cwd : cwd + "/"}${input}`;
  
  // Clean double slashes
  full = full.replace(/\/+/g, "/");

  const segments = full.split("/");
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (resolved.length === 0) {
        throw new Error("Path traverses above the root directory");
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  return "/" + resolved.join("/");
}

interface StoredNode {
  path: string;
  name: string;
  isDirectory: boolean;
  data?: Uint8Array | string;
  lastModifiedMs: number;
}

function cloneData(data: Uint8Array | string | undefined): Uint8Array | string | undefined {
  if (data === undefined) return undefined;
  if (typeof data === "string") return data;
  return new Uint8Array(data);
}

function measureBytes(data: Uint8Array | string | undefined): number {
  if (data === undefined) return 0;
  if (typeof data === "string") return new TextEncoder().encode(data).length;
  return data.byteLength;
}

export class MemoryVirtualFileSystem implements IVirtualFileSystem {
  private readonly now: () => number;
  private readonly nodes = new Map<string, StoredNode>();

  constructor(options: MemoryVirtualFileSystemOptions = {}) {
    this.now = options.now ?? (() => Date.now());

    // Root directory always exists
    this.nodes.set("/", {
      path: "/",
      name: "",
      isDirectory: true,
      lastModifiedMs: this.now(),
    });

    if (options.snapshot) {
      this.loadSnapshot(options.snapshot);
    }
  }

  private loadSnapshot(snapshot: VfsSnapshot): void {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.entries)
    ) {
      throw new Error("Invalid snapshot format");
    }

    const seenPaths = new Set<string>();

    // Verify snapshot entries
    for (const entry of snapshot.entries as any[]) {
      if (!entry || typeof entry !== "object") throw new Error("Invalid snapshot entry");
      if (typeof entry.path !== "string" || !entry.path.startsWith("/")) {
        throw new Error(`Invalid path in snapshot: ${entry.path}`);
      }
      // Path must be canonical
      try {
        if (normalizeVirtualPath(entry.path) !== entry.path) {
          throw new Error(`Non-canonical path in snapshot: ${entry.path}`);
        }
      } catch {
        throw new Error(`Non-canonical path in snapshot: ${entry.path}`);
      }

      if (seenPaths.has(entry.path)) {
        throw new Error(`Duplicate path in snapshot: ${entry.path}`);
      }
      seenPaths.add(entry.path);

      if (typeof entry.isDirectory !== "boolean") {
        throw new Error(`Invalid isDirectory flag in snapshot: ${entry.path}`);
      }
      if (!Number.isFinite(entry.lastModifiedMs)) {
        throw new Error(`Invalid lastModifiedMs in snapshot: ${entry.path}`);
      }

      if (entry.isDirectory) {
        if ("data" in entry && entry.data !== undefined) {
          throw new Error(`Directory entry must not contain data in snapshot: ${entry.path}`);
        }
      } else {
        if (typeof entry.data !== "string" && !Array.isArray(entry.data) && !(entry.data instanceof Uint8Array)) {
          throw new Error(`Invalid file data in snapshot: ${entry.path}`);
        }
        if (Array.isArray(entry.data)) {
          for (const byte of entry.data) {
            if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
              throw new Error(`Invalid byte array in snapshot: ${entry.path}`);
            }
          }
        }
      }
    }

    // Sort by path length to ensure parents are verified or created
    const sorted = [...snapshot.entries].sort((a, b) => a.path.length - b.path.length);
    for (const entry of sorted as any[]) {
      if (entry.path === "/") continue;
      const parent = this.getParentPath(entry.path);
      const parentNode = this.nodes.get(parent);
      if (!parentNode || !parentNode.isDirectory) {
        throw new Error(`Missing parent directory in snapshot for: ${entry.path}`);
      }

      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      let storedData: Uint8Array | string | undefined;
      if (!entry.isDirectory) {
        if (typeof entry.data === "string") {
          storedData = entry.data;
        } else if (Array.isArray(entry.data)) {
          storedData = new Uint8Array(entry.data);
        } else if (entry.data instanceof Uint8Array) {
          storedData = new Uint8Array(entry.data);
        }
      }

      this.nodes.set(entry.path, {
        path: entry.path,
        name,
        isDirectory: entry.isDirectory,
        data: storedData,
        lastModifiedMs: entry.lastModifiedMs,
      });
    }
  }

  private getParentPath(canonical: string): string {
    if (canonical === "/") return "/";
    const lastSlash = canonical.lastIndexOf("/");
    return lastSlash === 0 ? "/" : canonical.slice(0, lastSlash);
  }

  async exists(path: string): Promise<boolean> {
    const canonical = normalizeVirtualPath(path);
    return this.nodes.has(canonical);
  }

  async readFile(path: string): Promise<Uint8Array | string> {
    const canonical = normalizeVirtualPath(path);
    const node = this.nodes.get(canonical);
    if (!node) {
      throw new Error(`File not found: ${canonical}`);
    }
    if (node.isDirectory) {
      throw new Error(`Cannot readFile on directory: ${canonical}`);
    }
    return cloneData(node.data)!;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const canonical = normalizeVirtualPath(path);
    if (canonical === "/") {
      throw new Error("Cannot write file to root");
    }

    const parentPath = this.getParentPath(canonical);
    const parent = this.nodes.get(parentPath);
    if (!parent) {
      throw new Error(`Parent directory does not exist: ${parentPath}`);
    }
    if (!parent.isDirectory) {
      throw new Error(`Parent is not a directory: ${parentPath}`);
    }

    const existing = this.nodes.get(canonical);
    if (existing && existing.isDirectory) {
      throw new Error(`Cannot overwrite directory with file: ${canonical}`);
    }

    const name = canonical.slice(canonical.lastIndexOf("/") + 1);
    this.nodes.set(canonical, {
      path: canonical,
      name,
      isDirectory: false,
      data: cloneData(data),
      lastModifiedMs: this.now(),
    });
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    const canonical = normalizeVirtualPath(path);
    if (canonical === "/") return;

    const existing = this.nodes.get(canonical);
    if (existing) {
      if (existing.isDirectory) return;
      throw new Error(`Cannot mkdir over existing file: ${canonical}`);
    }

    const parentPath = this.getParentPath(canonical);
    const parent = this.nodes.get(parentPath);

    if (!parent) {
      if (recursive) {
        await this.mkdir(parentPath, true);
      } else {
        throw new Error(`Parent directory does not exist: ${parentPath}`);
      }
    } else if (!parent.isDirectory) {
      throw new Error(`Parent is a file: ${parentPath}`);
    }

    const name = canonical.slice(canonical.lastIndexOf("/") + 1);
    this.nodes.set(canonical, {
      path: canonical,
      name,
      isDirectory: true,
      lastModifiedMs: this.now(),
    });
  }

  async listDirectory(path: string): Promise<VirtualFileNode[]> {
    const canonical = normalizeVirtualPath(path);
    const dir = this.nodes.get(canonical);
    if (!dir) {
      throw new Error(`Directory does not exist: ${canonical}`);
    }
    if (!dir.isDirectory) {
      throw new Error(`Path is a file, not a directory: ${canonical}`);
    }

    const prefix = canonical === "/" ? "/" : `${canonical}/`;
    const results: VirtualFileNode[] = [];

    for (const [nodePath, node] of this.nodes.entries()) {
      if (nodePath === canonical) continue;
      if (nodePath.startsWith(prefix)) {
        const remainder = nodePath.slice(prefix.length);
        if (!remainder.includes("/")) {
          results.push({
            path: node.path,
            name: node.name,
            isDirectory: node.isDirectory,
            sizeBytes: measureBytes(node.data),
            lastModifiedMs: node.lastModifiedMs,
          });
        }
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async deleteNode(path: string): Promise<void> {
    const canonical = normalizeVirtualPath(path);
    if (canonical === "/") {
      throw new Error("Cannot delete root directory");
    }

    const node = this.nodes.get(canonical);
    if (!node) {
      throw new Error(`Node not found: ${canonical}`);
    }

    const prefix = `${canonical}/`;
    const toDelete: string[] = [canonical];

    for (const nodePath of this.nodes.keys()) {
      if (nodePath.startsWith(prefix)) {
        toDelete.push(nodePath);
      }
    }

    for (const p of toDelete) {
      this.nodes.delete(p);
    }
  }

  async renameNode(from: string, to: string): Promise<void> {
    const sourceCanonical = normalizeVirtualPath(from);
    const destCanonical = normalizeVirtualPath(to);

    if (sourceCanonical === destCanonical) {
      if (!this.nodes.has(sourceCanonical)) {
        throw new Error(`Source does not exist: ${sourceCanonical}`);
      }
      return;
    }

    if (sourceCanonical === "/" || destCanonical === "/") {
      throw new Error("Cannot rename root directory");
    }

    const source = this.nodes.get(sourceCanonical);
    if (!source) {
      throw new Error(`Source does not exist: ${sourceCanonical}`);
    }

    if (this.nodes.has(destCanonical)) {
      throw new Error(`Destination already exists: ${destCanonical}`);
    }

    const destParentPath = this.getParentPath(destCanonical);
    const destParent = this.nodes.get(destParentPath);
    if (!destParent) {
      throw new Error(`Destination parent directory does not exist: ${destParentPath}`);
    }
    if (!destParent.isDirectory) {
      throw new Error(`Destination parent is not a directory: ${destParentPath}`);
    }

    if (source.isDirectory) {
      if (destCanonical.startsWith(`${sourceCanonical}/`)) {
        throw new Error("Cannot move directory into a subdirectory of itself");
      }

      const prefix = `${sourceCanonical}/`;
      const entriesToMove: StoredNode[] = [source];

      for (const [nodePath, node] of this.nodes.entries()) {
        if (nodePath.startsWith(prefix)) {
          entriesToMove.push(node);
        }
      }

      for (const entry of entriesToMove) {
        this.nodes.delete(entry.path);
        const relative = entry.path === sourceCanonical ? "" : entry.path.slice(sourceCanonical.length);
        const newPath = `${destCanonical}${relative}`;
        const newName = newPath.slice(newPath.lastIndexOf("/") + 1);
        this.nodes.set(newPath, {
          ...entry,
          path: newPath,
          name: newName,
        });
      }
    } else {
      this.nodes.delete(sourceCanonical);
      const newName = destCanonical.slice(destCanonical.lastIndexOf("/") + 1);
      this.nodes.set(destCanonical, {
        ...source,
        path: destCanonical,
        name: newName,
      });
    }
  }

  async stat(path: string): Promise<VirtualFileNode> {
    const canonical = normalizeVirtualPath(path);
    const node = this.nodes.get(canonical);
    if (!node) {
      throw new Error(`Path does not exist: ${canonical}`);
    }
    return {
      path: node.path,
      name: node.name,
      isDirectory: node.isDirectory,
      sizeBytes: measureBytes(node.data),
      lastModifiedMs: node.lastModifiedMs,
    };
  }

  snapshot(): VfsSnapshot {
    const entries: VfsEntry[] = [];
    for (const node of this.nodes.values()) {
      if (node.path === "/") continue;
      if (node.isDirectory) {
        entries.push({
          path: node.path,
          isDirectory: true,
          lastModifiedMs: node.lastModifiedMs,
        });
      } else {
        const data =
          typeof node.data === "string"
            ? node.data
            : node.data instanceof Uint8Array
            ? Array.from(node.data)
            : [];
        entries.push({
          path: node.path,
          isDirectory: false,
          data,
          lastModifiedMs: node.lastModifiedMs,
        });
      }
    }
    return {
      version: 1,
      entries,
    };
  }
}
