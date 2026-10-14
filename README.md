# Desktop Stage

Desktop Stage is a browser-based prototype for composing animated, fictional desktop scenes for screenlife-style videos. Instead of recording a real computer desktop, you arrange stylized windows on a canvas and animate them over time.

## What the prototype does

- Starts with an original desktop scene containing browser, code, terminal, and chat-style windows.
- Adds browser, code/terminal, and text windows to a scene.
- Lets you select, drag, resize, duplicate, delete, and reorder windows.
- Edits each window's title, text, accent color, size, position, opacity, and scale.
- Animates position, size, opacity, and scale with keyframes on a 20-second timeline.
- Previews the animation in the browser.
- Saves the active project in the browser and supports project JSON import and export.

## Purpose and limits

This is a proof of concept for quickly planning the visual language of a fictional desktop video. It is not a real operating system, screen recorder, live browser, or video exporter. It does not create MP4 files in this version.

The interface uses original, fictional window designs. It is inspired by the general screenlife storytelling format, not by any specific operating system or application UI.

## Privacy and local data

Desktop Stage runs entirely in your browser. The active project is stored in that browser's local storage on the device you use. Importing and exporting project JSON happens locally in the browser; the app has no accounts, server, analytics, or upload feature.

Avoid importing project files that contain information you would not want stored in your browser profile. Use **Reset scene** or clear this site's browser data to remove its saved project.

## Run locally

Prerequisite: install a current [Node.js LTS](https://nodejs.org/) release. It includes Corepack, which supplies this project's pinned `pnpm` version. If `pnpm` is not available after installing Node, run `corepack enable` once.

From the project folder, run:

```sh
pnpm install
pnpm dev
```

Open the local URL printed in the terminal (normally `http://localhost:5173`). These commands work the same in PowerShell on Windows and Terminal on macOS.

To make a production build:

```sh
pnpm build
```

## Project files

Use **Export project** to download a JSON copy of the current scene, and **Import** to restore one later. Exported `desktop-stage-project.json` files are intentionally ignored by Git so personal drafts are not committed accidentally.

## Development

Desktop Stage is a React and TypeScript application built with Vite. `src/main.tsx` composes the app and manages editor state; reusable editor surfaces live in `src/components/`. Shared project types, starter-scene data, browser-storage behavior, and animation/project utilities are organized in `src/types.ts`, `src/data/`, `src/hooks/`, and `src/utils/`. Visual styling is in `src/styles.css`.
