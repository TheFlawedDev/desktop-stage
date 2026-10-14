"use client";

import { useRef, useState, useCallback } from "react";
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
} from "lucide-react";
import { IconButton } from "@cutaway/ui";
import { formatTimecode } from "@cutaway/timeline-engine";
import { importFile } from "@cutaway/media-engine";
import type { StageTakeManifest, Rect } from "@cutaway/types";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { PreviewStage } from "@/features/preview/PreviewStage";
import { MaskOverlay } from "@/features/masks/MaskOverlay";
import { useElementSize } from "@/hooks/useElementSize";
import {
  InteractiveStage,
  type InteractiveStageHandle,
} from "@/features/stage-studio/InteractiveStage";

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
  const [workspaceMode, setWorkspaceMode] = useState<"interactive" | "preview">("interactive");

  const resolution = useEditorStore((state) => state.project.settings.resolution);
  const background = useEditorStore((state) => state.project.settings.backgroundColor);
  const playhead = useEditorStore((state) => state.playhead);
  const duration = useEditorStore((state) => state.project.durationFrames);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const isEmpty = useEditorStore((state) => Object.keys(state.project.entities.clips).length === 0);

  const togglePlaying = useEditorStore((state) => state.togglePlaying);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const addMediaAssets = useEditorStore((state) => state.addMediaAssets);
  const addClipFromAsset = useEditorStore((state) => state.addClipFromAsset);
  const { store } = useMediaImportContext();

  // Recording UI state
  const [recordingMode, setRecordingMode] = useState<"full" | "selected-area">("full");
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [selectedCrop, setSelectedCrop] = useState<Rect>({ x: 140, y: 90, width: 800, height: 500 });
  const [takeNotice, setTakeNotice] = useState<string | null>(null);

  const containerSize = useElementSize(containerRef);

  const stageSize = (() => {
    const padding = 32;
    const availableWidth = Math.max(0, containerSize.width - padding);
    const availableHeight = Math.max(0, containerSize.height - padding);
    const projectAspect = resolution.width / resolution.height;

    const width = Math.min(availableWidth, availableHeight * projectAspect);
    return { width, height: width / projectAspect };
  })();

  const handleRecordingStatusChange = useCallback((rec: boolean, dur: number) => {
    setIsRecording(rec);
    setRecordDuration(dur);
  }, []);

  const handleStartRecording = () => {
    stageRef.current?.startRecording(
      recordingMode,
      recordingMode === "selected-area" ? selectedCrop : undefined
    );
  };

  const handleStopRecording = async () => {
    if (!stageRef.current) return;
    try {
      const { blob, manifest } = await stageRef.current.stopRecording();
      await handleTakeRecorded(blob, manifest);
    } catch (err) {
      console.error("Error stopping recording:", err);
    }
  };

  const handleTakeRecorded = async (videoBlob: Blob, manifest: StageTakeManifest) => {
    try {
      const takeFile = new File([videoBlob], `stage-take-${Date.now()}.webm`, {
        type: "video/webm",
      });
      const asset = await importFile(takeFile, { store: store() });
      addMediaAssets([asset]);
      addClipFromAsset(asset.id);

      setTakeNotice(`Take recorded (${(manifest.durationMs / 1000).toFixed(1)}s) & added to timeline!`);
      setTimeout(() => setTakeNotice(null), 4000);

      // Auto-switch to preview mode with playhead at start of new clip
      setWorkspaceMode("preview");
      setPlayhead(0);
    } catch (err) {
      console.error("Failed to add recorded take to timeline:", err);
    }
  };

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
            {stageSize.width > 0 && (
              workspaceMode === "interactive" ? (
                <InteractiveStage
                  ref={stageRef}
                  width={stageSize.width}
                  height={stageSize.height}
                  onTakeRecorded={handleTakeRecorded}
                  onRecordingStatusChange={handleRecordingStatusChange}
                  selectedCrop={selectedCrop}
                  onCropChange={setSelectedCrop}
                />
              ) : (
                <PreviewStage width={stageSize.width} height={stageSize.height} />
              )
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
        </div>
      </div>

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
            <IconButton label="Previous frame" onClick={() => setPlayhead(playhead - 1)}>
              <ChevronsLeft size={15} />
            </IconButton>
            <IconButton
              label={isPlaying ? "Pause (Space)" : "Play (Space)"}
              variant="secondary"
              onClick={togglePlaying}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </IconButton>
            <IconButton label="Next frame" onClick={() => setPlayhead(playhead + 1)}>
              <ChevronsRight size={15} />
            </IconButton>
            <IconButton label="Go to end" onClick={() => setPlayhead(duration)}>
              <SkipForward size={15} />
            </IconButton>
          </div>
        )}

        {/* Right: Safe guides */}
        <div className="flex items-center justify-end w-28">
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
        <p className="text-text-secondary text-xs font-medium">Timeline is empty</p>
        <p className="text-text-tertiary text-2xs max-w-[240px] leading-relaxed">
          Switch to Desktop Stage to record interactive takes, or import media files.
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
