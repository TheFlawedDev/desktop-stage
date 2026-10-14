# Development

## Repository layout

A pnpm workspace. The dependency rule is downward-only; a cycle between layers is a bug, not a
style preference. See [`cutaway-architecture.md`](cutaway-architecture.md) for the reasoning.

| Path | What lives there |
| --- | --- |
| `apps/web` | The Next.js editor application. React only; business logic belongs in `packages/*`. |
| `packages/types` | The project document: entities, clip payloads, and the Desktop Stage payload families. |
| `packages/utils`, `packages/*-engine` | Pure domain and engine logic. No React, no DOM, runnable in Node. |
| `packages/project-io` | Parsing, validation, migration, and the `.desktopstage` archive. Storage is injected. |
| `packages/media-engine` | The `MediaBlobStore` interface and its IndexedDB implementation. |
| `packages/desktop-engine` | The Desktop Stage extension: versioned payloads, the version 1 converter, and the frame resolver preview and export share. |
| `outputs/` | Plans and notes kept with the repository. Not build input. |

## Commands

Run from the repository root; they behave the same on Windows, macOS, and Linux.

```sh
pnpm install     # link the workspace
pnpm dev         # Next.js dev server (http://localhost:3000)
pnpm test        # Vitest over every package and the web app
pnpm typecheck   # tsc --noEmit across the workspace
pnpm build       # production build
pnpm format      # Prettier
```

Individual packages still have their own scripts, e.g. `pnpm --filter @cutaway/project-io test`.

The root `pnpm test` runs one Vitest process with thread workers rather than a process per package:
workspace packages ship raw TypeScript, so the aliases in `vitest.config.ts` point the runner at the
sources and no build step is needed first.

## The portable `.desktopstage` archive

The JSON project format stores *references* to media bytes in IndexedDB. A JSON download therefore
cannot move a media-rich project to another computer — the file travels, the footage does not. The
archive closes that gap:

```
manifest.json        what is inside, and the format version
project.json         the project document (the same parser as a JSON file)
assets/<media-id>    the original bytes of every bundled media file
```

It is a plain ZIP: it streams, and a creator can recover their footage from it by hand with tools
every operating system already has. Assets are stored uncompressed (`level: 0`) because media is
already compressed.

The implementation is `packages/project-io/src/archive.ts`, and it is deliberately storage-agnostic:
it takes the three-method `ArchiveBlobStore` slice as a parameter, so its tests use an in-memory
store and the web app passes the IndexedDB store from `useMediaImportContext().store()`.

### Why the order of operations matters

- **Export** reads every referenced source blob *before* writing a byte. An export that cannot be
  complete fails immediately with the list of what is missing, instead of producing a half-archive
  that would import with silent gaps.
- **Import** validates the archive, reads every referenced asset, stages the blobs under fresh keys,
  remaps `MediaAsset.source.key`, and only then hands back a document. A failure at any point deletes
  whatever it staged. The caller replaces the open project last, so a corrupt archive, a missing
  asset, or a full disk changes nothing.
- **Bundled vs. linked media.** Assets backed by a remote URL or a file handle are recorded in the
  manifest as unbundled rather than silently dropped, and the UI says how many did not travel.
- **Caches are not shipped.** Thumbnails and waveforms are rebuilt from the source bytes after
  import.
- **Size is checked before anything is unpacked.** Import reads each bundled entry's declared
  uncompressed and compressed sizes from the ZIP central directory, and compares them with the
  manifest's `byteSize`. An entry that disagrees, that exceeds the per-asset or aggregate ceiling, or
  that is compressed past a practical ratio is rejected without inflating it; `manifest.json` and
  `project.json` are bounded too. The ceilings are `DEFAULT_ARCHIVE_LIMITS` in `archive.ts` (512 MiB
  per asset, 2 GiB in total, 200:1 above a 1 MiB floor, 64 MiB per metadata file) and can be raised or
  lowered per import through `ArchiveImportOptions.limits`. They bound *declared output*, not the
  memory the decode retains: import holds every staged blob until the write phase, so the aggregate
  number is the one sized for a browser tab.
