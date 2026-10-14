import { describe, expect, expectTypeOf, it } from "vitest";
import type { IVirtualFileSystem, VirtualFileNode } from "@cutaway/types";
import {
  MemoryVirtualFileSystem,
  normalizeVirtualPath,
} from "../../packages/desktop-engine/src/stage/vfs/index";
import type { VfsSnapshot } from "../../packages/desktop-engine/src/stage/vfs/index";

/** A controllable injected clock, so `lastModifiedMs` is never wall-clock. */
function fakeClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    set(value: number) {
      current = value;
    },
  };
}

function bytes(value: Uint8Array | string): number[] {
  return Array.from(typeof value === "string" ? new TextEncoder().encode(value) : value);
}

function names(nodes: VirtualFileNode[]): string[] {
  return nodes.map((node) => node.name);
}

describe("normalizeVirtualPath", () => {
  it("keeps the root canonical", () => {
    expect(normalizeVirtualPath("/")).toBe("/");
    expect(normalizeVirtualPath("//")).toBe("/");
    expect(normalizeVirtualPath("///")).toBe("/");
    expect(normalizeVirtualPath("/.")).toBe("/");
    expect(normalizeVirtualPath(".")).toBe("/");
  });

  it("normalizes repeated separators and dot segments", () => {
    expect(normalizeVirtualPath("/a/b")).toBe("/a/b");
    expect(normalizeVirtualPath("/a//b")).toBe("/a/b");
    expect(normalizeVirtualPath("/a/./b")).toBe("/a/b");
    expect(normalizeVirtualPath("/a/b/")).toBe("/a/b");
    expect(normalizeVirtualPath("/a/b/.")).toBe("/a/b");
    expect(normalizeVirtualPath("./a/../b")).toBe("/b");
    expect(normalizeVirtualPath("/a/b/../c")).toBe("/a/c");
  });

  it("resolves relative paths against the working directory", () => {
    expect(normalizeVirtualPath("a/b")).toBe("/a/b");
    expect(normalizeVirtualPath("a/b", "/docs")).toBe("/docs/a/b");
    expect(normalizeVirtualPath("a", "/docs/")).toBe("/docs/a");
    expect(normalizeVirtualPath("../a", "/docs/x")).toBe("/docs/a");
    expect(normalizeVirtualPath("..", "/docs/x")).toBe("/docs");
    expect(normalizeVirtualPath("./c", "/docs")).toBe("/docs/c");
  });

  it("preserves Unicode and spaces in names", () => {
    expect(normalizeVirtualPath("/héllo wörld")).toBe("/héllo wörld");
    expect(normalizeVirtualPath("/日本語/ファイル.txt")).toBe("/日本語/ファイル.txt");
    expect(normalizeVirtualPath("my file.txt")).toBe("/my file.txt");
    expect(normalizeVirtualPath("/a b//c d/")).toBe("/a b/c d");
  });

  it("rejects traversal above the root", () => {
    expect(() => normalizeVirtualPath("/..")).toThrow();
    expect(() => normalizeVirtualPath("/a/../../b")).toThrow();
    expect(() => normalizeVirtualPath("../a")).toThrow();
    expect(() => normalizeVirtualPath("../..", "/docs")).toThrow();
    expect(() => normalizeVirtualPath("../../x", "/docs")).toThrow();
  });

  it("rejects NUL bytes, backslashes and drive paths", () => {
    expect(() => normalizeVirtualPath("/a\u0000b")).toThrow();
    expect(() => normalizeVirtualPath("\u0000")).toThrow();
    expect(() => normalizeVirtualPath("/a\\b")).toThrow();
    expect(() => normalizeVirtualPath("a\\b")).toThrow();
    expect(() => normalizeVirtualPath("C:/x")).toThrow();
    expect(() => normalizeVirtualPath("c:\\x")).toThrow();
    expect(() => normalizeVirtualPath("C:x")).toThrow();
  });

  it("rejects URI schemes", () => {
    expect(() => normalizeVirtualPath("file:///x")).toThrow();
    expect(() => normalizeVirtualPath("http://example.com/x")).toThrow();
    expect(() => normalizeVirtualPath("https://example.com/x")).toThrow();
    expect(() => normalizeVirtualPath("blob:https://example.com/x")).toThrow();
    expect(() => normalizeVirtualPath("data:text/html,<h1>x</h1>")).toThrow();
    expect(() => normalizeVirtualPath("javascript:alert(1)")).toThrow();
  });

  it("rejects the empty path", () => {
    expect(() => normalizeVirtualPath("")).toThrow();
  });
});

