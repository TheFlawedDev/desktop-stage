"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import {
  X,
  Minus,
  Square,
  Terminal,
  Folder,
  Globe,
  Video,
  Camera,
  Layers,
  Plus,
  RefreshCw,
  ArrowRight,
  Maximize2,
  Sliders,
} from "lucide-react";
import {
  StageWindowManager,
  MemoryVirtualFileSystem,
  ItermEvaluator,
  resolveRecordingRect,
  PointerLogger,
  type AppDefinition,
  APP_DEFINITIONS,
} from "@desktop-stage/desktop-engine";
import type {
  StageWindowConfig,
  StageAppKind,
  StagePointerEvent,
  StageTakeManifest,
  Rect,
} from "@cutaway/types";

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

export interface InteractiveStageHandle {
  startRecording: (mode: "full" | "selected-area", selectedCrop?: Rect) => void;
  stopRecording: () => Promise<{ blob: Blob; manifest: StageTakeManifest }>;
  isRecording: () => boolean;
}

export interface InteractiveStageProps {
  width: number;
  height: number;
  onTakeRecorded?: (videoBlob: Blob, manifest: StageTakeManifest) => void;
  onRecordingStatusChange?: (isRecording: boolean, durationMs: number) => void;
  selectedCrop?: Rect;
  onCropChange?: (crop: Rect) => void;
}

