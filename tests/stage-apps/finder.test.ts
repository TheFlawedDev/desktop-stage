import { beforeEach, describe, expect, it } from "vitest";
import { FinderController } from "../../packages/desktop-engine/src/stage/apps/index";
import { MemoryVirtualFileSystem } from "../../packages/desktop-engine/src/stage/vfs/index";

async function setup() {
  const vfs = new MemoryVirtualFileSystem();
  await vfs.mkdir("/docs");
  await vfs.writeFile("/docs/readme.txt", "read me");
  await vfs.mkdir("/docs/nested");
  await vfs.writeFile("/top.txt", "top");
  return vfs;
}

describe("FinderController", () => {
  describe("navigation", () => {
    it("starts at the root", async () => {
      const finder = new FinderController(await setup());
      expect(finder.currentPath).toBe("/");
      const listing = await finder.list();
      expect(listing.map((node) => node.name)).toEqual(["docs", "top.txt"]);
    });

    it("accepts an existing initial path", async () => {
      const finder = new FinderController(await setup(), "/docs");
      expect(finder.currentPath).toBe("/docs");
      await expect(finder.list()).resolves.toHaveLength(2);
    });

    it("opens absolute and relative folders", async () => {
      const finder = new FinderController(await setup());

      await finder.openFolder("/docs");
      expect(finder.currentPath).toBe("/docs");

      await finder.openFolder("nested");
      expect(finder.currentPath).toBe("/docs/nested");

      await finder.openFolder("..");
      expect(finder.currentPath).toBe("/docs");

      await finder.openFolder("/docs/./nested/");
      expect(finder.currentPath).toBe("/docs/nested");
    });

    it("walks up but stays at the root", async () => {
      const finder = new FinderController(await setup());
      await finder.openFolder("/docs/nested");
      await finder.up();
      expect(finder.currentPath).toBe("/docs");
      await finder.up();
      expect(finder.currentPath).toBe("/");
      await finder.up();
      expect(finder.currentPath).toBe("/");
    });

    it("refuses to open a file and keeps the current path", async () => {
      const finder = new FinderController(await setup(), "/docs");
      await expect(finder.openFolder("/top.txt")).rejects.toThrow();
      expect(finder.currentPath).toBe("/docs");
    });

    it("refuses to open a missing folder and keeps the current path", async () => {
      const finder = new FinderController(await setup(), "/docs");
      await expect(finder.openFolder("/missing")).rejects.toThrow();
      await expect(finder.openFolder("/../escape")).rejects.toThrow();
      expect(finder.currentPath).toBe("/docs");
    });

    it("lists the current folder with sorted metadata", async () => {
      const vfs = await setup();
      await vfs.writeFile("/docs/b.txt", "b");
      await vfs.writeFile("/docs/a.txt", "a");
      const finder = new FinderController(vfs, "/docs");

      const listing = await finder.list();
      expect(listing.map((node) => node.name)).toEqual(["a.txt", "b.txt", "nested", "readme.txt"]);
      expect(listing.find((node) => node.name === "readme.txt")).toMatchObject({
        path: "/docs/readme.txt",
        isDirectory: false,
        sizeBytes: 7,
      });
      expect(listing.find((node) => node.name === "nested")?.isDirectory).toBe(true);
    });
  });

  describe("name validation", () => {
    const badNames = ["", "/", "a/b", "\\", "a\\b", ".", "..", "./a", "../a", "a/.."];

    it("rejects invalid names for every mutating operation", async () => {
      const finder = new FinderController(await setup(), "/docs");
      for (const name of badNames) {
        await expect(finder.createFolder(name)).rejects.toThrow();
        await expect(finder.importFile(name, "x")).rejects.toThrow();
        await expect(finder.rename(name, "ok.txt")).rejects.toThrow();
        await expect(finder.rename("readme.txt", name)).rejects.toThrow();
        await expect(finder.delete(name)).rejects.toThrow();
        expect(finder.currentPath).toBe("/docs");
      }
    });

    it("never lets a name escape the current folder", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await expect(finder.createFolder("../../escape")).rejects.toThrow();
      await expect(finder.importFile("../escape.txt", "x")).rejects.toThrow();
      await expect(vfs.exists("/escape")).resolves.toBe(false);
      await expect(vfs.exists("/escape.txt")).resolves.toBe(false);
    });
  });

  describe("createFolder", () => {
    it("creates a folder in the current directory", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await finder.createFolder("new folder");
      await expect(vfs.exists("/docs/new folder")).resolves.toBe(true);
      expect(finder.currentPath).toBe("/docs");
    });

    it("does not clobber an existing file", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await expect(finder.createFolder("readme.txt")).rejects.toThrow();
      await expect(vfs.readFile("/docs/readme.txt")).resolves.toBe("read me");
      expect(finder.currentPath).toBe("/docs");
    });
  });

  describe("importFile", () => {
    let vfs: MemoryVirtualFileSystem;
    let finder: FinderController;

    beforeEach(async () => {
      vfs = await setup();
      finder = new FinderController(vfs, "/docs");
    });

    it("imports string and binary data", async () => {
      await finder.importFile("notes.txt", "hello");
      await expect(vfs.readFile("/docs/notes.txt")).resolves.toBe("hello");

      await finder.importFile("clip.bin", new Uint8Array([1, 2, 3]));
      await expect(vfs.readFile("/docs/clip.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));
      expect(finder.currentPath).toBe("/docs");
    });

    it("overwrites an existing file", async () => {
      await finder.importFile("readme.txt", "replaced");
      await expect(vfs.readFile("/docs/readme.txt")).resolves.toBe("replaced");
    });

    it("never overwrites a directory", async () => {
      await expect(finder.importFile("nested", "x")).rejects.toThrow();
      await expect(vfs.listDirectory("/docs/nested")).resolves.toEqual([]);
      expect(finder.currentPath).toBe("/docs");
    });
  });

  describe("rename", () => {
    it("renames a file in place", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await finder.rename("readme.txt", "guide.txt");
      await expect(vfs.exists("/docs/readme.txt")).resolves.toBe(false);
      await expect(vfs.readFile("/docs/guide.txt")).resolves.toBe("read me");
      expect(finder.currentPath).toBe("/docs");
    });

    it("renames a directory subtree", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await finder.rename("nested", "inner");
      await expect(vfs.exists("/docs/nested")).resolves.toBe(false);
      await expect(vfs.exists("/docs/inner")).resolves.toBe(true);
    });

    it("refuses to overwrite an existing node and preserves both", async () => {
      const vfs = await setup();
      await vfs.writeFile("/docs/other.txt", "other");
      const finder = new FinderController(vfs, "/docs");
      await expect(finder.rename("readme.txt", "other.txt")).rejects.toThrow();
      await expect(vfs.readFile("/docs/readme.txt")).resolves.toBe("read me");
      await expect(vfs.readFile("/docs/other.txt")).resolves.toBe("other");
      expect(finder.currentPath).toBe("/docs");
    });

    it("refuses to rename a missing node", async () => {
      const finder = new FinderController(await setup(), "/docs");
      await expect(finder.rename("missing.txt", "x.txt")).rejects.toThrow();
      expect(finder.currentPath).toBe("/docs");
    });
  });

  describe("delete", () => {
    it("deletes files and directory subtrees", async () => {
      const vfs = await setup();
      await vfs.writeFile("/docs/nested/deep.txt", "deep");
      const finder = new FinderController(vfs, "/docs");

      await finder.delete("readme.txt");
      await expect(vfs.exists("/docs/readme.txt")).resolves.toBe(false);

      await finder.delete("nested");
      await expect(vfs.exists("/docs/nested/deep.txt")).resolves.toBe(false);
      expect(finder.currentPath).toBe("/docs");
    });

    it("refuses to delete a missing node", async () => {
      const vfs = await setup();
      const finder = new FinderController(vfs, "/docs");
      await expect(finder.delete("missing.txt")).rejects.toThrow();
      await expect(vfs.exists("/docs/readme.txt")).resolves.toBe(true);
      expect(finder.currentPath).toBe("/docs");
    });
  });
});
