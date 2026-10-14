import ts from "typescript";
import { startVitest } from "vitest/node";
import scopedConfig from "./vitest.config.ts";

/**
 * Sandbox-safe scoped test runner.
 *
 * The root `vitest.config.ts` is owned by another change, and in this
 * environment esbuild cannot start at all (`spawn EPERM` on its piped service
 * child), so neither Vite's config bundling nor its TypeScript transform is
 * usable. This runner loads the scoped config through Node's native TypeScript
 * support (no bundler), turns Vite's own esbuild off, and strips types with the
 * in-process TypeScript compiler instead.
 *
 * Usage (from the repository root):
 *   node tests/stage-apps/run-tests.mjs [name-filter]
 */
function stripTypesPlugin() {
  return {
    name: "scoped-typescript-strip",
    enforce: "pre",
    transform(code, id) {
      const clean = id.split("?")[0];
      if (!clean?.endsWith(".ts") || clean.endsWith(".d.ts")) return null;
      const result = ts.transpileModule(code, {
        fileName: clean,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          isolatedModules: true,
          sourceMap: true,
          inlineSources: true,
        },
      });
      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  };
}

const { test: testOptions = {}, ...viteConfig } = scopedConfig ?? {};

const overrides = {
  ...viteConfig,
  configFile: false,
  esbuild: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [stripTypesPlugin()],
};

const vitest = await startVitest(
  "run",
  process.argv.slice(2),
  { ...testOptions, watch: false },
  overrides,
);
if (!vitest) {
  process.exitCode = 1;
} else {
  const failed = vitest.state.getFiles().some((file) => file.result?.state === "fail");
  await vitest.close();
  if (failed) process.exitCode = 1;
}
