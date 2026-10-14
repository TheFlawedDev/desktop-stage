import { describe, expect, it } from "vitest";
import { ItermEvaluator } from "../../packages/desktop-engine/src/stage/apps/index";
import type { TerminalResult } from "../../packages/desktop-engine/src/stage/apps/index";
import { MemoryVirtualFileSystem } from "../../packages/desktop-engine/src/stage/vfs/index";

async function shellFixture() {
  const vfs = new MemoryVirtualFileSystem();
  await vfs.mkdir("/docs");
  await vfs.writeFile("/docs/readme.txt", "read me");
  await vfs.mkdir("/docs/nested");
  await vfs.mkdir("/dir/nested", true);
  await vfs.writeFile("/dir/nested/deep.txt", "deep");
  await vfs.writeFile("/a.txt", "aye");
  await vfs.writeFile("/b.txt", "bee");
  await vfs.writeFile("/my file.txt", "spaced");
  await vfs.writeFile("/unicode.txt", "héllo");
  return { vfs, shell: new ItermEvaluator(vfs) };
}

function expectFailure(result: TerminalResult) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.length).toBeGreaterThan(0);
}

describe("ItermEvaluator", () => {
  describe("empty and simple commands", () => {
    it("succeeds on an empty command line", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("", "/docs");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.cwd).toBe("/docs");
    });

    it("succeeds on a whitespace-only command line", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("   ", "/docs");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.cwd).toBe("/docs");
    });

    it("reports unsupported commands with exit code 127", async () => {
      const { shell } = await shellFixture();
      for (const line of ["foobar", "sudo rm -rf /", "node -e 1", "sh -c ls"]) {
        const result = await shell.execute(line, "/");
        expect(result.exitCode).toBe(127);
        expect(result.stdout).toBe("");
        expect(result.stderr.length).toBeGreaterThan(0);
        expect(result.cwd).toBe("/");
      }
    });
  });

  describe("pwd", () => {
    it("prints the canonical working directory with a newline", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("pwd", "/docs");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("/docs\n");
      expect(result.stderr).toBe("");
      expect(result.cwd).toBe("/docs");
    });

    it("rejects extra operands", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("pwd extra", "/docs"));
    });
  });

  describe("ls", () => {
    it("lists the working directory, sorted, with directories suffixed", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("ls", "/");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a.txt\nb.txt\ndir\ndocs\nmy file.txt\nunicode.txt\n");
      expect(result.cwd).toBe("/");
    });

    it("lists a relative or absolute path", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("ls /docs", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "nested/\nreadme.txt\n",
        cwd: "/",
      });
      await expect(shell.execute("ls dir", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "nested/\n",
      });
      await expect(shell.execute("ls --", "/docs")).resolves.toMatchObject({ exitCode: 1 });
    });

    it("fails on files and missing paths", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("ls /a.txt", "/"));
      expectFailure(await shell.execute("ls /missing", "/"));
      expectFailure(await shell.execute("ls -l", "/"));
      expect(await shell.execute("ls /missing", "/")).toMatchObject({ cwd: "/" });
    });
  });

  describe("cat", () => {
    it("concatenates file contents", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("cat /a.txt", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "aye",
      });
      await expect(shell.execute("cat /a.txt /b.txt", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "ayebee",
      });
    });

    it("decodes UTF-8 bytes and quoted paths", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("cat /unicode.txt", "/")).resolves.toMatchObject({
        stdout: "héllo",
      });
      await expect(shell.execute('cat "/my file.txt"', "/")).resolves.toMatchObject({
        stdout: "spaced",
      });
    });

    it("fails without operands, on directories and on missing files", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("cat", "/"));
      expectFailure(await shell.execute("cat /docs", "/"));
      expectFailure(await shell.execute("cat /missing.txt", "/"));
      expectFailure(await shell.execute("cat /a.txt /missing.txt", "/"));
    });
  });

  describe("echo", () => {
    it("joins arguments with a final newline", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("echo hello world", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "hello world\n",
      });
      await expect(shell.execute("echo", "/")).resolves.toMatchObject({ stdout: "\n" });
    });

    it("honours quotes and backslash escapes without expanding anything", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute('echo "a  b"', "/")).resolves.toMatchObject({ stdout: "a  b\n" });
      await expect(shell.execute("echo 'a;b'", "/")).resolves.toMatchObject({ stdout: "a;b\n" });
      await expect(shell.execute('echo "a;b"', "/")).resolves.toMatchObject({ stdout: "a;b\n" });
      await expect(shell.execute("echo a\\ b", "/")).resolves.toMatchObject({ stdout: "a b\n" });
      await expect(shell.execute("echo '$HOME'", "/")).resolves.toMatchObject({
        stdout: "$HOME\n",
      });
      await expect(shell.execute("echo $HOME", "/")).resolves.toMatchObject({
        stdout: "$HOME\n",
      });
      await expect(shell.execute("echo '$(whoami)'", "/")).resolves.toMatchObject({
        stdout: "$(whoami)\n",
      });
      await expect(shell.execute("echo *.txt", "/")).resolves.toMatchObject({
        stdout: "*.txt\n",
      });
    });

    it("redirects into a file with > and appends with >>", async () => {
      const { vfs, shell } = await shellFixture();
      const write = await shell.execute("echo hi > /out.txt", "/");
      expect(write.exitCode).toBe(0);
      expect(write.stdout).toBe("");
      await expect(vfs.readFile("/out.txt")).resolves.toBe("hi\n");

      const append = await shell.execute("echo more >> /out.txt", "/");
      expect(append.exitCode).toBe(0);
      await expect(vfs.readFile("/out.txt")).resolves.toBe("hi\nmore\n");
    });

    it("fails on unsupported redirect syntax", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("echo hi > /missing/out.txt", "/"));
      expectFailure(await shell.execute("echo hi > /a.txt /b.txt", "/"));
      expectFailure(await shell.execute("echo hi >", "/"));
      expectFailure(await shell.execute("echo hi < /a.txt", "/"));
      expectFailure(await shell.execute("echo hi 2> /out.txt", "/"));
      expectFailure(await shell.execute("echo hi >>", "/"));
    });

    it("fails on unterminated quotes", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute('echo "unterminated', "/"));
      expectFailure(await shell.execute("echo 'unterminated", "/"));
      expectFailure(await shell.execute("echo a\\", "/"));
    });
  });

  describe("mkdir", () => {
    it("creates a directory, optionally recursive", async () => {
      const { vfs, shell } = await shellFixture();
      await expect(shell.execute("mkdir /new", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.exists("/new")).resolves.toBe(true);

      await expect(shell.execute("mkdir -p /x/y/z", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.exists("/x/y/z")).resolves.toBe(true);
    });

    it("fails on missing parents, occupied paths and bad flags", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("mkdir /missing/child", "/"));
      expectFailure(await shell.execute("mkdir /a.txt", "/"));
      expectFailure(await shell.execute("mkdir /docs", "/"));
      expectFailure(await shell.execute("mkdir", "/"));
      expectFailure(await shell.execute("mkdir -x /y", "/"));
    });
  });

  describe("touch", () => {
    it("creates an empty file", async () => {
      const { vfs, shell } = await shellFixture();
      await expect(shell.execute("touch /new.txt", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.readFile("/new.txt")).resolves.toBe("");
    });

    it("preserves existing file bytes", async () => {
      const { vfs, shell } = await shellFixture();
      await expect(shell.execute("touch /a.txt", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.readFile("/a.txt")).resolves.toBe("aye");
    });

    it("fails without operands or with a missing parent", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("touch", "/"));
      expectFailure(await shell.execute("touch /missing/x.txt", "/"));
    });
  });

  describe("rm", () => {
    it("removes files", async () => {
      const { vfs, shell } = await shellFixture();
      await expect(shell.execute("rm /a.txt", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.exists("/a.txt")).resolves.toBe(false);
    });

    it("requires -r for directories", async () => {
      const { vfs, shell } = await shellFixture();
      expectFailure(await shell.execute("rm /dir", "/"));
      await expect(vfs.exists("/dir/nested/deep.txt")).resolves.toBe(true);

      await expect(shell.execute("rm -r /dir", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.exists("/dir")).resolves.toBe(false);
    });

    it("fails on missing nodes, missing operands and the root", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("rm /missing", "/"));
      expectFailure(await shell.execute("rm", "/"));
      expectFailure(await shell.execute("rm -r /", "/"));
      expectFailure(await shell.execute("rm -f /a.txt", "/"));
    });
  });

  describe("mv", () => {
    it("moves files and directories", async () => {
      const { vfs, shell } = await shellFixture();
      await expect(shell.execute("mv /a.txt /moved.txt", "/")).resolves.toMatchObject({
        exitCode: 0,
      });
      await expect(vfs.readFile("/moved.txt")).resolves.toBe("aye");
      await expect(vfs.exists("/a.txt")).resolves.toBe(false);

      await expect(shell.execute("mv /dir /renamed", "/")).resolves.toMatchObject({ exitCode: 0 });
      await expect(vfs.readFile("/renamed/nested/deep.txt")).resolves.toBe("deep");
    });

    it("refuses to overwrite, escape, or move a directory into itself", async () => {
      const { vfs, shell } = await shellFixture();
      expectFailure(await shell.execute("mv /a.txt /b.txt", "/"));
      await expect(vfs.readFile("/a.txt")).resolves.toBe("aye");
      await expect(vfs.readFile("/b.txt")).resolves.toBe("bee");

      expectFailure(await shell.execute("mv /missing /x", "/"));
      expectFailure(await shell.execute("mv /a.txt", "/"));
      expectFailure(await shell.execute("mv /a.txt /missing/x", "/"));
      expectFailure(await shell.execute("mv /dir /dir/nested/dir", "/"));
    });
  });

  describe("cd", () => {
    it("validates a directory and returns the canonical cwd without output", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("cd /docs", "/");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.cwd).toBe("/docs");

      await expect(shell.execute("cd nested", "/docs")).resolves.toMatchObject({ cwd: "/docs/nested" });
      await expect(shell.execute("cd ..", "/docs/nested")).resolves.toMatchObject({ cwd: "/docs" });
      await expect(shell.execute("cd /docs/./nested/", "/")).resolves.toMatchObject({
        cwd: "/docs/nested",
      });
    });

    it("returns to the root without an operand", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("cd", "/docs/nested")).resolves.toMatchObject({ cwd: "/" });
    });

    it("fails on files, missing paths, escapes and extra operands", async () => {
      const { shell } = await shellFixture();
      expectFailure(await shell.execute("cd /a.txt", "/docs"));
      expectFailure(await shell.execute("cd /missing", "/docs"));
      expectFailure(await shell.execute("cd /..", "/docs"));
      expectFailure(await shell.execute("cd /docs extra", "/"));
      expect(await shell.execute("cd /missing", "/docs")).toMatchObject({ cwd: "/docs" });
    });
  });

  describe("help and clear", () => {
    it("lists the supported commands", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("help", "/");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      for (const command of ["pwd", "ls", "cat", "echo", "mkdir", "touch", "rm", "mv", "cd", "clear"]) {
        expect(result.stdout).toContain(command);
      }
    });

    it("asks the host to clear the screen", async () => {
      const { shell } = await shellFixture();
      const result = await shell.execute("clear", "/docs");
      expect(result.exitCode).toBe(0);
      expect(result.clear).toBe(true);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.cwd).toBe("/docs");
    });
  });

  describe("shell metacharacter rejection", () => {
    it("rejects unquoted ; | & and backticks", async () => {
      const { shell } = await shellFixture();
      for (const line of [
        "echo a; echo b",
        "echo a | cat",
        "echo a &",
        "echo `date`",
        'echo "`date`"',
        "echo $(whoami)",
        'echo "$(whoami)"',
      ]) {
        expectFailure(await shell.execute(line, "/"));
      }
    });

    it("treats single-quoted content as literal", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("echo 'a;b|c&d'", "/")).resolves.toMatchObject({
        exitCode: 0,
        stdout: "a;b|c&d\n",
      });
    });
  });

  describe("virtual root confinement", () => {
    it("never lets a command escape the root", async () => {
      const { vfs, shell } = await shellFixture();
      const attempts = [
        "cat ../../etc/passwd",
        "cat /../etc/passwd",
        "ls /..",
        "cd /../..",
        "mkdir /../escape",
        "touch /../escape.txt",
        "echo x > ../../escape.txt",
        "rm -r /../..",
        "mv /a.txt /../a.txt",
      ];
      for (const line of attempts) {
        const result = await shell.execute(line, "/");
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr.length).toBeGreaterThan(0);
      }
      await expect(vfs.exists("/escape")).resolves.toBe(false);
      await expect(vfs.exists("/escape.txt")).resolves.toBe(false);
      await expect(vfs.exists("/a.txt")).resolves.toBe(true);
    });
  });

  describe("robustness", () => {
    it("never rejects the returned promise for user input", async () => {
      const { shell } = await shellFixture();
      const hostile = [
        ";;;",
        "|",
        "&",
        "`",
        "$(x)",
        'cat "',
        "echo \\",
        "\u0000",
        "cd /a/../../..",
        "a".repeat(5000),
      ];
      for (const line of hostile) {
        const result = await shell.execute(line, "/");
        expect(result).toBeTypeOf("object");
        expect(typeof result.exitCode).toBe("number");
        expect(typeof result.stdout).toBe("string");
        expect(typeof result.stderr).toBe("string");
        expect(typeof result.cwd).toBe("string");
      }
    });

    it("keeps non-cd commands on the original working directory", async () => {
      const { shell } = await shellFixture();
      await expect(shell.execute("ls /", "/docs")).resolves.toMatchObject({ cwd: "/docs" });
      await expect(shell.execute("cat /a.txt", "/docs")).resolves.toMatchObject({ cwd: "/docs" });
      await expect(shell.execute("help", "/docs")).resolves.toMatchObject({ cwd: "/docs" });
    });
  });
});
