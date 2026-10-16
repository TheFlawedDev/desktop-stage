# Spec: Fix Custom Wallpaper in Canvas Recording

## Goal
Ensure custom wallpaper images and preset desktop wallpapers accurately render into canvas recordings (`drawFrame`) with cover aspect ratio, eliminating stale fallback to default royal blue gradients.

## Type contracts
Export helper function in `apps/web/src/features/stage-studio/InteractiveStage.tsx`:
```typescript
export function computeWallpaperCoverDimensions(
  imgW: number,
  imgH: number,
  desktopWidth: number,
  desktopHeight: number,
): { drawX: number; drawY: number; drawW: number; drawH: number }
```

## Behavior
1. `InteractiveStage` must maintain live reference tracking for wallpaper state:
   - `const wallpaperRef = useRef(wallpaper);`
   - `wallpaperRef.current = wallpaper;`
   - `const customWallpaperUrlRef = useRef(customWallpaperUrl);`
   - `customWallpaperUrlRef.current = customWallpaperUrl;`
2. `drawFrame()` inside `startCanvasRecording` must evaluate `wallpaperRef.current` (not the stale closure `wallpaper`) when checking whether `wallpaperRef.current === "custom"` and when selecting preset wallpaper gradients (`macos-sonoma`, `macos-sequoia`, etc.).
3. `useImperativeHandle` dependency array must include `wallpaper` and `customWallpaperUrl` so that any caller invoking `startRecording` receives fresh closures.
4. When `customWallpaperUrl` is loaded (in `useEffect` and `onChange`), set `img.crossOrigin = "anonymous"`, attach `onload`, and check if `img.complete && img.naturalWidth > 0` to immediately set `customWallpaperImgRef.current = img`.
5. `computeWallpaperCoverDimensions` must compute cover geometry matching the existing aspect ratio math:
   - When `imgRatio > stageRatio`: `drawH = desktopHeight`, `drawW = desktopHeight * imgRatio`, `drawX = (desktopWidth - drawW) / 2`, `drawY = 0`.
   - When `imgRatio <= stageRatio`: `drawW = desktopWidth`, `drawH = desktopWidth / imgRatio`, `drawX = 0`, `drawY = (desktopHeight - drawH) / 2`.
6. Existing tests and build must pass.

## Acceptance criteria
- [ ] AC-1: `computeWallpaperCoverDimensions` accurately calculates cover aspect ratio and offsets for wider, taller, and matching aspect ratio images. (maps to test: `customWallpaperRecording.test.ts -> computeWallpaperCoverDimensions calculates cover crop geometry`)
- [ ] AC-2: `InteractiveStage.tsx` tracks live `wallpaperRef.current = wallpaper` alongside other live state refs, and `drawFrame` reads `wallpaperRef.current`. (maps to test: `customWallpaperRecording.test.ts -> InteractiveStage maintains live wallpaperRef for drawFrame`)
- [ ] AC-3: `useImperativeHandle` includes `wallpaper` and `customWallpaperUrl` in its dependency array. (maps to test: `customWallpaperRecording.test.ts -> useImperativeHandle includes wallpaper dependencies`)
- [ ] AC-4: Full test suite passes without regressions.

## Allowed files
- `apps/web/src/features/stage-studio/InteractiveStage.tsx`
- `tests/stage-studio/customWallpaperRecording.test.ts`

## Out of scope
- Modifying UI styling or layout of the wallpaper picker dropdown
- External file storage or server-side media upload APIs
- Modifying other components like `PreviewPanel.tsx` or `desktop-engine`

## Known risks
- None identified; changes are purely internal ref synchronization, dependency array additions, and helper function extraction.
