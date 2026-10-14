import { defineConfig } from "vitest/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Workspace test configuration.
 *
 * `pnpm test` runs every package's suite in one Vitest process rather than one
 * process per package through Turbo. Two reasons:
 *
 * 1. Workspace packages ship raw TypeScript (`main: ./src/index.ts`), so the
 *    aliases below point Vitest at the sources directly. Tests then need no
 *    build step and no dependency on how the package manager linked the
 *    workspace, which is what makes `pnpm test` behave the same on Windows and
 *    macOS.
 * 2. The thread pool avoids the process-per-file fork model. Forked workers
 *    need IPC pipes, which sandboxed and locked-down environments frequently
 *    refuse; threads need none, and the suites here are pure logic.
 *
 * Per-package suites still run the upstream way with `pnpm --filter <pkg> test`.
 */
const root = fileURLToPath(new URL(".", import.meta.url));

// `@cutaway/*` is aliased wholesale because the web app links most of the
// workspace that way. `@desktop-stage/desktop-engine` is aliased explicitly: it
// is the one workspace package outside the `@cutaway` scope, and the web app's
// tests import it for its payload types.
const alias: Record<string, string> = Object.fromEntries(
  readdirSync(`${root}packages`).map((name) => [
    `@cutaway/${name}`,
    `${root}packages/${name}/src/index.ts`,
  ]),
);
alias["@desktop-stage/desktop-engine"] = `${root}packages/desktop-engine/src/index.ts`;

export default defineConfig({
  resolve: {
    // Workspace packages are linked into node_modules; resolving through the
    // link keeps Vitest's module graph identical to the tested sources.
    preserveSymlinks: true,
    alias,
  },
  test: {
    pool: "threads",
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.worktrees/**"],
  },
});
