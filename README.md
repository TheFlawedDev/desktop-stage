# Desktop Stage

Desktop Stage is a local-first, browser-based editor for composing animated, fictional desktop
scenes for screenlife-style videos. Instead of recording a real computer, you arrange stylized app
windows on a canvas, animate them over time, and render the result to a video file.

It is an early prototype. It is honest about that below.

## Status: what works today

- **Editor shell** — timeline, preview, inspector, media library, undo/redo, and autosave. The
  document is normalized JSON with integer-frame timing, and preview and video export resolve the
  *same* scene, so what you saw is what you get.
- **A starter scene** — the prototype's four-window fictional desktop (browser, code, terminal,
  note), converted into the current document model, plus two action clips that show how the action
  row targets an app instance.
- **Media import** — video, audio, and images are copied into this browser's IndexedDB, with
  thumbnails and waveforms generated locally. Large files never leave the machine.
- **Portable project archives** — `.desktopstage` files carry the project *and* the original bytes
  of every referenced media file, so a media-rich project can move to another computer. This is the
  primary way to share or back up a project.
- **Project JSON** — export and import of the document alone, including projects saved by the
  original version 1 prototype.
- **Video export** — MP4 (H.264/AAC) or WebM (VP9/Opus), rendered with WebCodecs.

## Boundaries of the prototype

These are real limits, not a roadmap promise:

- **Chromium only for export.** Video rendering uses the WebCodecs API, which today means a recent
  Chrome or Edge. The editor itself opens elsewhere; the export button will tell you why it cannot
  run.
- **A stylized compositor, not an operating system.** Windows are drawn from authored state and
  animation data. There is no real browser, terminal, or file system behind them, and nothing about
  the scene is captured from your machine.
- **Simulated app behavior is still thin.** The document model, track kinds (desktop, action, cursor,
  camera), and the shared frame resolver exist, and actions such as focus, open/close, title, and
  append-line are resolved at render time. The richer simulated-app behavior is a separate, later
  piece of work.
- **One project at a time.** Autosave keeps the current project and its media in this browser; there
  is no project shelf UI, cloud sync, or collaboration.
- **No accounts, no server, no uploads.** Everything happens in the page.
- **JSON is not a backup.** An exported `.json` file contains media *references* that point at this
  browser's storage. Copy that file to another computer and the footage will be missing. Use
  `.desktopstage` to move a project with its media.

## Run locally

Prerequisite: [Node.js](https://nodejs.org/) 22.13 or newer — the floor that this workspace's pinned
`pnpm` 11 requires. If `pnpm` is not already on your `PATH`, install it once with
`npm install -g pnpm@11`. Corepack is no longer bundled with every current Node.js release, so
`corepack enable` is not always available.

From the repository root:

```sh
pnpm install
pnpm dev
```

Open the URL the dev server prints (normally `http://localhost:3000`). These commands are the same in
PowerShell on Windows, Terminal on macOS, and a shell on Linux.

Other root scripts:

```sh
pnpm test        # unit tests for every package and the web app
pnpm typecheck   # TypeScript across the workspace
pnpm build       # production build
```

## Project files

| Format | Contains | Use it for |
| --- | --- | --- |
| `.desktopstage` (ZIP) | `manifest.json`, `project.json`, and every referenced original media blob under `assets/` | **Sharing and backups.** The only format that carries media. |
| `.cutaway` / `.json` | The project document only; media stays in this browser | Inspecting, diffing, hand-editing, and bug reports |
| version 1 JSON | A project saved by the original Vite prototype | Bringing old work forward |

A `.desktopstage` file is an ordinary ZIP. If this editor is ever unavailable to you, your footage
is still recoverable with tools every operating system already has.

**Share** downloads a `.desktopstage` archive. **Export project JSON** downloads the document alone
and says so. **Open** accepts all three formats and picks the right reader from the file's extension,
type, and (when those are silent) its first bytes — a corrupt archive is reported as a corrupt
archive rather than guessed at as a document.

Import is non-destructive: an archive is validated and its media staged under fresh keys before the
open project is replaced, and a failure at any point leaves the current project untouched.

## Privacy and local data

Desktop Stage runs entirely in your browser. The active project and its media live in that browser's
storage on the device you use. Importing and exporting happens locally in the page; there are no
accounts, no server, no analytics, and no upload of your footage.

Avoid opening project files that contain information you would not want stored in your browser
profile. Clearing this site's browser data removes everything the editor saved, and the version 1
prototype's `localStorage` value is read once but never modified.

## Development

The editor is a pnpm workspace. `apps/web` is the Next.js application; the reusable engine lives in
`packages/*` (`types`, `project-io`, `render-engine`, `media-engine`, `desktop-engine`, and others).
The Desktop Stage document extension — versioned app/action/cursor/camera payloads, the version 1
converter, and the frame resolver shared by preview and export — is
`packages/desktop-engine`.

- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — repository layout, commands, and the portable
  archive format.
- [`docs/cutaway-architecture.md`](docs/cutaway-architecture.md) — why the editor is shaped the way
  it is.

## License and provenance

Desktop Stage is MIT licensed. Its editor foundation is derived from
[Cutaway](https://github.com/S07K/cutaway) at commit
`e9c6cc06b549d7fa857bb8f43f02c47a39368e33`, also MIT licensed; that notice is preserved in
[`LICENSE-CUTAWAY`](LICENSE-CUTAWAY) and the retained third-party licenses are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The interface uses original, fictional window designs. It is inspired by the general screenlife
storytelling format, not by any specific operating system or application UI.
