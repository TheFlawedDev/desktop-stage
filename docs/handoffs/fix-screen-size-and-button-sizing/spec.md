# Spec: fix-screen-size-and-button-sizing

## Goal
Fix aspect-ratio screen sizing on InteractiveStage so changing project aspect ratios (16:9, 1:1, 9:16, 4:5, 21:9) updates the canvas and virtual desktop accurately without clipping, and streamline bottom control bar buttons to compact, single-line whitespace-nowrap controls.

## Type contracts
In `apps/web/src/features/stage-studio/InteractiveStage.tsx`:
```ts
export function computeDesktopDimensions(resolution?: { width: number; height: number }): { width: number; height: number };

export interface InteractiveStageProps {
  width: number;
  height: number;
  resolution?: { width: number; height: number };
  onTakeRecorded?: (blob: Blob, manifest: StageTakeManifest) => void;
  onRecordingStatusChange?: (isRecording: boolean, durationMs: number) => void;
  selectedCrop?: Rect;
  onCropChange?: (crop: Rect) => void;
  recordingMode?: "full" | "selected-area";
  onRecordingModeChange?: (mode: "full" | "selected-area") => void;
}
```

## Behavior
1. `computeDesktopDimensions(resolution)` derives base virtual desktop dimensions:
   - When ratio ($\ge 1$): `height = 720`, `width = Math.round(720 * (resolution.width / resolution.height))`
   - When ratio ($< 1$): `width = 720`, `height = Math.round(720 / (resolution.width / resolution.height))`
   - Defaults to `{ width: 1280, height: 720 }` when resolution is undefined.
2. `InteractiveStage` uses `computeDesktopDimensions(resolution)` as its internal desktop coordinates (`desktopWidth` and `desktopHeight`).
3. `InteractiveStage` applies `shrink-0` to the desktop container (`stageRef`) so flexbox never horizontally squeezes or distorts the desktop box inside square/narrow viewports.
4. `InteractiveStage` positions the dock dynamically at `x: (desktopWidth - dockW) / 2` and `y: desktopHeight - dockH - 8`.
5. Full desktop recording rect is `{ x: 0, y: 0, width: desktopWidth, height: desktopHeight }`.
6. In `apps/web/src/features/editor/PreviewPanel.tsx`:
   - Both `interactive` and `preview` modes use responsive `stageSize` derived from `resolution.width / resolution.height`.
   - `PreviewPanel` passes `resolution={resolution}` to `<InteractiveStage />`.
   - The recording mode dropdown displays: `Full Desktop (${desktopDimensions.width}×${desktopDimensions.height})`.
7. Bottom control bar in `PreviewPanel.tsx` is styled at `h-9 shrink-0 px-3`, and all buttons/selects use `whitespace-nowrap`, compact heights (`h-6.5` / `h-7`), and `text-xs` so they never wrap onto multiple lines.

## Acceptance criteria
- [ ] AC-1: `computeDesktopDimensions` returns exact dimensions for 16:9 (1280x720), 1:1 (720x720), 9:16 (720x1280), 4:5 (720x900), and 21:9 (1680x720) (maps to test: `screenSizeAndButtons.test.ts`)
- [ ] AC-2: `InteractiveStage` accepts `resolution` prop and uses dynamic dimensions without clipping (maps to test: `screenSizeAndButtons.test.ts`)
- [ ] AC-3: Bottom control bar buttons include `whitespace-nowrap` and compact sizing (maps to test: `screenSizeAndButtons.test.ts`)
- [ ] AC-4: All existing 57 test suites continue to pass without regressions.

## Allowed files
- `apps/web/src/features/stage-studio/InteractiveStage.tsx`
- `apps/web/src/features/editor/PreviewPanel.tsx`
- `tests/stage-studio/screenSizeAndButtons.test.ts`
- `apps/web/src/features/stage-studio/__tests__/interactiveStage.test.ts`

## Out of scope
- Audio engine, video codecs, and timeline playback operations
- Changing the top toolbar AspectRatioMenu options

## Known risks
- None identified.
