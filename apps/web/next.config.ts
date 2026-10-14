import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The editor is entirely client-side — no route handlers, no server actions,
   * no middleware, and no server image optimisation. Exporting it as static
   * files is therefore not a compromise: it is what the app already is, and it
   * keeps the local-first promise honest by making the build deployable to any
   * static host (or opened from a file share) rather than to one vendor.
   */
  output: "export",

  /**
   * Workspace packages ship raw TypeScript rather than a build step — one less
   * thing to run, and edits to a package are reflected instantly in dev.
   * Next must therefore compile them itself.
   */
  transpilePackages: [
    "@cutaway/types",
    "@cutaway/utils",
    "@cutaway/timeline-engine",
    "@cutaway/media-engine",
    "@cutaway/animation-engine",
    "@cutaway/render-engine",
    "@cutaway/project-io",
    "@cutaway/playback-engine",
    "@cutaway/history-engine",
    "@cutaway/mask-engine",
    "@cutaway/caption-engine",
    "@cutaway/color-engine",
    "@cutaway/effects-engine",
    "@cutaway/export-engine",
    "@cutaway/ui",
    "@desktop-stage/desktop-engine",
  ],

  /**
   * The inferred workspace root is pinned rather than guessed.
   *
   * Next walks up looking for a lockfile; with the app nested one level inside a
   * pnpm workspace it can settle on a directory outside this repository, which
   * silently breaks resolution of the workspace packages above.
   */
  turbopack: {
    root: join(__dirname, "..", ".."),
  },
};

export default nextConfig;
