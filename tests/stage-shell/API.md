# Stage Shell — Fixed Test API

This document pins the exact contract the tests in this directory exercise.
It is intentionally written **before** the implementation, so the tests are the
executable specification for the stage shell.

Import surface under test:

```ts
// tests import the shell directly, not the package barrel
import {
  StageWindowManager,
  STAGE_DOCK_APPS,
  activateDockApp,
} from "../../packages/desktop-engine/src/stage/shell/index";

// contracts are type-only
import type {
  IStageWindowManager,
  StageAppKind,
  StageWindowConfig,
  Rect,
  Vec2,
  Size,
} from "@cutaway/types";
```

`StageWindowManager implements IStageWindowManager` and additionally exposes
`getFocusedWindow`, `setRecordingRegion`, and `canReceiveInput`, which are not
part of the shared interface but are required by the shell contract.

All geometry uses **half-open rectangles**: a rect `{x, y, width, height}`
contains a point `p` iff `x <= p.x < x + width && y <= p.y < y + height`.
Points on the right/bottom edge are outside; points on the left/top edge are
inside. A minimized window is never hit-testable.

## Constants

| Name | Value |
| --- | --- |
| Default rect | `{ x: 80, y: 80, width: 640, height: 480 }` |
| Default min size | `{ width: 160, height: 100 }` |
| App titles | `finder` → `Finder`, `iterm` → `iTerm`, `arc` → `Arc`, `quicktime` → `QuickTime`, `photobooth` → `Photo Booth`, `custom` → `Custom` |

## `new StageWindowManager(options?)`

```ts
interface StageWindowManagerOptions {
  createId?: () => string;
  defaultRect?: Rect;
  minSize?: Size;
}
```

- `createId` defaults to a monotonic generator that never repeats and never
  returns an empty string. Injected ids are used verbatim for `openApp`.
- `defaultRect` and `minSize` are copied; the instance must not alias the
  option objects.
- Every instance owns an independent `Map`-backed state. Two managers never
  share windows, focus, z-order, or recording region.

## State invariants

- `zIndex` values are finite and totally ordered. They are **not** guaranteed
  to be contiguous: closing or minimizing a window never renumbers the rest.
- At most one window has `isFocused === true` at any time.
- A focused window is always visible (`isMinimized === false`).
- `getWindows()` returns ascending `zIndex` order.

## Methods

### `openApp(appKind, initialRect?): StageWindowConfig`

- Returns a **defensive snapshot** of the new window.
- The new window is appended on top (`zIndex` greater than every existing
  window), is focused, and is not minimized; every previously focused window
  becomes unfocused.
- `initialRect` is a `Partial<Rect>` merged over `defaultRect` per field.
- `x` and `y` must be finite; negative coordinates are permitted.
- `width` and `height` must be finite and strictly positive, and are clamped
  **up** to `minSize` (larger values are preserved).
- Throws (a) when `appKind` is not one of the six runtime kinds, (b) when any
  supplied coordinate/size is invalid, or (c) when `createId` returns an empty
  string or an id already in use. Every throw leaves state completely
  unmutated.

### `closeWindow(windowId): void`

- Unknown id: no-op.
- Otherwise removes the window. If the removed window was focused, focus moves
  to the highest-`zIndex` remaining **visible** (non-minimized) window, or
  becomes "no focused window" when none remain. Closing a non-focused window
  preserves focus. Remaining `zIndex` values are unchanged.

### `focusWindow(windowId): void`

- Unknown id: no-op.
- Minimized id: no-op (stays minimized, focus unchanged).
- Otherwise the window becomes the sole focused, visible window and moves above
  every other window (new highest `zIndex`). Its rect and minimized flag are
  unchanged.

### `moveWindow(windowId, pos): void`

- Unknown id: no-op.
- Non-finite `x`/`y`: throws without mutating. Negative values are allowed.
- Preserves focus and `zIndex`; only `rect.x`/`rect.y` change.

### `resizeWindow(windowId, size): void`

- Unknown id: no-op.
- Non-finite, zero, or negative `width`/`height`: throws without mutating.
- Positive sizes are clamped **up** to `minSize`. Preserves focus and `zIndex`.

### `minimizeWindow(windowId): void`

- Unknown id: no-op; already-minimized id: no-op.
- Minimizing the focused window moves focus to the highest-`zIndex` remaining
  visible window (or no focus when none remain).
- Minimizing a non-focused window preserves the current focus and z-order. The
  window stays present in `getWindows()` with `isMinimized === true`.

### `restoreWindow(windowId): void`

- Unknown id: no-op.
- Un-minimizes the window and focuses it: it becomes top-most and sole focused.
  Restoring an already-visible window simply focuses it.

### `getWindows(): StageWindowConfig[]`

- Ascending `zIndex`.
- Fresh array of deep defensive snapshots: mutating the returned array, or any
  returned window/rect, never affects manager state.

### `getTopWindowAt(pos): StageWindowConfig | null`

- Highest-`zIndex` non-minimized window whose half-open rect contains `pos`.
- `null` when no window contains the point or when `x`/`y` is not finite.
- Returns a defensive snapshot; minimized windows are excluded.

### `getFocusedWindow(): StageWindowConfig | null`

- Defensive snapshot of the focused window, or `null`.

### `setRecordingRegion(region: Rect | null): void`

- `null` means "full desktop": no region restriction.
- A non-null region must have finite `x`/`y` and finite, strictly positive
  `width`/`height`. Valid input is **copied**; later mutation of the caller's
  object must not change behavior.
- Invalid input throws and leaves the previously configured region in effect.

### `canReceiveInput(windowId, kind, pos?): boolean`

`kind` is `"content" | "keyboard" | "drag"`. Unknown id and any minimized
window return `false` for every kind.

- **`"drag"`** — always `true` for an existing, non-minimized window, regardless
  of position, occlusion, or the recording region. The caller performs the
  title-bar hit test, so a window dragged fully outside the region remains
  draggable back in.
- **`"content"`** — requires a finite `pos` that is inside the window's
  half-open rect, the window is the topmost window at `pos`, and, when a
  recording region is set, `pos` is inside the region's half-open rect.
- **`"keyboard"`** — requires the window to be focused and visible, and, when a
  recording region is set, the window rect to intersect the region with
  **positive area** (an edge-only touch has zero area and fails). With no
  region (`null`), a focused visible window is allowed.

## Dock module exports

### `STAGE_DOCK_APPS`

A frozen (`Object.isFrozen === true`) readonly array of frozen
`{ appKind, title }` entries, in this exact order:

1. `finder` / `Finder`
2. `iterm` / `iTerm`
3. `arc` / `Arc`
4. `quicktime` / `QuickTime`
5. `photobooth` / `Photo Booth`

### `activateDockApp(manager, appKind): StageWindowConfig`

- If `manager.getWindows()` already contains a window with that `appKind`, the
  highest-`zIndex` one is restored (un-minimized) and focused; no new window is
  created.
- Otherwise it is equivalent to `manager.openApp(appKind)`.
- Returns the final defensive snapshot of the activated window.