describe("MemoryVirtualFileSystem", () => {
  it("conforms to the shared IVirtualFileSystem contract", () => {
    expectTypeOf<MemoryVirtualFileSystem>().toMatchTypeOf<IVirtualFileSystem>();
  });

  it("starts with an empty but existing root", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await expect(vfs.exists("/")).resolves.toBe(true);
    await expect(vfs.listDirectory("/")).resolves.toEqual([]);
  });

  it("writes and reads string files", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.writeFile("/notes.txt", "hello");
    const content = await vfs.readFile("/notes.txt");
    expect(typeof content).toBe("string");
    expect(content).toBe("hello");

    const listing = await vfs.listDirectory("/");
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({
      path: "/notes.txt",
      name: "notes.txt",
      isDirectory: false,
      sizeBytes: 5,
    });
    expect(typeof listing[0]?.lastModifiedMs).toBe("number");
  });

  it("returns binary data as isolated copies", async () => {
    const vfs = new MemoryVirtualFileSystem();
    const input = new Uint8Array([0, 1, 2, 255]);
    await vfs.writeFile("/blob.bin", input);

    const first = await vfs.readFile("/blob.bin");
    expect(first).toBeInstanceOf(Uint8Array);
    expect(bytes(first)).toEqual([0, 1, 2, 255]);
    expect(first).not.toBe(input);

    // Mutating the caller's buffer after the write must not reach the store.
    input[0] = 99;
    // Mutating a returned buffer must not reach the store either.
    (first as Uint8Array)[0] = 77;

    const second = await vfs.readFile("/blob.bin");
    expect(bytes(second)).toEqual([0, 1, 2, 255]);

    const listing = await vfs.listDirectory("/");
    expect(listing[0]?.sizeBytes).toBe(4);
  });

  it("measures string size in UTF-8 bytes", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.writeFile("/accent.txt", "héllo");
    await vfs.writeFile("/cjk.txt", "日本語");
    await vfs.writeFile("/ascii.txt", "abc");

    const listing = await vfs.listDirectory("/");
    const size = (name: string) => listing.find((node) => node.name === name)?.sizeBytes;
    expect(size("accent.txt")).toBe(6);
    expect(size("cjk.txt")).toBe(9);
    expect(size("ascii.txt")).toBe(3);
  });

  it("requires an existing directory parent for writes", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await expect(vfs.writeFile("/missing/a.txt", "x")).rejects.toThrow();
    await vfs.writeFile("/file.txt", "x");
    await expect(vfs.writeFile("/file.txt/child.txt", "x")).rejects.toThrow();
  });

  it("never overwrites a directory with a file", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.mkdir("/dir");
    await expect(vfs.writeFile("/dir", "x")).rejects.toThrow();
    await expect(vfs.listDirectory("/dir")).resolves.toEqual([]);
  });

  it("rejects invalid paths on every entry point", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await expect(vfs.readFile("/../x")).rejects.toThrow();
    await expect(vfs.writeFile("C:/x", "x")).rejects.toThrow();
    await expect(vfs.listDirectory("file:///x")).rejects.toThrow();
    await expect(vfs.exists("/a\u0000b")).rejects.toThrow();
    await expect(vfs.deleteNode("")).rejects.toThrow();
    await expect(vfs.mkdir("/a\\b")).rejects.toThrow();
  });

  it("rejects reading a directory or a missing node", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.mkdir("/dir");
    await expect(vfs.readFile("/dir")).rejects.toThrow();
    await expect(vfs.readFile("/missing.txt")).rejects.toThrow();
  });

  it("rejects listing a file or a missing directory", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.writeFile("/file.txt", "x");
    await expect(vfs.listDirectory("/file.txt")).rejects.toThrow();
    await expect(vfs.listDirectory("/missing")).rejects.toThrow();
  });

  it("lists only immediate children, sorted by name", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.writeFile("/b.txt", "b");
    await vfs.writeFile("/a.txt", "a");
    await vfs.mkdir("/z");
    await vfs.mkdir("/m");
    await vfs.writeFile("/m/n.txt", "n");

    const root = await vfs.listDirectory("/");
    expect(names(root)).toEqual(["a.txt", "b.txt", "m", "z"]);
    expect(root.find((node) => node.name === "m")?.isDirectory).toBe(true);
    expect(root.find((node) => node.name === "m")?.sizeBytes).toBe(0);

    const nested = await vfs.listDirectory("/m");
    expect(names(nested)).toEqual(["n.txt"]);
    expect(nested[0]?.path).toBe("/m/n.txt");
  });

  it("returns defensive listing metadata", async () => {
    const vfs = new MemoryVirtualFileSystem();
    await vfs.writeFile("/a.txt", "a");

    const first = await vfs.listDirectory("/");
    first[0]!.name = "tampered";
    first[0]!.sizeBytes = 9999;
    first.length = 0;

    const second = await vfs.listDirectory("/");
    expect(names(second)).toEqual(["a.txt"]);
    expect(second[0]?.sizeBytes).toBe(1);
  });

  it("stamps lastModifiedMs from the injected clock", async () => {
    const clock = fakeClock(1_000);
    const vfs = new MemoryVirtualFileSystem({ now: clock.now });

    await vfs.writeFile("/a.txt", "a");
    clock.set(2_000);
    await vfs.writeFile("/b.txt", "b");
    clock.set(3_000);
    await vfs.writeFile("/a.txt", "a2");

    const listing = await vfs.listDirectory("/");
    const stamp = (name: string) => listing.find((node) => node.name === name)?.lastModifiedMs;
    expect(stamp("a.txt")).toBe(3_000);
    expect(stamp("b.txt")).toBe(2_000);

    clock.set(4_000);
    await vfs.mkdir("/dir");
    const withDir = await vfs.listDirectory("/");
    expect(withDir.find((node) => node.name === "dir")?.lastModifiedMs).toBe(4_000);
  });

  describe("mkdir", () => {
    it("creates a single directory non-recursively", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.mkdir("/dir");
      await expect(vfs.exists("/dir")).resolves.toBe(true);
      const listing = await vfs.listDirectory("/");
      expect(listing).toHaveLength(1);
      expect(listing[0]?.isDirectory).toBe(true);
    });

    it("is idempotent for an existing directory", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.mkdir("/dir");
      await expect(vfs.mkdir("/dir")).resolves.toBeUndefined();
      await expect(vfs.listDirectory("/")).resolves.toHaveLength(1);
    });

    it("rejects a path occupied by a file", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/file.txt", "x");
      await expect(vfs.mkdir("/file.txt")).rejects.toThrow();
      await expect(vfs.readFile("/file.txt")).resolves.toBe("x");
    });

    it("requires the parent unless recursive", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await expect(vfs.mkdir("/a/b")).rejects.toThrow();
      await vfs.mkdir("/a/b/c", true);
      await expect(vfs.exists("/a/b/c")).resolves.toBe(true);
    });

    it("rejects a parent that is a file", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/file.txt", "x");
      await expect(vfs.mkdir("/file.txt/child", true)).rejects.toThrow();
    });
  });

  describe("deleteNode", () => {
    it("removes files and directory subtrees", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "a");
      await vfs.mkdir("/dir/sub", true);
      await vfs.writeFile("/dir/sub/deep.txt", "deep");

      await vfs.deleteNode("/a.txt");
      await expect(vfs.exists("/a.txt")).resolves.toBe(false);

      await vfs.deleteNode("/dir");
      await expect(vfs.exists("/dir")).resolves.toBe(false);
      await expect(vfs.exists("/dir/sub/deep.txt")).resolves.toBe(false);
    });

    it("rejects missing nodes and the root", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await expect(vfs.deleteNode("/missing")).rejects.toThrow();
      await expect(vfs.deleteNode("/")).rejects.toThrow();
      await expect(vfs.exists("/")).resolves.toBe(true);
    });
  });

  describe("renameNode", () => {
    it("moves files atomically", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "payload");
      await vfs.renameNode("/a.txt", "/renamed.txt");

      await expect(vfs.exists("/a.txt")).resolves.toBe(false);
      await expect(vfs.readFile("/renamed.txt")).resolves.toBe("payload");
    });

    it("moves a directory subtree", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.mkdir("/dir/sub", true);
      await vfs.writeFile("/dir/sub/deep.txt", "deep");
      await vfs.renameNode("/dir", "/moved");

      await expect(vfs.exists("/dir")).resolves.toBe(false);
      await expect(vfs.readFile("/moved/sub/deep.txt")).resolves.toBe("deep");
    });

    it("rejects an existing destination", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "a");
      await vfs.writeFile("/b.txt", "b");
      await expect(vfs.renameNode("/a.txt", "/b.txt")).rejects.toThrow();
      await expect(vfs.readFile("/a.txt")).resolves.toBe("a");
      await expect(vfs.readFile("/b.txt")).resolves.toBe("b");
    });

    it("rejects a missing source or destination parent", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await expect(vfs.renameNode("/missing.txt", "/x.txt")).rejects.toThrow();
      await vfs.writeFile("/a.txt", "a");
      await expect(vfs.renameNode("/a.txt", "/nodir/x.txt")).rejects.toThrow();
      await expect(vfs.readFile("/a.txt")).resolves.toBe("a");
    });

    it("rejects a destination parent that is a file", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/file.txt", "x");
      await vfs.writeFile("/a.txt", "a");
      await expect(vfs.renameNode("/a.txt", "/file.txt/child")).rejects.toThrow();
    });

    it("protects the root as source and destination", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "a");
      await expect(vfs.renameNode("/", "/x")).rejects.toThrow();
      await expect(vfs.renameNode("/a.txt", "/")).rejects.toThrow();
      await expect(vfs.exists("/a.txt")).resolves.toBe(true);
    });

    it("refuses to move a directory inside itself", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.mkdir("/dir/sub", true);
      await expect(vfs.renameNode("/dir", "/dir/sub/dir")).rejects.toThrow();
      await expect(vfs.exists("/dir/sub")).resolves.toBe(true);
    });

    it("treats an unchanged path as a no-op when it exists", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "a");
      await expect(vfs.renameNode("/a.txt", "/a.txt")).resolves.toBeUndefined();
      await expect(vfs.readFile("/a.txt")).resolves.toBe("a");
      await expect(vfs.renameNode("/missing.txt", "/missing.txt")).rejects.toThrow();
    });
  });

  describe("exists", () => {
    it("tracks files and directories", async () => {
      const vfs = new MemoryVirtualFileSystem();
      await vfs.writeFile("/a.txt", "a");
      await vfs.mkdir("/dir");

      await expect(vfs.exists("/a.txt")).resolves.toBe(true);
      await expect(vfs.exists("/dir")).resolves.toBe(true);
      await expect(vfs.exists("/dir/../a.txt")).resolves.toBe(true);
      await expect(vfs.exists("/missing")).resolves.toBe(false);
    });
  });

  describe("snapshots", () => {
    async function populated() {
      const clock = fakeClock(5_000);
      const vfs = new MemoryVirtualFileSystem({ now: clock.now });
      await vfs.writeFile("/a.txt", "alpha");
      await vfs.writeFile("/blob.bin", new Uint8Array([1, 2, 3]));
      await vfs.mkdir("/dir");
      await vfs.writeFile("/dir/nested.txt", "nested");
      return vfs;
    }

    it("produces a JSON-safe, detached snapshot", async () => {
      const vfs = await populated();
      const snapshot = vfs.snapshot();
      expect(snapshot.version).toBe(1);
      expect(Array.isArray(snapshot.entries)).toBe(true);

      const cloned = JSON.parse(JSON.stringify(snapshot)) as VfsSnapshot;
      expect(cloned.entries).toHaveLength(4);

      const file = snapshot.entries.find((entry) => entry.path === "/a.txt");
      expect(file?.isDirectory).toBe(false);
      expect(file?.data).toBe("alpha");
      expect(file?.lastModifiedMs).toBe(5_000);

      const binary = snapshot.entries.find((entry) => entry.path === "/blob.bin");
      expect(binary?.data).toEqual([1, 2, 3]);

      const directory = snapshot.entries.find((entry) => entry.path === "/dir");
      expect(directory?.isDirectory).toBe(true);
      expect(directory?.data).toBeUndefined();
    });

    it("returns entries that cannot mutate the file system", async () => {
      const vfs = await populated();
      const snapshot = vfs.snapshot();
      for (const entry of snapshot.entries) entry.lastModifiedMs = -1;
      snapshot.entries.length = 0;

      const first = vfs.snapshot();
      expect(first.entries).toHaveLength(4);
      expect(first.entries.find((entry) => entry.path === "/a.txt")?.lastModifiedMs).toBe(5_000);
    });

    it("round-trips through the constructor", async () => {
      const vfs = await populated();
      const restored = new MemoryVirtualFileSystem({ snapshot: vfs.snapshot() });

      await expect(restored.readFile("/a.txt")).resolves.toBe("alpha");
      await expect(restored.readFile("/blob.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));
      await expect(restored.listDirectory("/dir")).resolves.toEqual(
        await vfs.listDirectory("/dir"),
      );
      expect(names(await restored.listDirectory("/"))).toEqual(
        names(await vfs.listDirectory("/")),
      );
    });

    it("detaches the snapshot supplied to the constructor", async () => {
      const vfs = await populated();
      const snapshot = JSON.parse(JSON.stringify(vfs.snapshot())) as VfsSnapshot;
      const restored = new MemoryVirtualFileSystem({ snapshot });

      snapshot.entries.length = 0;
      await expect(restored.readFile("/a.txt")).resolves.toBe("alpha");
    });

    it("rejects malformed snapshot shapes", () => {
      const valid = (entries: unknown[]): VfsSnapshot =>
        ({ version: 1, entries }) as unknown as VfsSnapshot;
      const file = (path: string, data: unknown, lastModifiedMs = 1) => ({
        path,
        isDirectory: false,
        data,
        lastModifiedMs,
      });

      expect(
        () => new MemoryVirtualFileSystem({ snapshot: { version: 2, entries: [] } as unknown as VfsSnapshot }),
      ).toThrow();
      expect(
        () => new MemoryVirtualFileSystem({ snapshot: { entries: [] } as unknown as VfsSnapshot }),
      ).toThrow();
      expect(
        () => new MemoryVirtualFileSystem({ snapshot: { version: 1, entries: "nope" } as unknown as VfsSnapshot }),
      ).toThrow();
      expect(
        () =>
          new MemoryVirtualFileSystem({
            snapshot: valid([{ path: 42, isDirectory: false, data: "x", lastModifiedMs: 1 }]),
          }),
      ).toThrow();
      expect(
        () =>
          new MemoryVirtualFileSystem({
            snapshot: valid([{ path: "/a", isDirectory: "no", data: "x", lastModifiedMs: 1 }]),
          }),
      ).toThrow();
      expect(
        () =>
          new MemoryVirtualFileSystem({
            snapshot: valid([file("/a.txt", "x", Number.NaN)]),
          }),
      ).toThrow();
    });

    it("rejects duplicate and non-canonical snapshot paths", () => {
      const snap = (entries: unknown[]): VfsSnapshot =>
        ({ version: 1, entries }) as unknown as VfsSnapshot;

      expect(() =>
        new MemoryVirtualFileSystem({
          snapshot: snap([
            { path: "/a.txt", isDirectory: false, data: "a", lastModifiedMs: 1 },
            { path: "/a.txt", isDirectory: false, data: "b", lastModifiedMs: 1 },
          ]),
        }),
      ).toThrow();

      for (const path of ["a.txt", "/a//b.txt", "/a/./b.txt", "/a/../b.txt", "/a\\b.txt", ""]) {
        expect(() =>
          new MemoryVirtualFileSystem({
            snapshot: snap([{ path, isDirectory: false, data: "x", lastModifiedMs: 1 }]),
          }),
        ).toThrow();
      }
    });

    it("rejects invalid file data and broken parent trees", () => {
      const snap = (entries: unknown[]): VfsSnapshot =>
        ({ version: 1, entries }) as unknown as VfsSnapshot;
      const dir = (path: string) => ({ path, isDirectory: true, lastModifiedMs: 1 });

      expect(() =>
        new MemoryVirtualFileSystem({
          snapshot: snap([{ path: "/a.bin", isDirectory: false, lastModifiedMs: 1 }]),
        }),
      ).toThrow();

      for (const data of [[256], [-1], [1.5], ["ok", 256], 7]) {
        expect(() =>
          new MemoryVirtualFileSystem({
            snapshot: snap([{ path: "/a.bin", isDirectory: false, data, lastModifiedMs: 1 }]),
          }),
        ).toThrow();
      }

      // A file without its parent directory.
      expect(() =>
        new MemoryVirtualFileSystem({
          snapshot: snap([{ path: "/missing/a.txt", isDirectory: false, data: "x", lastModifiedMs: 1 }]),
        }),
      ).toThrow();

      // A file whose parent is a file.
      expect(() =>
        new MemoryVirtualFileSystem({
          snapshot: snap([
            { path: "/a.txt", isDirectory: false, data: "x", lastModifiedMs: 1 },
            { path: "/a.txt/child.txt", isDirectory: false, data: "x", lastModifiedMs: 1 },
          ]),
        }),
      ).toThrow();

      // A directory listing data is invalid.
      expect(() =>
        new MemoryVirtualFileSystem({
          snapshot: snap([{ path: "/dir", isDirectory: true, data: "x", lastModifiedMs: 1 }]),
        }),
      ).toThrow();

      // A valid directory entry still needs its parent.
      expect(() =>
        new MemoryVirtualFileSystem({ snapshot: snap([dir("/a/b"), dir("/a/b/c")]) }),
      ).toThrow();
    });

    it("leaves no partially populated state when a snapshot is rejected", async () => {
      const snapshot = {
        version: 1,
        entries: [
          { path: "/ok.txt", isDirectory: false, data: "x", lastModifiedMs: 1 },
          { path: "/bad.txt", isDirectory: false, data: [999], lastModifiedMs: 1 },
        ],
      } as unknown as VfsSnapshot;

      expect(() => new MemoryVirtualFileSystem({ snapshot })).toThrow();

      const fresh = new MemoryVirtualFileSystem();
      await expect(fresh.listDirectory("/")).resolves.toEqual([]);

      // And a later valid snapshot still loads cleanly.
      const restored = new MemoryVirtualFileSystem({
        snapshot: {
          version: 1,
          entries: [{ path: "/only.txt", isDirectory: false, data: "ok", lastModifiedMs: 2 }],
        },
      });
      await expect(restored.readFile("/only.txt")).resolves.toBe("ok");
    });
  });
});
