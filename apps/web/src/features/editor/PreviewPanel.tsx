"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Film,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Circle,
  Square,
  Layers,
  Sparkles,
  Bug,
} from "lucide-react";
import { IconButton } from "@cutaway/ui";
import { formatTimecode } from "@cutaway/timeline-engine";
import { importFile } from "@cutaway/media-engine";
import type { StageTakeManifest, Rect } from "@cutaway/types";
import {
  MouseFollowCamera,
  resolveDesktopFrame,
  stageDiagnostics,
} from "@desktop-stage/desktop-engine";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { PreviewStage } from "@/features/preview/PreviewStage";
import { MaskOverlay } from "@/features/masks/MaskOverlay";
import { useElementSize } from "@/hooks/useElementSize";
import {
  InteractiveStage,
  type InteractiveStageHandle,
} from "@/features/stage-studio/InteractiveStage";
import { StageDebugHUD } from "@/features/stage-studio/StageDebugHUD";

/**
 * Workspace surface with interactive virtual desktop and playback preview.
 *
 * Defaults to "interactive" mode, hosting the simulated macOS virtual desktop
 * directly in the central canvas space. Recordings immediately ingest into
 * media storage and appear on the timeline as playable video clips.
 */
export function PreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<InteractiveStageHandle>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<"interactive" | "preview">(
    "interactive",
  );

  const resolution = useEditorStore(
    (state) => state.project.settings.resolution,
  );
  const background = useEditorStore(
    (state) => state.project.settings.backgroundColor,
  );
  const project = useEditorStore((state) => state.project);
  const playhead = useEditorStore((state) => state.playhead);
  const duration = useEditorStore((state) => state.project.durationFrames);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const isEmpty = useEditorStore(
    (state) => Object.keys(state.project.entities.clips).length === 0,
  );

  const togglePlaying = useEditorStore((state) => state.togglePlaying);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const addMediaAssets = useEditorStore((state) => state.addMediaAssets);
  const addClipFromAsset = useEditorStore((state) => state.addClipFromAsset);
  const addTrackMouseAction = useEditorStore(
    (state) => state.addTrackMouseAction,
  );
  const setTrackFlag = useEditorStore((state) => state.setTrackFlag);
  const { store } = useMediaImportContext();

  // Recording UI state
  const [recordingMode, setRecordingMode] = useState<"full" | "selected-area">(
    "full",
  );
  const [recordingEngine, setRecordingEngine] = useState<
    "canvas" | "display-media"
  >("canvas");
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [selectedCrop, setSelectedCrop] = useState<Rect>({
    x: 140,
    y: 90,
    width: 800,
    height: 500,
  });
  const [takeNotice, setTakeNotice] = useState<string | null>(null);
  const [showDebugHud, setShowDebugHud] = useState(false);

  // Take review and mouse follow camera
  const [lastTake, setLastTake] = useState<StageTakeManifest | null>(null);
  const camera = useMemo(() => new MouseFollowCamera(), []);

  // Resolve current desktop frame and camera tracking from timeline action clips
  const resolvedDesktop = useMemo(
    () => resolveDesktopFrame(project, playhead),
    [project, playhead],
  );
  const activeCamera = resolvedDesktop.camera;

  const containerSize = useElementSize(containerRef);

  const stageSize = (() => {
    const padding = 32;
    const availableWidth = Math.max(0, containerSize.width - padding);
    const availableHeight = Math.max(0, containerSize.height - padding);
    const projectAspect = resolution.width / resolution.height;

    const width = Math.min(availableWidth, availableHeight * projectAspect);
    return { width, height: width / projectAspect };
  })();

  const handleRecordingStatusChange = useCallback(
    (rec: boolean, dur: number) => {
      setIsRecording(rec);
      setRecordDuration(dur);
    },
    [],
  );

  const handleStartRecording = () => {
    stageDiagnostics.log(
      "UI",
      `User initiated recording in mode: ${recordingMode} with engine: ${recordingEngine}`,
    );
    stageRef.current?.startRecording(
      recordingMode,
      recordingMode === "selected-area" ? selectedCrop : undefined,
      recordingEngine,
    );
  };

  const handleStopRecording = async () => {
    if (!stageRef.current) return;
    stageDiagnostics.log("UI", "User stopped recording");
    try {
      // stopRecording() internally invokes onTakeRecorded?.(blob, manifest) which triggers handleTakeRecorded
      await stageRef.current.stopRecording();
    } catch (err) {
      console.error("Error stopping recording:", err);
    }
  };

  const handleTakeRecorded = async (
    videoBlob: Blob,
    manifest: StageTakeManifest,
  ) => {
    try {
      const takeFile = new File([videoBlob], `stage-take-${Date.now()}.webm`, {
        type: "video/webm",
      });
      const asset = await importFile(takeFile, { store: store() });

      // Sanitize duration to prevent uninitialized epoch timestamps
      const sanitizedDurationMs =
        manifest.durationMs > 86400000 || manifest.durationMs <= 0
          ? 1000
          : manifest.durationMs;
      const sanitizedManifest: StageTakeManifest = {
        ...manifest,
        durationMs: sanitizedDurationMs,
      };

      setLastTake(sanitizedManifest);

      // Explicitly set the real take duration in seconds from the recorder manifest
      // so addClipFromAsset creates a clip matching the real recording length
      asset.metadata.durationSeconds = sanitizedDurationMs / 1000;
      addMediaAssets([asset]);
      addClipFromAsset(asset.id);

      // Hide starter desktop wireframe track if present so the recorded take video is fully visible
      const tracks = useEditorStore.getState().project.entities.tracks;
      if (tracks["track-desktop"]) {
        setTrackFlag("track-desktop", "hidden", true);
      }

      setTakeNotice(
        `Take recorded (${(sanitizedDurationMs / 1000).toFixed(1)}s) added to timeline`,
      );
      setTimeout(() => setTakeNotice(null), 5000);

      // Auto-switch to preview mode with playhead at start of new clip
      setWorkspaceMode("preview");
      setPlayhead(0);
    } catch (err) {
      console.error("Failed to add recorded take to timeline:", err);
    }
  };

  // Compute camera follow view if an active trackMouse timeline action is resolving at playhead
  const cameraView = useMemo(() => {
    if (!lastTake || !activeCamera.active) return null;
    const targetClip = activeCamera.targetVideoClipId
      ? project.entities.clips[activeCamera.targetVideoClipId]
      : undefined;
    const clipStartFrame = targetClip?.startFrame ?? 0;
    const currentMs = Math.min(
      lastTake.durationMs,
      Math.max(0, ((playhead - clipStartFrame) / fps) * 1000),
    );
    try {
      return camera.computeSmoothedView(
        lastTake.pointerEvents,
        currentMs,
        lastTake.recordingRect,
        activeCamera.zoom,
      );
    } catch {
      return null;
    }
  }, [
    camera,
    lastTake,
    activeCamera.active,
    activeCamera.zoom,
    activeCamera.targetVideoClipId,
    project.entities.clips,
    playhead,
    fps,
  ]);

  const shouldApplyCameraFollow =
    workspaceMode === "preview" && activeCamera.active && Boolean(cameraView);

  return (
    <div className="bg-surface-base flex h-full flex-col">
      {/* Central Canvas Workspace */}
      <div ref={containerRef} className="bg-canvas relative min-h-0 flex-1">
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="shadow-panel relative overflow-hidden"
            style={{
              width: stageSize.width,
              height: stageSize.height,
              backgroundColor: background,
            }}
          >
            {/* Mouse-Follow Camera Zoom Wrapper */}
            <div
              className="relative h-full w-full"
              style={
                shouldApplyCameraFollow && cameraView
                  ? (() => {
                      const baseW = lastTake?.recordingRect.width || 1280;
                      const baseH = lastTake?.recordingRect.height || 720;
                      const cropOriginX = lastTake?.recordingRect.x || 0;
                      const cropOriginY = lastTake?.recordingRect.y || 0;
                      const localVpCenterX =
                        cameraView.viewport.x +
                        cameraView.viewport.width / 2 -
                        cropOriginX;
                      const localVpCenterY =
                        cameraView.viewport.y +
                        cameraView.viewport.height / 2 -
                        cropOriginY;
                      const rawDx = ((baseW / 2 - localVpCenterX) / baseW) * 100;
                      const rawDy = ((baseH / 2 - localVpCenterY) / baseH) * 100;

                      // Prevent camera from panning outside stage boundary
                      const maxShiftX =
                        ((cameraView.zoom - 1) / (2 * cameraView.zoom)) * 100;
                      const maxShiftY =
                        ((cameraView.zoom - 1) / (2 * cameraView.zoom)) * 100;
                      const clampedDx = Math.max(
                        -maxShiftX,
                        Math.min(maxShiftX, rawDx),
                      );
                      const clampedDy = Math.max(
                        -maxShiftY,
                        Math.min(maxShiftY, rawDy),
                      );

                      return {
                        transform: `scale(${cameraView.zoom}) translate(${clampedDx}%, ${clampedDy}%)`,
                        transformOrigin: "center center",
                        transition: isPlaying
                          ? "none"
                          : "transform 0.08s ease-out",
                      };
                    })()
                  : undefined
              }
            >
              {stageSize.width > 0 && (
                <>
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      display: workspaceMode === "interactive" ? "flex" : "none",
                    }}
                  >
                    <InteractiveStage
                      ref={stageRef}
                      width={stageSize.width}
                      height={stageSize.height}
                      onTakeRecorded={handleTakeRecorded}
                      onRecordingStatusChange={handleRecordingStatusChange}
                      selectedCrop={selectedCrop}
                      onCropChange={setSelectedCrop}
                      recordingMode={recordingMode}
                      onRecordingModeChange={setRecordingMode}
                    />
                  </div>

                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      display: workspaceMode === "preview" ? "flex" : "none",
                    }}
                  >
                    <PreviewStage
                      width={stageSize.width}
                      height={stageSize.height}
                    />
                  </div>
                </>
              )}

              {workspaceMode === "preview" && showGuides && <SafeGuides />}
              {workspaceMode === "preview" && isEmpty && <StartHint />}
              {workspaceMode === "preview" && stageSize.width > 0 && (
                <MaskOverlay
                  width={stageSize.width}
                  height={stageSize.height}
                  resolution={resolution}
                />
              )}
            </div>

            {/* Camera Active Indicator Overlay */}
            {shouldApplyCameraFollow && (
              <div className="pointer-events-none absolute top-3 left-3 z-40 flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-1 text-2xs font-semibold text-black shadow-lg backdrop-blur-xs animate-fade-in">
                <Sparkles size={12} className="fill-current" />
                <span>{activeCamera.zoom}× MOUSE FOLLOW ACTIVE</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Take Review & Mouse-Follow Bar (Visible when a take is available) */}
      {lastTake && (
        <div className="border-border-subtle bg-surface-panel/95 flex h-9 shrink-0 items-center justify-between border-t px-3 text-xs backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-zinc-200">Take Review:</span>
              <span className="font-mono text-zinc-400 text-2xs">
                {(lastTake.durationMs / 1000).toFixed(1)}s ·{" "}
                {lastTake.pointerEvents.length} events
              </span>
            </div>

            {activeCamera.active ? (
              <span className="flex items-center gap-1 text-2xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Camera Follow Active ({activeCamera.zoom}×)
              </span>
            ) : (
              <span className="text-2xs text-zinc-400">
                (Camera follow active when playhead is over a Track Mouse action)
              </span>
            )}
          </div>

          <div className="text-2xs text-zinc-400 flex items-center gap-2">
            <span>Camera follow math computed via</span>
            <span className="font-mono text-emerald-400 font-medium">
              MouseFollowCamera
            </span>
          </div>
        </div>
      )}

      {/* Bottom Control / Transport Bar */}
      <div className="border-border-subtle bg-surface-panel flex h-11 shrink-0 items-center justify-between border-t px-3">
        {/* Left: View Mode Tabs & Status */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-zinc-800 p-0.5 border border-zinc-700">
            <button
              onClick={() => setWorkspaceMode("interactive")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                workspaceMode === "interactive"
                  ? "bg-accent text-accent-text shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Interactive macOS virtual desktop"
            >
              <Layers size={13} />
              Interactive Stage
            </button>
            <button
              onClick={() => setWorkspaceMode("preview")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                workspaceMode === "preview"
                  ? "bg-accent text-accent-text shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Timeline video player"
            >
              <Film size={13} />
              Timeline Preview
            </button>
          </div>

          {takeNotice && (
            <span className="text-2xs font-medium text-emerald-400 animate-fade-in">
              {takeNotice}
            </span>
          )}

          {workspaceMode === "preview" && (
            <span className="tabular text-text-primary ml-2 text-xs">
              {formatTimecode(playhead, fps)}
            </span>
          )}
        </div>

        {/* Center: Stage Recording Controls OR Timeline Transport */}
        {workspaceMode === "interactive" ? (
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <>
                <select
                  value={recordingMode}
                  onChange={(e) => setRecordingMode(e.target.value as any)}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                >
                  <option value="full">Full Desktop (1280×720)</option>
                  <option value="selected-area">Selected Area Crop</option>
                </select>

                <select
                  value={recordingEngine}
                  onChange={(e) => setRecordingEngine(e.target.value as any)}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                  title="Recording Engine: Canvas (Fast, No Prompt) or Real Screen (DisplayMedia tab record)"
                >
                  <option value="canvas">🎨 Canvas (Fast)</option>
                  <option value="display-media">🖥️ Real Screen Record</option>
                </select>

                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white shadow-xs hover:bg-rose-500 transition-colors"
                >
                  <Circle size={10} className="fill-current" />
                  Record Stage
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 rounded bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 border border-rose-500/20">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  REC {(recordDuration / 1000).toFixed(1)}s
                </span>
                <button
                  onClick={handleStopRecording}
                  className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-600 transition-colors"
                >
                  <Square size={10} className="fill-current" />
                  Stop Recording
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-0.5">
            <IconButton label="Go to start" onClick={() => setPlayhead(0)}>
              <SkipBack size={15} />
            </IconButton>
            <IconButton
              label="Previous frame"
              onClick={() => setPlayhead(playhead - 1)}
            >
              <ChevronsLeft size={15} />
            </IconButton>
            <IconButton
              label={isPlaying ? "Pause (Space)" : "Play (Space)"}
              variant="secondary"
              onClick={togglePlaying}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </IconButton>
            <IconButton
              label="Next frame"
              onClick={() => setPlayhead(playhead + 1)}
            >
              <ChevronsRight size={15} />
            </IconButton>
            <IconButton label="Go to end" onClick={() => setPlayhead(duration)}>
              <SkipForward size={15} />
            </IconButton>
          </div>
        )}

        {/* Right: Safe guides & Stage Diagnostics HUD */}
        <div className="flex items-center justify-end gap-1.5 w-32">
          <IconButton
            size="sm"
            label="Toggle Stage Diagnostics HUD"
            active={showDebugHud}
            onClick={() => setShowDebugHud((value) => !value)}
          >
            <Bug
              size={14}
              className={showDebugHud ? "text-amber-400" : "text-zinc-400"}
            />
          </IconButton>

          {workspaceMode === "preview" && (
            <IconButton
              size="sm"
              label="Toggle safe guides"
              active={showGuides}
              onClick={() => setShowGuides((value) => !value)}
            >
              <span className="text-2xs font-semibold">SAFE</span>
            </IconButton>
          )}
        </div>
      </div>

      {/* Floating Collapsible Stage Diagnostics HUD */}
      {showDebugHud && (
        <StageDebugHUD
          onClose={() => setShowDebugHud(false)}
          workspaceMode={workspaceMode}
          trackMouseEnabled={activeCamera.active}
          isRecording={isRecording}
        />
      )}
    </div>
  );
}

/**
 * First-run guidance when timeline is empty in preview mode.
 */
function StartHint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center"
    >
      <div className="flex flex-col items-center gap-1.5">
        <Film size={22} className="text-text-tertiary/50" />
        <p className="text-text-secondary text-xs font-medium">
          Timeline is empty
        </p>
        <p className="text-text-tertiary text-2xs max-w-[240px] leading-relaxed">
          Switch to Desktop Stage to record interactive takes, or import media
          files.
        </p>
      </div>
    </div>
  );
}

/**
 * Title- and action-safe guides.
 */
function SafeGuides() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-[5%] border border-white/20" />
      <div className="absolute inset-[10%] border border-white/15" />
      <div className="absolute top-1/2 right-0 left-0 h-px bg-white/10" />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/10" />
    </div>
  );
}