export const InteractiveStage = forwardRef<InteractiveStageHandle, InteractiveStageProps>(
  function InteractiveStage(
    {
      width,
      height,
      onTakeRecorded,
      onRecordingStatusChange,
      selectedCrop: externalCrop,
      onCropChange,
    },
    ref
  ) {
    // Engine singletons
    const [wm] = useState(() => new StageWindowManager({
      defaultRect: { x: 80, y: 80, width: 640, height: 480 },
    }));
    const [vfs] = useState(() => new MemoryVirtualFileSystem());
    const [terminal] = useState(() => new ItermEvaluator(vfs));

    // Stage DOM reference
    const stageRef = useRef<HTMLDivElement>(null);
    const canvasRecordRef = useRef<HTMLCanvasElement>(null);

    // Windows state
    const [windows, setWindows] = useState<StageWindowConfig[]>([]);
    const syncWindows = () => setWindows(wm.getWindows());

    // Window dragging & resizing
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [resizingId, setResizingId] = useState<string | null>(null);
    const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [initialRect, setInitialRect] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });

    // Terminal state
    const [terminalHistory, setTerminalHistory] = useState<Array<{ cmd: string; out: string; err?: string }>>([
      { cmd: "welcome", out: "Desktop Stage Virtual Shell (iTerm)\nType 'help' for available commands.\n" },
    ]);
    const [terminalInput, setTerminalInput] = useState("");
    const [terminalCwd, setTerminalCwd] = useState("/");

    // Finder state
    const [finderFiles, setFinderFiles] = useState<Array<{ name: string; isDir: boolean; size: number }>>([]);
    const [newFileName, setNewFileName] = useState("");

    // Arc Browser state
    const [arcUrl, setArcUrl] = useState("https://example.com");
    const [arcActiveUrl, setArcActiveUrl] = useState("https://example.com");

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordDuration, setRecordDuration] = useState(0);
    const [recordingMode, setRecordingMode] = useState<"full" | "selected-area">("full");
    const [selectedCrop, setSelectedCrop] = useState<Rect>(
      externalCrop ?? { x: 140, y: 90, width: 800, height: 500 }
    );

    const recordStartTimeRef = useRef(0);
    const pointerLoggerRef = useRef<PointerLogger | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const recordRafRef = useRef<number | null>(null);

    // Responsive scaling
    const scale = Math.max(0.1, Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT));

    // Seed VFS files on startup
    useEffect(() => {
      void (async () => {
        try {
          if (!(await vfs.exists("/welcome.txt"))) {
            await vfs.writeFile(
              "/welcome.txt",
              "Welcome to Desktop Stage!\nOpen iTerm or Finder to explore the virtual desktop.\n"
            );
          }
          if (!(await vfs.exists("/demo.js"))) {
            await vfs.writeFile("/demo.js", "console.log('Desktop Stage running on web');\n");
          }
          void refreshFinder();
        } catch {
          // ignore
        }
      })();
    }, [vfs]);

    // Initial default windows: Finder & iTerm
    useEffect(() => {
      if (wm.getWindows().length === 0) {
        wm.openApp("finder", { x: 80, y: 70, width: 480, height: 340 });
        wm.openApp("iterm", { x: 320, y: 160, width: 540, height: 350 });
        syncWindows();
      }
    }, [wm]);

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

    // Recording ticker
    useEffect(() => {
      if (!isRecording) return;
      const interval = setInterval(() => {
        const dur = Date.now() - recordStartTimeRef.current;
        setRecordDuration(dur);
        onRecordingStatusChange?.(true, dur);
      }, 100);
      return () => clearInterval(interval);
    }, [isRecording, onRecordingStatusChange]);

    // Normalize client coordinates to stage coordinates (0..1280, 0..720)
    const getStageCoords = (e: React.MouseEvent): { x: number; y: number } => {
      if (!stageRef.current) return { x: 0, y: 0 };
      const rect = stageRef.current.getBoundingClientRect();
      const stageX = Math.round((e.clientX - rect.left) / scale);
      const stageY = Math.round((e.clientY - rect.top) / scale);
      return {
        x: Math.max(0, Math.min(STAGE_WIDTH, stageX)),
        y: Math.max(0, Math.min(STAGE_HEIGHT, stageY)),
      };
    };

    // Window interaction handlers
    const handleWindowHeaderMouseDown = (e: React.MouseEvent, win: StageWindowConfig) => {
      e.stopPropagation();
      wm.focusWindow(win.id);
      syncWindows();

      setDraggingId(win.id);
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setInitialRect({ ...win.rect });
    };

    const handleResizeMouseDown = (e: React.MouseEvent, win: StageWindowConfig) => {
      e.stopPropagation();
      wm.focusWindow(win.id);
      syncWindows();

      setResizingId(win.id);
      setDragStartPos({ x: e.clientX, y: e.clientY });
      setInitialRect({ ...win.rect });
    };

    const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const coords = getStageCoords(e);

      // Handle window dragging
      if (draggingId) {
        const dx = Math.round((e.clientX - dragStartPos.x) / scale);
        const dy = Math.round((e.clientY - dragStartPos.y) / scale);
        const newX = Math.max(0, Math.min(STAGE_WIDTH - 80, initialRect.x + dx));
        const newY = Math.max(28, Math.min(STAGE_HEIGHT - 60, initialRect.y + dy));
        wm.moveWindow(draggingId, { x: newX, y: newY });
        syncWindows();
      }

      // Handle window resizing
      if (resizingId) {
        const dx = Math.round((e.clientX - dragStartPos.x) / scale);
        const dy = Math.round((e.clientY - dragStartPos.y) / scale);
        const newW = Math.max(240, Math.min(STAGE_WIDTH - initialRect.x, initialRect.width + dx));
        const newH = Math.max(160, Math.min(STAGE_HEIGHT - initialRect.y, initialRect.height + dy));
        wm.resizeWindow(resizingId, { width: newW, height: newH });
        syncWindows();
      }

      // Log pointer movement
      if (isRecording && pointerLoggerRef.current) {
        pointerLoggerRef.current.record({
          timestampMs: Date.now(),
          pos: coords,
          type: draggingId ? "drag" : "move",
        });
      }
    };

    const handleStageMouseUp = () => {
      setDraggingId(null);
      setResizingId(null);
    };

    const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (isRecording && pointerLoggerRef.current) {
        const coords = getStageCoords(e);
        pointerLoggerRef.current.record({
          timestampMs: Date.now(),
          pos: coords,
          type: "click",
        });
      }
    };

    // Dock app activation
    const handleDockClick = (kind: StageAppKind) => {
      const existing = wm.getWindows().find((w) => w.appKind === kind);
      if (existing) {
        if (existing.isMinimized) {
          wm.restoreWindow(existing.id);
        } else {
          wm.focusWindow(existing.id);
        }
      } else {
        const offset = (wm.getWindows().length % 5) * 32;
        wm.openApp(kind, { x: 120 + offset, y: 90 + offset, width: 560, height: 380 });
      }
      syncWindows();
    };

    // Terminal command execution
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

    // Finder file creation
    const handleCreateFile = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newFileName.trim()) return;
      try {
        const path = `/${newFileName.trim()}`;
        await vfs.writeFile(path, "Desktop Stage content created via Finder\n");
        setNewFileName("");
        void refreshFinder();
      } catch (err: any) {
        alert(`Error creating file: ${err?.message}`);
      }
    };

    // Canvas frame recording loop
    const startCanvasRecording = (recRect: Rect) => {
      const canvas = canvasRecordRef.current;
      if (!canvas) return;

      canvas.width = recRect.width;
      canvas.height = recRect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let running = true;
      const drawFrame = () => {
        if (!running) return;
        ctx.fillStyle = "#1e1b4b";
        ctx.fillRect(0, 0, recRect.width, recRect.height);

        // Draw basic stage representation on the recording canvas
        ctx.fillStyle = "#312e81";
        ctx.fillRect(0, 0, recRect.width, 28); // Menu bar
        ctx.fillStyle = "#e0e7ff";
        ctx.font = "12px sans-serif";
        ctx.fillText("Desktop Stage Live Recording", 16, 18);

        // Draw windows
        for (const win of wm.getWindows()) {
          if (win.isMinimized) continue;
          const rx = win.rect.x - recRect.x;
          const ry = win.rect.y - recRect.y;

          ctx.fillStyle = win.isFocused ? "#18181b" : "#27272a";
          ctx.strokeStyle = win.isFocused ? "#6366f1" : "#52525b";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(rx, ry, win.rect.width, win.rect.height, 8);
          ctx.fill();
          ctx.stroke();

          // Title bar
          ctx.fillStyle = "#3f3f46";
          ctx.fillRect(rx, ry, win.rect.width, 28);
          ctx.fillStyle = "#fafafa";
          ctx.font = "11px sans-serif";
          ctx.fillText(win.title, rx + 16, ry + 18);
        }

        recordRafRef.current = requestAnimationFrame(drawFrame);
      };

      drawFrame();

      try {
        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        recordedChunksRef.current = [];

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        recorder.start(100);
        mediaRecorderRef.current = recorder;
      } catch (err) {
        console.warn("MediaRecorder captureStream failed, using synthetic fallback:", err);
      }

      return () => {
        running = false;
        if (recordRafRef.current) cancelAnimationFrame(recordRafRef.current);
      };
    };

    // Public recording control API
    useImperativeHandle(
      ref,
      () => ({
        isRecording: () => isRecording,
        startRecording: (mode, crop) => {
          const recCrop = crop ?? selectedCrop;
          const stageRect = { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };
          const resolved = resolveRecordingRect(stageRect, {
            mode,
            selectedRect: mode === "selected-area" ? recCrop : undefined,
            recordAudio: false,
            muteWebAudio: true,
          });

          setRecordingMode(mode);
          if (crop) setSelectedCrop(crop);

          wm.setRecordingRegion(mode === "selected-area" ? resolved : null);
          syncWindows();

          const now = Date.now();
          recordStartTimeRef.current = now;
          pointerLoggerRef.current = new PointerLogger({
            recordingRect: resolved,
            startedAtMs: now,
          });

          startCanvasRecording(resolved);
          setIsRecording(true);
          setRecordDuration(0);
          onRecordingStatusChange?.(true, 0);
        },
        stopRecording: async () => {
          const durationMs = Date.now() - recordStartTimeRef.current;
          const events = pointerLoggerRef.current?.getEvents() ?? [];

          if (recordRafRef.current) {
            cancelAnimationFrame(recordRafRef.current);
            recordRafRef.current = null;
          }

          const recorder = mediaRecorderRef.current;
          let blob: Blob;

          if (recorder && recorder.state !== "inactive") {
            const stopPromise = new Promise<Blob>((resolve) => {
              recorder.onstop = () => {
                const b = new Blob(recordedChunksRef.current, { type: "video/webm" });
                resolve(b);
              };
              recorder.stop();
            });
            blob = await stopPromise;
          } else {
            blob = new Blob(["mock-stage-take-video"], { type: "video/webm" });
          }

          setIsRecording(false);
          wm.setRecordingRegion(null);
          syncWindows();
          onRecordingStatusChange?.(false, durationMs);

          const finalCrop = recordingMode === "selected-area"
            ? selectedCrop
            : { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };

          const manifest: StageTakeManifest = {
            takeId: `take-${Date.now()}`,
            videoUri: URL.createObjectURL(blob),
            durationMs,
            recordingRect: finalCrop,
            pointerEvents: events,
            trackMouseEnabled: false,
            createdAt: Date.now(),
          };

          onTakeRecorded?.(blob, manifest);
          return { blob, manifest };
        },
      }),
      [isRecording, recordingMode, selectedCrop, wm, onTakeRecorded, onRecordingStatusChange]
    );

    return (
      <div
        className="relative flex items-center justify-center overflow-hidden bg-zinc-950"
        style={{ width, height }}
      >
        {/* Hidden off-screen canvas for frame capture */}
        <canvas ref={canvasRecordRef} className="hidden" />

        {/* 1280x720 Virtual macOS Desktop Screen (Scaled) */}
        <div
          ref={stageRef}
          className="relative overflow-hidden rounded-lg shadow-2xl border border-zinc-800 select-none"
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #1e3a8a 100%)",
          }}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onClick={handleStageClick}
        >
          {/* Top macOS Menu Bar */}
          <div className="flex h-7 w-full items-center justify-between bg-black/40 px-3 text-xs text-white/90 backdrop-blur-md border-b border-white/10 z-30 relative select-none">
            <div className="flex items-center gap-4">
              <span className="font-semibold tracking-wide"></span>
              <span className="font-medium">
                {wm.getFocusedWindow()?.title ?? "Desktop Stage"}
              </span>
              <span className="text-white/60 hover:text-white cursor-pointer">File</span>
              <span className="text-white/60 hover:text-white cursor-pointer">Edit</span>
              <span className="text-white/60 hover:text-white cursor-pointer">View</span>
              <span className="text-white/60 hover:text-white cursor-pointer">Window</span>
              <span className="text-white/60 hover:text-white cursor-pointer">Help</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-white/70">
              {isRecording && (
                <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  REC {(recordDuration / 1000).toFixed(1)}s
                </span>
              )}
              <span>100%</span>
              <span>Wed 3:45 PM</span>
            </div>
          </div>

          {/* Selected-area crop frame indicator */}
          {recordingMode === "selected-area" && (
            <div
              className="pointer-events-none absolute z-20 border-2 border-dashed border-rose-500 bg-rose-500/10"
              style={{
                left: selectedCrop.x,
                top: selectedCrop.y,
                width: selectedCrop.width,
                height: selectedCrop.height,
              }}
            >
              <span className="absolute top-1 left-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-mono text-white">
                Record Region: {selectedCrop.width}×{selectedCrop.height}
              </span>
            </div>
          )}

          {/* Desktop Windows Stack */}
          {windows.map((win) => {
            if (win.isMinimized) return null;

            return (
              <div
                key={win.id}
                className={`absolute flex flex-col rounded-lg border bg-zinc-900 shadow-2xl transition-shadow ${
                  win.isFocused
                    ? "border-zinc-500/80 ring-1 ring-white/10 shadow-black/80"
                    : "border-zinc-800/80 opacity-95"
                }`}
                style={{
                  left: win.rect.x,
                  top: win.rect.y,
                  width: win.rect.width,
                  height: win.rect.height,
                  zIndex: win.zIndex,
                }}
                onMouseDown={() => {
                  wm.focusWindow(win.id);
                  syncWindows();
                }}
              >
                {/* Window Header */}
                <div
                  onMouseDown={(e) => handleWindowHeaderMouseDown(e, win)}
                  className="flex h-8 shrink-0 cursor-move items-center justify-between rounded-t-lg border-b border-zinc-800 bg-zinc-900/90 px-3 select-none"
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        wm.closeWindow(win.id);
                        syncWindows();
                      }}
                      className="flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 hover:bg-rose-600"
                    >
                      <X size={8} className="text-black/70 opacity-0 hover:opacity-100" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        wm.minimizeWindow(win.id);
                        syncWindows();
                      }}
                      className="flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600"
                    >
                      <Minus size={8} className="text-black/70 opacity-0 hover:opacity-100" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        syncWindows();
                      }}
                      className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600"
                    >
                      <Maximize2 size={8} className="text-black/70 opacity-0 hover:opacity-100" />
                    </button>
                  </div>

                  <span className="text-xs font-medium text-zinc-300">
                    {win.title}
                  </span>
                  <div className="w-10" />
                </div>

                {/* Window App Body */}
                <div
                  className="relative flex-1 overflow-hidden bg-zinc-950 p-2 text-zinc-200"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {/* iTerm Virtual Terminal */}
                  {win.appKind === "iterm" && (
                    <div className="flex h-full flex-col font-mono text-xs">
                      <div className="flex-1 overflow-auto space-y-1 p-1">
                        {terminalHistory.map((item, idx) => (
                          <div key={idx} className="space-y-0.5">
                            <div className="flex items-center gap-1.5 text-emerald-400">
                              <span className="text-zinc-500">desktop:</span>
                              <span className="text-blue-400">{terminalCwd}</span>
                              <span>$ {item.cmd}</span>
                            </div>
                            {item.out && <pre className="whitespace-pre-wrap text-zinc-300">{item.out}</pre>}
                            {item.err && <pre className="whitespace-pre-wrap text-rose-400">{item.err}</pre>}
                          </div>
                        ))}
                      </div>

                      <form onSubmit={handleTerminalSubmit} className="flex items-center gap-1 border-t border-zinc-800 pt-1">
                        <span className="text-emerald-400 font-bold">$</span>
                        <input
                          type="text"
                          value={terminalInput}
                          onChange={(e) => setTerminalInput(e.target.value)}
                          placeholder="Type bash commands (ls, cat, touch, echo...)"
                          className="flex-1 bg-transparent text-zinc-100 focus:outline-none"
                          autoFocus={win.isFocused}
                        />
                      </form>
                    </div>
                  )}

                  {/* Finder File Explorer */}
                  {win.appKind === "finder" && (
                    <div className="flex h-full flex-col text-xs">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                        <span className="font-semibold text-zinc-300">Virtual Root (/)</span>
                        <button
                          onClick={refreshFinder}
                          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                        >
                          <RefreshCw size={11} /> Refresh
                        </button>
                      </div>

                      <div className="flex-1 overflow-auto py-2">
                        {finderFiles.length === 0 ? (
                          <div className="text-zinc-500 italic">No files in virtual directory</div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {finderFiles.map((f) => (
                              <div
                                key={f.name}
                                className="flex flex-col items-center justify-center p-2 rounded-md hover:bg-zinc-800/60 cursor-pointer"
                              >
                                {f.isDir ? (
                                  <Folder size={28} className="text-blue-400" />
                                ) : (
                                  <div className="text-zinc-400 font-mono text-[10px] uppercase font-bold p-1 bg-zinc-800 rounded">
                                    DOC
                                  </div>
                                )}
                                <span className="text-[11px] text-zinc-200 truncate mt-1 w-full text-center">
                                  {f.name}
                                </span>
                                <span className="text-[9px] text-zinc-500">{f.size} B</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <form onSubmit={handleCreateFile} className="flex items-center gap-1.5 border-t border-zinc-800 pt-1.5">
                        <input
                          type="text"
                          placeholder="New file name (e.g. notes.txt)"
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                        >
                          <Plus size={11} /> Create
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Arc Webview Sandbox */}
                  {win.appKind === "arc" && (
                    <div className="flex h-full flex-col text-xs">
                      <div className="flex items-center gap-2 border-b border-zinc-800 pb-1.5">
                        <input
                          type="text"
                          value={arcUrl}
                          onChange={(e) => setArcUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setArcActiveUrl(arcUrl);
                          }}
                          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 focus:outline-none"
                        />
                        <button
                          onClick={() => setArcActiveUrl(arcUrl)}
                          className="rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700"
                        >
                          <ArrowRight size={12} />
                        </button>
                      </div>

                      <div className="relative flex-1 rounded bg-zinc-900/50 mt-2 overflow-hidden flex items-center justify-center border border-zinc-800">
                        <div className="text-center p-4">
                          <Globe size={32} className="mx-auto text-indigo-400 mb-2" />
                          <p className="font-semibold text-zinc-200">Arc Isolated Chromium View</p>
                          <p className="text-[11px] text-zinc-400 font-mono mt-1">{arcActiveUrl}</p>
                          <p className="text-[10px] text-zinc-500 mt-2 max-w-xs">
                            Sandboxed webview running with strict origin isolation & custom UA spoofing.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* QuickTime Player */}
                  {win.appKind === "quicktime" && (
                    <div className="flex h-full flex-col items-center justify-center text-center p-4">
                      <Video size={36} className="text-rose-400 mb-2" />
                      <h4 className="font-medium text-zinc-200 text-xs">QuickTime Media Player</h4>
                      <p className="text-[11px] text-zinc-400 mt-1">Audio/video playback engine with timeline routing</p>
                    </div>
                  )}

                  {/* Photo Booth */}
                  {win.appKind === "photobooth" && (
                    <div className="flex h-full flex-col items-center justify-center text-center p-4">
                      <Camera size={36} className="text-emerald-400 mb-2" />
                      <h4 className="font-medium text-zinc-200 text-xs">Photo Booth</h4>
                      <p className="text-[11px] text-zinc-400 mt-1">Simulated camera video stream</p>
                    </div>
                  )}
                </div>

                {/* Window Resize Handle */}
                <div
                  onMouseDown={(e) => handleResizeMouseDown(e, win)}
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
                />
              </div>
            );
          })}

          {/* Bottom macOS Dock */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-2xl border border-white/20 bg-black/40 px-3 py-1.5 backdrop-blur-xl shadow-2xl">
            {APP_DEFINITIONS.map((app) => {
              const isOpen = windows.some((w) => w.appKind === app.kind && !w.isMinimized);
              return (
                <button
                  key={app.kind}
                  onClick={() => handleDockClick(app.kind)}
                  className="group relative flex flex-col items-center p-1.5 transition-transform hover:-translate-y-1.5"
                  title={app.name}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-md border border-white/10 group-hover:border-white/30">
                    {app.kind === "finder" && <Folder size={20} className="text-blue-400" />}
                    {app.kind === "iterm" && <Terminal size={20} className="text-emerald-400" />}
                    {app.kind === "arc" && <Globe size={20} className="text-indigo-400" />}
                    {app.kind === "quicktime" && <Video size={20} className="text-rose-400" />}
                    {app.kind === "photobooth" && <Camera size={20} className="text-amber-400" />}
                  </div>

                  {/* Active dot indicator */}
                  {isOpen && <span className="mt-1 h-1 w-1 rounded-full bg-white/80" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);
