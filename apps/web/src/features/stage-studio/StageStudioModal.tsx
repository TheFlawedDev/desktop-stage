"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Minus,
  Square,
  Terminal,
  Folder,
  Globe,
  Video,
  Camera,
  Play,
  Pause,
  Circle,
  MousePointer,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowRight,
  Maximize2,
  RefreshCw,
  Plus,
} from "lucide-react";
import {
  StageWindowManager,
  MemoryVirtualFileSystem,
  ItermEvaluator,
  ArcController,
  resolveRecordingRect,
  PointerLogger,
  MouseFollowCamera,
} from "@desktop-stage/desktop-engine";
import type {
  StageWindowConfig,
  StageAppKind,
  StagePointerEvent,
  StageTakeManifest,
} from "@cutaway/types";

interface StageStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportTake?: (videoBlob: Blob, manifest: StageTakeManifest) => void;
}

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

export function StageStudioModal({ isOpen, onClose }: StageStudioModalProps) {
  // Initialize stateful engine subsystems
  const [wm] = useState(() => new StageWindowManager({
    defaultRect: { x: 80, y: 80, width: 640, height: 480 },
  }));
  const [vfs] = useState(() => new MemoryVirtualFileSystem());
  const [terminal] = useState(() => new ItermEvaluator(vfs));
  const [camera] = useState(() => new MouseFollowCamera());

  // Window list synced from StageWindowManager
  const [windows, setWindows] = useState<StageWindowConfig[]>([]);
  const syncWindows = () => {
    setWindows(wm.getWindows());
  };

  // Seed default files in VFS
  useEffect(() => {
    void (async () => {
      try {
        if (!(await vfs.exists("/welcome.txt"))) {
          await vfs.writeFile(
            "/welcome.txt",
            "Welcome to Desktop Stage!\nTry opening iTerm or Finder to explore the virtual sandbox.\n"
          );
        }
      } catch {
        // ignore seed error
      }
    })();
  }, [vfs]);

  // Terminal state
  const [terminalHistory, setTerminalHistory] = useState<Array<{ cmd: string; out: string; err?: string }>>([
    { cmd: "welcome", out: "Desktop Stage iTerm Virtual Shell\nType 'help' for available commands.\n" },
  ]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalCwd, setTerminalCwd] = useState("/");

  // Finder state
  const [finderFiles, setFinderFiles] = useState<Array<{ name: string; isDir: boolean; size: number }>>([]);
  const [newFileName, setNewFileName] = useState("");

  const refreshFinder = async () => {
    try {
      const entries = await vfs.listDirectory("/");
      setFinderFiles(
        entries.map((e) => ({
          name: e.name,
          isDir: e.isDirectory,
          size: e.sizeBytes,
        }))
      );
    } catch {
      setFinderFiles([]);
    }
  };

  useEffect(() => {
    void refreshFinder();
  }, [vfs]);

  // Arc browser state
  const [arcUrl, setArcUrl] = useState("https://example.com");
  const [arcActiveUrl, setArcActiveUrl] = useState("https://example.com");

  // Dragging window state
  const [draggingWindowId, setDraggingWindowId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Recording State
  const [recordingMode, setRecordingMode] = useState<"full" | "selected-area">("full");
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const recordStartTimeRef = useRef(0);
  const pointerLoggerRef = useRef<PointerLogger | null>(null);
  const recordedEventsRef = useRef<StagePointerEvent[]>([]);

  // Selected crop rect (for selected-area mode)
  const [selectedCrop, setSelectedCrop] = useState({ x: 100, y: 80, width: 800, height: 500 });

  // Take review state
  const [lastTake, setLastTake] = useState<StageTakeManifest | null>(null);
  const [trackMouseEnabled, setTrackMouseEnabled] = useState(false);
  const [previewScrubMs, setPreviewScrubMs] = useState(0);

  // Sync window manager initially
  useEffect(() => {
    if (isOpen && wm.getWindows().length === 0) {
      wm.openApp("finder", { x: 80, y: 80, width: 500, height: 350 });
      wm.openApp("iterm", { x: 300, y: 180, width: 540, height: 340 });
      syncWindows();
    }
  }, [isOpen, wm]);

  // Recording ticker
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setRecordDuration(Date.now() - recordStartTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [isRecording]);

  // Window drag handlers
  const handleWindowHeaderMouseDown = (e: React.MouseEvent, win: StageWindowConfig) => {
    wm.focusWindow(win.id);
    syncWindows();
    setDraggingWindowId(win.id);
    setDragOffset({
      x: e.clientX - win.rect.x,
      y: e.clientY - win.rect.y,
    });
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const stageRect = e.currentTarget.getBoundingClientRect();
    const stageX = Math.round(e.clientX - stageRect.left);
    const stageY = Math.round(e.clientY - stageRect.top);

    // If dragging window
    if (draggingWindowId) {
      const newX = Math.max(0, Math.min(STAGE_WIDTH - 100, Math.round(e.clientX - dragOffset.x)));
      const newY = Math.max(28, Math.min(STAGE_HEIGHT - 60, Math.round(e.clientY - dragOffset.y)));
      wm.moveWindow(draggingWindowId, { x: newX, y: newY });
      syncWindows();
    }

    // If recording, log pointer event
    if (isRecording && pointerLoggerRef.current) {
      pointerLoggerRef.current.record({
        timestampMs: Date.now(),
        pos: { x: stageX, y: stageY },
        type: draggingWindowId ? "drag" : "move",
      });
    }
  };

  const handleStageMouseUp = () => {
    if (draggingWindowId) {
      setDraggingWindowId(null);
    }
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isRecording && pointerLoggerRef.current) {
      const stageRect = e.currentTarget.getBoundingClientRect();
      const stageX = Math.round(e.clientX - stageRect.left);
      const stageY = Math.round(e.clientY - stageRect.top);
      pointerLoggerRef.current.record({
        timestampMs: Date.now(),
        pos: { x: stageX, y: stageY },
        type: "click",
      });
    }
  };

  // Dock actions
  const handleDockClick = (kind: StageAppKind) => {
    const existing = wm.getWindows().find((w) => w.appKind === kind);
    if (existing) {
      if (existing.isMinimized) {
        wm.restoreWindow(existing.id);
      } else {
        wm.focusWindow(existing.id);
      }
    } else {
      const offset = (wm.getWindows().length % 5) * 30;
      wm.openApp(kind, { x: 120 + offset, y: 100 + offset, width: 600, height: 400 });
    }
    syncWindows();
  };

  // Terminal execute
  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = terminalInput.trim();
    if (!cmd) return;

    setTerminalInput("");
    const res = await terminal.execute(cmd, terminalCwd);
    if (res.cwd) {
      setTerminalCwd(res.cwd);
    }
    if (res.clear) {
      setTerminalHistory([]);
    } else {
      setTerminalHistory((prev) => [
        ...prev,
        { cmd, out: res.stdout, err: res.stderr },
      ]);
    }
    void refreshFinder();
  };

  // Create file in Finder
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    try {
      const path = `/${newFileName.trim()}`;
      await vfs.writeFile(path, "Sample content created from Desktop Stage Finder\n");
      setNewFileName("");
      void refreshFinder();
    } catch (err: any) {
      alert(`Error creating file: ${err?.message}`);
    }
  };

  // Start recording
  const handleStartRecording = () => {
    const stageRect = { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
    const rect = resolveRecordingRect(stageRect, {
      mode: recordingMode,
      selectedRect: recordingMode === "selected-area" ? selectedCrop : undefined,
      recordAudio: false,
      muteWebAudio: true,
    });

    wm.setRecordingRegion(recordingMode === "selected-area" ? rect : null);
    syncWindows();

    const now = Date.now();
    recordStartTimeRef.current = now;
    pointerLoggerRef.current = new PointerLogger({
      recordingRect: rect,
      startedAtMs: now,
    });

    setIsRecording(true);
    setRecordDuration(0);
    setLastTake(null);
  };

  // Stop recording
  const handleStopRecording = () => {
    const durationMs = Date.now() - recordStartTimeRef.current;
    const events = pointerLoggerRef.current?.getEvents() ?? [];
    recordedEventsRef.current = events;

    const manifest: StageTakeManifest = {
      takeId: `take-${Date.now()}`,
      videoUri: "blob:mock-desktop-take",
      durationMs,
      recordingRect:
        recordingMode === "selected-area"
          ? selectedCrop
          : { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT },
      pointerEvents: events,
      trackMouseEnabled: false,
      createdAt: Date.now(),
    };

    setLastTake(manifest);
    setIsRecording(false);
    wm.setRecordingRegion(null);
    syncWindows();
  };

  // Compute camera follow view if trackMouse is enabled
  const cameraView = useMemo(() => {
    if (!lastTake || !trackMouseEnabled) return null;
    return camera.computeSmoothedView(
      lastTake.pointerEvents,
      previewScrubMs,
      lastTake.recordingRect,
      1.5
    );
  }, [camera, lastTake, trackMouseEnabled, previewScrubMs]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="flex h-[94vh] w-[95vw] max-w-[1400px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Top Studio Control Bar */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <Layers size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Desktop Stage: Interactive Workspace</h2>
              <p className="text-xs text-zinc-400">
                Live simulated macOS virtual desktop with sandboxed apps & recording
              </p>
            </div>
          </div>

          {/* Recording Controls */}
          <div className="flex items-center gap-3">
            {!isRecording ? (
              <div className="flex items-center gap-2">
                <select
                  value={recordingMode}
                  onChange={(e) => setRecordingMode(e.target.value as any)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none"
                >
                  <option value="full">Full Desktop (1280×720)</option>
                  <option value="selected-area">Selected Area Crop</option>
                </select>

                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-rose-500 transition-colors"
                >
                  <Circle size={12} className="fill-current" />
                  Record Stage
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-md bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500"></span>
                  </span>
                  Recording Take: {(recordDuration / 1000).toFixed(1)}s
                </div>

                <button
                  onClick={handleStopRecording}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600"
                >
                  <Square size={12} className="fill-current" />
                  Stop Recording
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main Stage Display Area */}
        <div className="relative flex flex-1 items-center justify-center overflow-auto bg-zinc-950/60 p-4">
          {/* Virtual macOS Desktop Screen (1280x720) */}
          <div
            className="relative overflow-hidden rounded-lg shadow-2xl border border-zinc-700 select-none"
            style={{
              width: STAGE_WIDTH,
              height: STAGE_HEIGHT,
              background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #1e3a8a 100%)",
            }}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onClick={handleStageClick}
          >
            {/* macOS Menu Bar */}
            <div className="absolute top-0 left-0 right-0 z-40 flex h-7 items-center justify-between bg-black/40 px-3 text-xs text-white/90 backdrop-blur-md">
              <div className="flex items-center gap-4">
                <span className="font-semibold text-white"></span>
                <span className="font-semibold">Desktop Stage</span>
                <span className="text-white/60">File</span>
                <span className="text-white/60">Edit</span>
                <span className="text-white/60">View</span>
                <span className="text-white/60">Window</span>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <span>100%</span>
                <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>

            {/* Selected Area Highlight Box (when recording in selected-area mode) */}
            {recordingMode === "selected-area" && (
              <div
                className="pointer-events-none absolute z-30 border-2 border-dashed border-amber-400 bg-amber-500/10"
                style={{
                  left: selectedCrop.x,
                  top: selectedCrop.y,
                  width: selectedCrop.width,
                  height: selectedCrop.height,
                }}
              >
                <div className="absolute -top-6 left-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black uppercase">
                  Recording Region ({selectedCrop.width}×{selectedCrop.height})
                </div>
              </div>
            )}

            {/* Mouse-Follow Camera Viewport Indicator (during review) */}
            {cameraView && (
              <div
                className="pointer-events-none absolute z-35 border-2 border-emerald-400 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.3)] transition-all duration-75"
                style={{
                  left: cameraView.viewport.x,
                  top: cameraView.viewport.y,
                  width: cameraView.viewport.width,
                  height: cameraView.viewport.height,
                }}
              >
                <div className="absolute -top-6 left-0 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-black uppercase">
                  1.5× Follow View ({Math.round(cameraView.viewport.width)}×{Math.round(cameraView.viewport.height)})
                </div>
              </div>
            )}

            {/* Render Stage Windows */}
            {windows.map((win) => {
              if (win.isMinimized) return null;
              return (
                <div
                  key={win.id}
                  className={`absolute flex flex-col overflow-hidden rounded-lg shadow-2xl border transition-shadow ${
                    win.isFocused
                      ? "border-zinc-500/70 shadow-black/80"
                      : "border-zinc-700/50 opacity-95 shadow-black/50"
                  }`}
                  style={{
                    left: win.rect.x,
                    top: win.rect.y,
                    width: win.rect.width,
                    height: win.rect.height,
                    zIndex: win.zIndex,
                    backgroundColor: "#18181b",
                  }}
                  onMouseDown={() => {
                    wm.focusWindow(win.id);
                    syncWindows();
                  }}
                >
                  {/* Window Title Bar */}
                  <div
                    className="flex h-8 shrink-0 cursor-move items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 select-none"
                    onMouseDown={(e) => handleWindowHeaderMouseDown(e, win)}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          wm.closeWindow(win.id);
                          syncWindows();
                        }}
                        className="h-3 w-3 rounded-full bg-rose-500 hover:opacity-80"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          wm.minimizeWindow(win.id);
                          syncWindows();
                        }}
                        className="h-3 w-3 rounded-full bg-amber-500 hover:opacity-80"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          wm.resizeWindow(win.id, {
                            width: win.rect.width === 700 ? 500 : 700,
                            height: win.rect.height === 450 ? 320 : 450,
                          });
                          syncWindows();
                        }}
                        className="h-3 w-3 rounded-full bg-emerald-500 hover:opacity-80"
                      />
                    </div>
                    <span className="text-xs font-medium text-zinc-300">{win.title}</span>
                    <div className="w-10" />
                  </div>

                  {/* Window Body by App Kind */}
                  <div className="flex-1 overflow-hidden bg-zinc-950 p-2 text-zinc-100">
                    {win.appKind === "iterm" && (
                      <div className="flex h-full flex-col font-mono text-xs">
                        <div className="flex-1 overflow-y-auto space-y-1 p-1 text-emerald-400">
                          {terminalHistory.map((item, idx) => (
                            <div key={idx}>
                              <div className="text-zinc-400">
                                <span className="text-indigo-400">guest@desktop</span>:
                                <span className="text-amber-400">{terminalCwd}</span>$ {item.cmd}
                              </div>
                              {item.out && <div className="text-zinc-200 whitespace-pre-wrap">{item.out}</div>}
                              {item.err && <div className="text-rose-400 whitespace-pre-wrap">{item.err}</div>}
                            </div>
                          ))}
                        </div>
                        <form onSubmit={handleTerminalSubmit} className="flex items-center gap-2 border-t border-zinc-800 pt-2">
                          <span className="text-emerald-500">❯</span>
                          <input
                            type="text"
                            value={terminalInput}
                            onChange={(e) => setTerminalInput(e.target.value)}
                            placeholder="Type command (e.g. ls, pwd, mkdir test, cat /welcome.txt)..."
                            className="flex-1 bg-transparent text-zinc-100 focus:outline-none"
                            autoFocus
                          />
                        </form>
                      </div>
                    )}

                    {win.appKind === "finder" && (
                      <div className="flex h-full flex-col text-xs">
                        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                          <span className="font-semibold text-zinc-300">Virtual Filesystem ({finderFiles.length} items)</span>
                          <form onSubmit={handleCreateFile} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={newFileName}
                              onChange={(e) => setNewFileName(e.target.value)}
                              placeholder="new_file.txt"
                              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-500"
                            >
                              <Plus size={12} /> Add
                            </button>
                          </form>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                          {finderFiles.length === 0 ? (
                            <div className="text-zinc-500">No files found.</div>
                          ) : (
                            <div className="grid grid-cols-3 gap-3">
                              {finderFiles.map((file) => (
                                <div
                                  key={file.name}
                                  className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 hover:bg-zinc-800/80"
                                >
                                  <Folder size={18} className="text-indigo-400" />
                                  <div className="overflow-hidden">
                                    <div className="truncate font-medium text-zinc-200">{file.name}</div>
                                    <div className="text-[10px] text-zinc-500">{file.size} bytes</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {win.appKind === "arc" && (
                      <div className="flex h-full flex-col text-xs">
                        <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
                          <input
                            type="text"
                            value={arcUrl}
                            onChange={(e) => setArcUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setArcActiveUrl(arcUrl);
                            }}
                            className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-100 focus:outline-none"
                          />
                          <button
                            onClick={() => setArcActiveUrl(arcUrl)}
                            className="rounded bg-indigo-600 px-2.5 py-1 text-white hover:bg-indigo-500"
                          >
                            Go
                          </button>
                        </div>
                        <div className="flex-1 overflow-auto rounded bg-zinc-900 p-4 text-center">
                          <div className="mx-auto max-w-sm pt-8">
                            <Globe size={32} className="mx-auto text-indigo-400 mb-2" />
                            <h4 className="font-semibold text-zinc-200">Arc Sandboxed Browser</h4>
                            <p className="mt-1 text-zinc-400 text-xs">
                              Navigated to: <span className="text-indigo-300 font-mono">{arcActiveUrl}</span>
                            </p>
                            <p className="mt-4 text-[11px] text-zinc-500">
                              Enforces Chromium context isolation, no Node integration, and audio muting during stage recording.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {win.appKind === "quicktime" && (
                      <div className="flex h-full flex-col items-center justify-center text-center text-xs">
                        <Video size={36} className="text-zinc-600 mb-2" />
                        <span className="font-medium text-zinc-300">QuickTime Player</span>
                        <span className="text-zinc-500 mt-1">Audio/video stream isolated for stage mixer</span>
                      </div>
                    )}

                    {win.appKind === "photobooth" && (
                      <div className="flex h-full flex-col items-center justify-center text-center text-xs">
                        <Camera size={36} className="text-zinc-600 mb-2" />
                        <span className="font-medium text-zinc-300">Photo Booth</span>
                        <span className="text-zinc-500 mt-1">Front camera placeholder stream</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* macOS Dock */}
            <div className="absolute bottom-3 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 shadow-2xl backdrop-blur-xl">
              <button
                onClick={() => handleDockClick("finder")}
                title="Finder"
                className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-blue-500 to-indigo-600 text-white shadow-md hover:scale-110 transition-transform"
              >
                <Folder size={20} />
              </button>
              <button
                onClick={() => handleDockClick("iterm")}
                title="iTerm"
                className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-zinc-700 to-zinc-900 text-emerald-400 shadow-md hover:scale-110 transition-transform"
              >
                <Terminal size={20} />
              </button>
              <button
                onClick={() => handleDockClick("arc")}
                title="Arc Browser"
                className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-purple-500 to-pink-600 text-white shadow-md hover:scale-110 transition-transform"
              >
                <Globe size={20} />
              </button>
              <button
                onClick={() => handleDockClick("quicktime")}
                title="QuickTime"
                className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-cyan-500 to-blue-600 text-white shadow-md hover:scale-110 transition-transform"
              >
                <Video size={20} />
              </button>
              <button
                onClick={() => handleDockClick("photobooth")}
                title="Photo Booth"
                className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-red-500 to-rose-600 text-white shadow-md hover:scale-110 transition-transform"
              >
                <Camera size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Take Review & Camera Effect Bar (When a take has been recorded) */}
        {lastTake && (
          <div className="flex h-16 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-zinc-200">Take Recorded:</span>
                <span className="text-xs text-zinc-400 font-mono">
                  {(lastTake.durationMs / 1000).toFixed(2)}s · {lastTake.pointerEvents.length} pointer events
                </span>
              </div>

              {/* Mouse-Follow Camera Toggle */}
              <button
                onClick={() => setTrackMouseEnabled(!trackMouseEnabled)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  trackMouseEnabled
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                <Sparkles size={13} />
                {trackMouseEnabled ? "Track Mouse (1.5× Follow On)" : "Enable Track Mouse (1.5×)"}
              </button>

              {/* Scrubber slider for review */}
              {trackMouseEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500 font-mono">Scrub:</span>
                  <input
                    type="range"
                    min={0}
                    max={lastTake.durationMs}
                    value={previewScrubMs}
                    onChange={(e) => setPreviewScrubMs(Number(e.target.value))}
                    className="w-48 accent-emerald-500"
                  />
                  <span className="text-[11px] text-zinc-400 font-mono">{previewScrubMs}ms</span>
                </div>
              )}
            </div>

            <div className="text-xs text-zinc-400">
              Pointer events and smoothing math computed deterministically via <span className="font-mono text-zinc-200">MouseFollowCamera</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
