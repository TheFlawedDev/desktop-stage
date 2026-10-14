import { StageWindowManager } from "../../packages/desktop-engine/src/stage/shell/index";
import type { Rect, Size, StageWindowConfig } from "@cutaway/types";

export const DEFAULT_RECT: Rect = { x: 80, y: 80, width: 640, height: 480 };
export const DEFAULT_MIN_SIZE: Size = { width: 160, height: 100 };

/** Deterministic id generator, unique per call within one generator. */
export function sequentialIds(prefix = "w"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Manager with a deterministic id generator so ids can be asserted. */
export function makeManager(
  options: ConstructorParameters<typeof StageWindowManager>[0] = {}
): StageWindowManager {
  return new StageWindowManager({ createId: sequentialIds(), ...options });
}

/** A window rect fully inside the default 640x480 desktop at origin. */
export function at(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function windowById(manager: StageWindowManager, id: string): StageWindowConfig {
  const found = manager.getWindows().find((w) => w.id === id);
  if (!found) throw new Error(`expected window ${id} to exist`);
  return found;
}

/** zIndex of a specific window. */
export function zIndexOf(manager: StageWindowManager, id: string): number {
  return windowById(manager, id).zIndex;
}

/** Ids of the currently focused window, or null. */
export function focusedId(manager: StageWindowManager): string | null {
  return manager.getFocusedWindow()?.id ?? null;
}
