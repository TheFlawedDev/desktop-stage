# Third-Party Notices

This project is built on and incorporates code from the projects listed below.
Each entry records the exact revision that was vendored or adapted, plus the
license that applies to that code.

## Cutaway

- **Upstream:** <https://github.com/S07K/cutaway.git>
- **Pinned commit:** `e9c6cc06b549d7fa857bb8f43f02c47a39368e33`
  ("fix: refuse an export that would render a blank file", 2026-08-25)
- **License:** MIT — Copyright (c) 2026 Cutaway Contributors
- **License text:** [`LICENSE-CUTAWAY`](./LICENSE-CUTAWAY) (an unmodified copy of
  the upstream `LICENSE` file at the pinned commit)

Desktop Stage vendors the Cutaway project/editor foundation and adapts it into
this pnpm + Turborepo workspace:

- `packages/types`, `packages/utils`
- `packages/timeline-engine`, `packages/animation-engine`,
  `packages/render-engine`, `packages/mask-engine`, `packages/color-engine`,
  `packages/effects-engine`, `packages/history-engine`,
  `packages/caption-engine`
- `packages/media-engine`, `packages/export-engine`, `packages/project-io`,
  `packages/playback-engine`
- `packages/ui`
- The editor shell and feature surfaces under `apps/web/src/`

These files may carry local modifications relative to the pinned commit; the
architectural rationale for those changes is documented in
[`docs/cutaway-architecture.md`](./docs/cutaway-architecture.md).

`packages/desktop-engine` and the `@desktop-stage/*` workspace packages are
original to Desktop Stage and are not part of the upstream Cutaway project.

## MIT License (Cutaway)

```
MIT License

Copyright (c) 2026 Cutaway Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependencies

Third-party npm packages installed under `node_modules` are not vendored into
this repository. Their licenses are recorded in `pnpm-lock.yaml` and in each
package's own `LICENSE` file.
