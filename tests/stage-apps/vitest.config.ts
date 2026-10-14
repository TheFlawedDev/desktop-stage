import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Scoped runner for the Desktop Stage tests while the workspace root config is
 * owned by another change.
 *
 * It resolves workspace packages straight at their sources (the same trick the
 * root `vitest.config.ts` uses) and keeps Vite's cache out of the repository so
 * a scoped `vitest run --config tests/stage-apps/vitest.config.ts` never writes
 * into the worktree.
 *
 * Run from the repository root with the ancestor Vitest:
 *   node ../../node_modules/vitest/vitest.mjs run --config tests/stage-apps/vitest.config.ts
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: join(tmpdir(), "desktop-stage-vitest-cache"),
  resolve: {
    // Vite's Windows realpath helper shells out to `net use`; preserving links
    // keeps resolution in-process, which also matches the root workspace config.
    preserveSymlinks: true,
    alias: {
      "@cutaway/types": `${repoRoot}packages/types/src/index.ts`,
    },
  },
  test: {
    include: ["*.test.ts"],
    exclude: ["**/node_modules/**"],
    pool: "threads",
    environment: "node",
  },
});