- **The manifest is authoritative and bound to the id.** Each bundled asset's recorded `archivePath`
  must name that asset's own entry — the path this build writes, or the equivalent path an older build
  wrote. A manifest that points an asset at another entry is rejected rather than resolving by id, so
  one asset's bytes can never silently stand in for another's.

The UI side lives in `apps/web/src/features/project/`:

| File | Responsibility |
| --- | --- |
| `projectFiles.ts` | Pure decisions: which reader a file goes to, how a failure reads, how big it is, how far along it is |
| `useProjectPersistence.ts` | Autosave, restore, and the archive/JSON open and export flows |
| `downloadBlob.ts` | The anchor-based download, including object-URL revocation |
| `ArchiveStatusBanner.tsx` | Packing/unpacking progress and the outcome, including the failure details |

### File-kind dispatch

`classifyProjectFile` decides between the archive reader and the JSON reader from the file's
extension and MIME type first, and from its leading bytes only when both say nothing. The precedence
is deliberate and load-bearing: a file named `.desktopstage` whose contents are corrupt must be
reported as a broken archive, never handed to the forgiving JSON parser, which could otherwise
"repair" it into a plausible-looking empty project and replace what the user had open. The mirror
case holds too — a `.json` file is never fed to the ZIP reader.

Adding a new project extension means adding it to `ARCHIVE_EXTENSIONS` or `JSON_EXTENSIONS` in
`projectFiles.ts`, and covering it in `projectFiles.test.ts`.

## Persistence and deferred media cleanup

Project documents are autosaved to IndexedDB (`apps/web/src/state/projectStorage.ts`) and media bytes
to a separate database (`packages/media-engine/src/storage.ts`). Three rules matter when changing
either:

- **A write is only done when its transaction commits.** Both stores settle their promises on
  `tx.oncomplete` and reject on abort or error, because `request.onsuccess` only means the request was
  processed — a readwrite transaction can still abort at commit on quota enforcement or an I/O error.
  Never resolve one of these helpers on the request; a caller that is told "saved" acts on it
  (the legacy-import decision is recorded, an archive import reports success).
- **Removing media does not delete its bytes.** An asset removal is an undoable document edit
  (`removeMediaAsset` → the undo history), and the document is only autosaved shortly afterwards.
  Deleting the blobs at removal time would break undo and lose the media of a project that has not
  been saved yet.
- **Stored documents are migrated and validated on restore**, exactly like a file, through
  `apps/web/src/features/project/restoreStoredProject.ts`. A record the validator cannot repair is
  reported and left untouched; the session continues on the starter project, whose project id is
  minted fresh per call (`createStarterProject`), so nothing it saves can land on the stored record.

### Deferred media cleanup

There is currently **no garbage collection of media bytes**. The startup sweep that used to run was
removed because it was unsafe: it built its "referenced" set from stored documents only, so it could
not see media another tab was staging for an in-flight archive import, or bytes an unsaved/undone edit
still pointed at, and would delete live media. Orphaned blobs — from a removal, a deleted project, or
an interrupted import — therefore accumulate until a safe sweep exists.

A safe sweep needs a reference count or a lease (a staged blob marked in use before it is written, and
a grace period before anything unreferenced is deleted); it must not be replaced by another
"delete everything not in the stored documents" pass. The cost of not sweeping is disk space, which is
the safer failure than deleting media a user can still get back.

## Web bundler on Windows

`apps/web` runs Next.js with the webpack bundler (`next dev --webpack`, `next build --webpack`)
rather than the default Turbopack. On Windows, Turbopack currently fails to resolve the `@cutaway/*`
workspace packages from this monorepo, reporting dozens of module-resolution errors, while webpack
compiles, typechecks, and static-exports the same sources successfully.

This is a Windows tooling workaround, not a product constraint. Remove the `--webpack` flags from
`apps/web/package.json` once Turbopack resolves these workspace packages correctly.
