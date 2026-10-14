# Development

## Web bundler on Windows

`apps/web` runs Next.js with the webpack bundler (`next dev --webpack`, `next build --webpack`) rather than the default Turbopack. On Windows, Turbopack currently fails to resolve the `@cutaway/*` workspace packages from this monorepo, reporting dozens of module-resolution errors, while webpack compiles, typechecks, and static-exports the same sources successfully.

This is a Windows tooling workaround, not a product constraint. Remove the `--webpack` flags from `apps/web/package.json` once Turbopack resolves these workspace packages correctly.
