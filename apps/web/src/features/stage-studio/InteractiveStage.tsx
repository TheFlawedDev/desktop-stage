"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
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
  stageDiagnostics,
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

export const APPLE_SVG_PATH =
  "M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.59-7.71-11.72-14.02-6.52-10.01-11.53-20.91-15.02-32.68-3.48-11.78-5.23-23.23-5.23-34.36 0-14.35 3.59-26.41 10.77-36.19 7.18-9.78 16.32-14.77 27.42-14.99 4.9 0 10.45 1.25 16.66 3.75 6.2 2.5 10.15 3.75 11.84 3.75 1.52 0 5.66-1.3 12.41-3.9 6.75-2.61 12.33-3.8 16.74-3.59 12.51.65 22.38 5.43 29.6 14.34-10.87 6.64-16.19 15.67-15.97 27.1.22 9.03 3.69 16.65 10.42 22.85 6.74 6.21 14.78 9.79 24.13 10.77-2.17 6.52-4.78 13.06-7.83 19.62zM119.22 33.15c0-7.39 2.66-14.41 7.99-21.05 5.33-6.64 11.97-10.97 19.92-13 1.09 7.07-.98 14.03-6.2 20.89-5.22 6.85-11.89 11.24-20.02 13.16-.22-.65-.34-1.3-.34-1.96z";

export function AppleLogo({
  className = "w-3 h-3 fill-current",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 170 170"
      fill="currentColor"
      aria-label="Apple"
    >
      <path d={APPLE_SVG_PATH} />
    </svg>
  );
}

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
  recordingMode?: "full" | "selected-area";
  onRecordingModeChange?: (mode: "full" | "selected-area") => void;
}

export const InteractiveStage = forwardRef<
  InteractiveStageHandle,
  InteractiveStageProps
>(function InteractiveStage(
  {
    width,
    height,
    onTakeRecorded,
    onRecordingStatusChange,
    selectedCrop: externalCrop,
    onCropChange,
    recordingMode: propRecordingMode,
    onRecordingModeChange,
  },
  ref,
) {
  // Engine singletons
  const [wm] = useState(
    () =>
      new StageWindowManager({
        defaultRect: { x: 80, y: 80, width: 640, height: 480 },
      }),
  );
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
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [initialRect, setInitialRect] = useState<Rect>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Terminal state
  const [terminalHistory, setTerminalHistory] = useState<
    Array<{ cmd: string; out: string; err?: string }>
  >([
    {
      cmd: "welcome",
      out: "Desktop Stage Virtual Shell (iTerm)\nType 'help' for available commands.\n",
    },
  ]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalCwd, setTerminalCwd] = useState("/");

  // Finder state
  const [finderFiles, setFinderFiles] = useState<
    Array<{ name: string; isDir: boolean; size: number }>
  >([]);
  const [newFileName, setNewFileName] = useState("");

  // Arc Browser state
  const [arcUrl, setArcUrl] = useState("https://example.com");
  const [arcActiveUrl, setArcActiveUrl] = useState("https://example.com");

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [internalRecordingMode, setInternalRecordingMode] = useState<
    "full" | "selected-area"
  >("full");
  const activeRecordingMode = propRecordingMode ?? internalRecordingMode;
  const [selectedCrop, setSelectedCrop] = useState<Rect>(
    externalCrop ?? { x: 140, y: 90, width: 800, height: 500 },
  );

  // Keep externalCrop in sync
  useEffect(() => {
    if (externalCrop) {
      setSelectedCrop(externalCrop);
    }
  }, [externalCrop]);

  // Crop dragging and 8-point resize state
  type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";
  const [cropDragMode, setCropDragMode] = useState<CropHandle | null>(null);
  const [cropDragStartPos, setCropDragStartPos] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const [initialCropRect, setInitialCropRect] = useState<Rect>({
    x: 140,
    y: 90,
    width: 800,
    height: 500,
  });

  const recordStartTimeRef = useRef(0);
  const pointerLoggerRef = useRef<PointerLogger | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordRafRef = useRef<number | null>(null);

  // Live state tracking for canvas recorder
  const lastPointerPosRef = useRef<{ x: number; y: number }>({
    x: 640,
    y: 360,
  });
  const pointerDownRef = useRef(false);
  const terminalHistoryRef = useRef(terminalHistory);
  terminalHistoryRef.current = terminalHistory;
  const terminalInputRef = useRef(terminalInput);
  terminalInputRef.current = terminalInput;
  const finderFilesRef = useRef(finderFiles);
  finderFilesRef.current = finderFiles;
  const arcActiveUrlRef = useRef(arcActiveUrl);
  arcActiveUrlRef.current = arcActiveUrl;

  // Responsive scaling
  const scale = Math.max(
    0.1,
    Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT),
  );

  // Seed VFS files on startup
  useEffect(() => {
    void (async () => {
      try {
        if (!(await vfs.exists("/welcome.txt"))) {
          await vfs.writeFile(
            "/welcome.txt",
            "Welcome to Desktop Stage!\nOpen iTerm or Finder to explore the virtual desktop.\n",
          );
        }
        if (!(await vfs.exists("/demo.js"))) {
          await vfs.writeFile(
            "/demo.js",
            "console.log('Desktop Stage running on web');\n",
          );
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
        })),
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
  const handleWindowHeaderMouseDown = (
    e: React.MouseEvent,
    win: StageWindowConfig,
  ) => {
    e.stopPropagation();
    wm.focusWindow(win.id);
    syncWindows();

    setDraggingId(win.id);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setInitialRect({ ...win.rect });
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    win: StageWindowConfig,
  ) => {
    e.stopPropagation();
    wm.focusWindow(win.id);
    syncWindows();

    setResizingId(win.id);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    setInitialRect({ ...win.rect });
  };

  const handleCropMouseDown = (e: React.MouseEvent, handle: CropHandle) => {
    e.stopPropagation();
    e.preventDefault();
    setCropDragMode(handle);
    setCropDragStartPos({ x: e.clientX, y: e.clientY });
    setInitialCropRect({ ...selectedCrop });
    stageDiagnostics.log(
      "UI",
      `Started crop ${handle} drag at (${e.clientX}, ${e.clientY})`,
    );
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getStageCoords(e);
    lastPointerPosRef.current = coords;

    // Handle crop frame dragging & 8-point resizing
    if (cropDragMode) {
      const dx = Math.round((e.clientX - cropDragStartPos.x) / scale);
      const dy = Math.round((e.clientY - cropDragStartPos.y) / scale);
      let { x, y, width: w, height: h } = initialCropRect;

      if (cropDragMode === "move") {
        x = Math.max(0, Math.min(STAGE_WIDTH - w, x + dx));
        y = Math.max(28, Math.min(STAGE_HEIGHT - h, y + dy));
      } else {
        if (cropDragMode.includes("e")) {
          w = Math.max(
            160,
            Math.min(STAGE_WIDTH - x, initialCropRect.width + dx),
          );
        }
        if (cropDragMode.includes("s")) {
          h = Math.max(
            120,
            Math.min(STAGE_HEIGHT - y, initialCropRect.height + dy),
          );
        }
        if (cropDragMode.includes("w")) {
          const maxDx = initialCropRect.width - 160;
          const actualDx = Math.max(-initialCropRect.x, Math.min(maxDx, dx));
          x = initialCropRect.x + actualDx;
          w = initialCropRect.width - actualDx;
        }
        if (cropDragMode.includes("n")) {
          const maxDy = initialCropRect.height - 120;
          const actualDy = Math.max(
            28 - initialCropRect.y,
            Math.min(maxDy, dy),
          );
          y = initialCropRect.y + actualDy;
          h = initialCropRect.height - actualDy;
        }
      }

      const updatedCrop: Rect = { x, y, width: w, height: h };
      setSelectedCrop(updatedCrop);
      onCropChange?.(updatedCrop);
      return;
    }

    // Handle window dragging
    if (draggingId) {
      const dx = Math.round((e.clientX - dragStartPos.x) / scale);
      const dy = Math.round((e.clientY - dragStartPos.y) / scale);
      const newX = Math.max(0, Math.min(STAGE_WIDTH - 80, initialRect.x + dx));
      const newY = Math.max(
        28,
        Math.min(STAGE_HEIGHT - 60, initialRect.y + dy),
      );
      wm.moveWindow(draggingId, { x: newX, y: newY });
      syncWindows();
    }

    // Handle window resizing
    if (resizingId) {
      const dx = Math.round((e.clientX - dragStartPos.x) / scale);
      const dy = Math.round((e.clientY - dragStartPos.y) / scale);
      const newW = Math.max(
        240,
        Math.min(STAGE_WIDTH - initialRect.x, initialRect.width + dx),
      );
      const newH = Math.max(
        160,
        Math.min(STAGE_HEIGHT - initialRect.y, initialRect.height + dy),
      );
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

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    pointerDownRef.current = true;
    const coords = getStageCoords(e);
    lastPointerPosRef.current = coords;
  };

  const handleStageMouseUp = () => {
    pointerDownRef.current = false;
    if (cropDragMode) {
      stageDiagnostics.log(
        "UI",
        `Finished crop adjustment: ${selectedCrop.width}x${selectedCrop.height} at (${selectedCrop.x}, ${selectedCrop.y})`,
      );
      setCropDragMode(null);
    }
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
      wm.openApp(kind, {
        x: 120 + offset,
        y: 90 + offset,
        width: 560,
        height: 380,
      });
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

  // Canvas frame recording loop with 2x supersampling and visual parity
  const startCanvasRecording = (recRect: Rect) => {
    const canvas = canvasRecordRef.current;
    if (!canvas) return;

    const DPR = 2; // 2x supersampling for high-DPI crisp text and vector rendering
    canvas.width = recRect.width * DPR;
    canvas.height = recRect.height * DPR;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const applePath = new Path2D(APPLE_SVG_PATH);
    let running = true;
    let frameCount = 0;
    const fpsTimerStart = Date.now();

    const drawFrame = () => {
      if (!running) return;
      frameCount++;

      ctx.save();
      ctx.scale(DPR, DPR);

      // 1. Desktop Wallpaper Background - aligned to global stage coordinates
      const bgGrad = ctx.createLinearGradient(
        -recRect.x,
        -recRect.y,
        STAGE_WIDTH - recRect.x,
        STAGE_HEIGHT - recRect.y,
      );
      bgGrad.addColorStop(0, "#1e1b4b");
      bgGrad.addColorStop(0.4, "#312e81");
      bgGrad.addColorStop(1, "#1e3a8a");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, recRect.width, recRect.height);

      // Ambient desktop nebula glow - aligned to global stage coordinates
      const orbGrad = ctx.createRadialGradient(
        STAGE_WIDTH * 0.7 - recRect.x,
        STAGE_HEIGHT * 0.3 - recRect.y,
        20,
        STAGE_WIDTH * 0.7 - recRect.x,
        STAGE_HEIGHT * 0.3 - recRect.y,
        Math.max(200, STAGE_WIDTH * 0.5),
      );
      orbGrad.addColorStop(0, "rgba(99, 102, 241, 0.25)");
      orbGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = orbGrad;
      ctx.fillRect(0, 0, recRect.width, recRect.height);

      // 2. macOS Top Menu Bar (if visible in crop region)
      const menuBarH = 28;
      const mbY = -recRect.y;
      if (mbY + menuBarH > 0 && mbY < recRect.height) {
        ctx.fillStyle = "rgba(18, 18, 24, 0.88)";
        ctx.fillRect(0, Math.max(0, mbY), recRect.width, menuBarH);
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(0, mbY + menuBarH - 1, recRect.width, 1);

        // Vector Apple logo (zero tofu on Windows)
        ctx.save();
        ctx.translate(14 - recRect.x, mbY + 7);
        ctx.scale(0.08, 0.08);
        ctx.fillStyle = "#ffffff";
        ctx.fill(applePath);
        ctx.restore();

        const focusedWin = wm.getFocusedWindow();
        const appName = focusedWin?.title ?? "Desktop Stage";
        ctx.fillStyle = "#ffffff";
        ctx.font =
          "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(appName, 36 - recRect.x, mbY + 18);

        ctx.font =
          "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillStyle = "#d4d4d8";
        let mx = 105 - recRect.x;
        for (const item of ["File", "Edit", "View", "Window", "Help"]) {
          ctx.fillText(item, mx, mbY + 18);
          mx += ctx.measureText(item).width + 16;
        }

        // Status & Clock (matching DOM: 100% Wed 3:45 PM)
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font =
          "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("100%   Wed 3:45 PM", recRect.width - 16, mbY + 18);
        ctx.textAlign = "left";
      }

      // 3. Open Windows (sorted by z-index back-to-front)
      const sortedWindows = [...wm.getWindows()].sort(
        (a, b) => a.zIndex - b.zIndex,
      );
      for (const win of sortedWindows) {
        if (win.isMinimized) continue;
        const rx = win.rect.x - recRect.x;
        const ry = win.rect.y - recRect.y;
        const rw = win.rect.width;
        const rh = win.rect.height;

        // Skip completely off-screen windows in selected-area mode
        if (
          rx + rw <= 0 ||
          ry + rh <= 0 ||
          rx >= recRect.width ||
          ry >= recRect.height
        )
          continue;

        // Window drop shadow
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
        ctx.shadowBlur = win.isFocused ? 26 : 14;
        ctx.shadowOffsetY = 10;
        ctx.fillStyle = win.appKind === "iterm" ? "#09090b" : "#18181b";
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 10);
        ctx.fill();
        ctx.restore();

        // Window border
        ctx.strokeStyle = win.isFocused
          ? "rgba(99, 102, 241, 0.45)"
          : "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 10);
        ctx.stroke();

        // Clip content inside rounded window rect
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 10);
        ctx.clip();

        // Title bar
        const tbH = 28;
        ctx.fillStyle = win.isFocused ? "#1f1f23" : "#141416";
        ctx.fillRect(rx, ry, rw, tbH);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.moveTo(rx, ry + tbH);
        ctx.lineTo(rx + rw, ry + tbH);
        ctx.stroke();

        // Traffic lights
        ctx.fillStyle = "#ff5f56";
        ctx.beginPath();
        ctx.arc(rx + 16, ry + 14, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffbd2e";
        ctx.beginPath();
        ctx.arc(rx + 32, ry + 14, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#27c93f";
        ctx.beginPath();
        ctx.arc(rx + 48, ry + 14, 5, 0, Math.PI * 2);
        ctx.fill();

        // Title text
        ctx.fillStyle = win.isFocused ? "#f4f4f5" : "#a1a1aa";
        ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(win.title, rx + rw / 2, ry + 18);
        ctx.textAlign = "left";

        // Content Area
        const cy = ry + tbH;
        const ch = rh - tbH;

        if (win.appKind === "iterm") {
          ctx.fillStyle = "#09090b";
          ctx.fillRect(rx, cy, rw, ch);

          ctx.font =
            "11px 'JetBrains Mono', 'Fira Code', 'Courier New', monospace";
          let ty = cy + 18;
          const history = terminalHistoryRef.current;
          const recent = history.slice(-8);
          for (const item of recent) {
            if (ty > ry + rh - 30) break;
            ctx.fillStyle = "#71717a";
            ctx.fillText("desktop:", rx + 14, ty);
            const dW = ctx.measureText("desktop:").width;
            ctx.fillStyle = "#60a5fa";
            ctx.fillText("/ ", rx + 14 + dW + 4, ty);
            const cW = ctx.measureText("/ ").width;
            ctx.fillStyle = "#34d399";
            ctx.fillText(`$ ${item.cmd}`, rx + 14 + dW + 4 + cW, ty);
            ty += 16;

            if (item.out) {
              ctx.fillStyle = "#d4d4d8";
              const lines = item.out.split("\n").filter(Boolean);
              for (const l of lines.slice(0, 3)) {
                if (ty > ry + rh - 30) break;
                ctx.fillText(l, rx + 14, ty);
                ty += 15;
              }
            }
            if (item.err) {
              ctx.fillStyle = "#f87171";
              ctx.fillText(item.err, rx + 14, ty);
              ty += 15;
            }
          }

          // Bottom command prompt bar matching DOM
          ctx.fillStyle = "#18181b";
          ctx.fillRect(rx, ry + rh - 26, rw, 26);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.moveTo(rx, ry + rh - 26);
          ctx.lineTo(rx + rw, ry + rh - 26);
          ctx.stroke();

          ctx.fillStyle = "#34d399";
          ctx.font = "bold 12px monospace";
          ctx.fillText("$", rx + 12, ry + rh - 9);

          const inputTxt = terminalInputRef.current;
          if (inputTxt) {
            ctx.fillStyle = "#f4f4f5";
            ctx.font = "11px monospace";
            ctx.fillText(inputTxt, rx + 24, ry + rh - 9);
            const curX = rx + 24 + ctx.measureText(inputTxt).width;
            ctx.fillStyle = "#34d399";
            ctx.fillRect(curX + 2, ry + rh - 20, 6, 13);
          } else {
            ctx.fillStyle = "#52525b";
            ctx.font = "11px monospace";
            ctx.fillText(
              "Type bash commands (ls, cat, touch, echo...)",
              rx + 24,
              ry + rh - 9,
            );
          }
        } else if (win.appKind === "finder") {
          ctx.fillStyle = "#121214";
          ctx.fillRect(rx, cy, rw, ch);

          // Header bar
          const fhH = 28;
          ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
          ctx.fillRect(rx, cy, rw, fhH);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.moveTo(rx, cy + fhH);
          ctx.lineTo(rx + rw, cy + fhH);
          ctx.stroke();

          ctx.fillStyle = "#e4e4e7";
          ctx.font = "bold 11px -apple-system, sans-serif";
          ctx.fillText("Virtual Root (/)", rx + 12, cy + 18);

          ctx.fillStyle = "#a1a1aa";
          ctx.font = "10px -apple-system, sans-serif";
          ctx.textAlign = "right";
          ctx.fillText("⟳ Refresh", rx + rw - 12, cy + 18);
          ctx.textAlign = "left";

          // File items grid
          const files = finderFilesRef.current;
          const itemStartX = rx + 16;
          const itemStartY = cy + fhH + 12;
          for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            const col = i % 4;
            const row = Math.floor(i / 4);
            const fx = itemStartX + col * 90;
            const fy = itemStartY + row * 75;
            if (fy + 60 > ry + rh - 30) break;

            // DOC badge icon
            ctx.fillStyle = "#27272a";
            ctx.beginPath();
            ctx.roundRect(fx + 14, fy, 28, 28, 4);
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
            ctx.stroke();

            ctx.fillStyle = "#a1a1aa";
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            ctx.fillText(file.isDir ? "DIR" : "DOC", fx + 28, fy + 18);

            // File name & size
            ctx.fillStyle = "#f4f4f5";
            ctx.font = "10px -apple-system, sans-serif";
            ctx.fillText(file.name.slice(0, 12), fx + 28, fy + 42);
            ctx.fillStyle = "#71717a";
            ctx.font = "9px -apple-system, sans-serif";
            ctx.fillText(`${file.size || 45} B`, fx + 28, fy + 54);
            ctx.textAlign = "left";
          }

          // Bottom create bar
          const fbH = 26;
          const fby = ry + rh - fbH;
          ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
          ctx.fillRect(rx, fby, rw, fbH);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.moveTo(rx, fby);
          ctx.lineTo(rx + rw, fby);
          ctx.stroke();

          ctx.fillStyle = "#27272a";
          ctx.fillRect(rx + 8, fby + 3, rw - 80, 20);
          ctx.fillStyle = "#71717a";
          ctx.font = "10px -apple-system, sans-serif";
          ctx.fillText("New file name (e.g. notes.txt)", rx + 14, fby + 16);

          ctx.fillStyle = "#3f3f46";
          ctx.beginPath();
          ctx.roundRect(rx + rw - 68, fby + 3, 60, 20, 3);
          ctx.fill();
          ctx.fillStyle = "#e4e4e7";
          ctx.font = "bold 10px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("+ Create", rx + rw - 38, fby + 16);
          ctx.textAlign = "left";
        } else if (win.appKind === "arc") {
          ctx.fillStyle = "#18181b";
          ctx.fillRect(rx, cy, rw, ch);
          ctx.fillStyle = "#27272a";
          ctx.beginPath();
          ctx.roundRect(rx + 12, cy + 8, rw - 24, 26, 6);
          ctx.fill();
          ctx.fillStyle = "#a1a1aa";
          ctx.font = "11px sans-serif";
          ctx.fillText(
            "🔒 " + (arcActiveUrlRef.current || "https://example.com"),
            rx + 24,
            cy + 25,
          );

          ctx.fillStyle = "#0f172a";
          ctx.fillRect(rx + 12, cy + 42, rw - 24, ch - 54);
          ctx.fillStyle = "#818cf8";
          ctx.font = "bold 14px sans-serif";
          ctx.fillText("Arc Sandboxed Browser", rx + 28, cy + 72);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "11px sans-serif";
          ctx.fillText(
            "Chromium context isolation • Audio muted during recording",
            rx + 28,
            cy + 94,
          );
        } else if (win.appKind === "quicktime") {
          ctx.fillStyle = "#0c0a09";
          ctx.fillRect(rx, cy, rw, ch);
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.arc(rx + rw / 2, cy + ch / 2 - 10, 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#0f172a";
          ctx.beginPath();
          ctx.moveTo(rx + rw / 2 - 6, cy + ch / 2 - 18);
          ctx.lineTo(rx + rw / 2 + 10, cy + ch / 2 - 10);
          ctx.lineTo(rx + rw / 2 - 6, cy + ch / 2 - 2);
          ctx.fill();
          ctx.fillStyle = "#a1a1aa";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            "QuickTime Player • 00:01:23 / 00:04:30",
            rx + rw / 2,
            cy + ch / 2 + 30,
          );
          ctx.textAlign = "left";
        } else if (win.appKind === "photobooth") {
          ctx.fillStyle = "#1c1917";
          ctx.fillRect(rx, cy, rw, ch);
          ctx.fillStyle = "#f43f5e";
          ctx.beginPath();
          ctx.arc(rx + rw / 2, cy + ch / 2 - 10, 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#a1a1aa";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            "Photo Booth • Live Preview",
            rx + rw / 2,
            cy + ch / 2 + 30,
          );
          ctx.textAlign = "left";
        }

        ctx.restore(); // end clip
      }

      // 4. macOS Dock (if visible in recRect)
      const dockW = 260;
      const dockH = 50;
      const dockX = (STAGE_WIDTH - dockW) / 2 - recRect.x;
      const dockY = STAGE_HEIGHT - dockH - 12 - recRect.y;

      if (
        dockY < recRect.height &&
        dockX + dockW > 0 &&
        dockX < recRect.width
      ) {
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        ctx.roundRect(dockX, dockY, dockW, dockH, 16);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(dockX, dockY, dockW, dockH, 16);
        ctx.stroke();

        const dockApps = [
          { kind: "finder", color: "#3b82f6", label: "Finder" },
          { kind: "iterm", color: "#18181b", label: "iTerm" },
          { kind: "arc", color: "#a855f7", label: "Arc" },
          { kind: "quicktime", color: "#06b6d4", label: "QuickTime" },
          { kind: "photobooth", color: "#f59e0b", label: "Photo Booth" },
        ];

        const iconSize = 34;
        const gap = 12;
        const startX =
          dockX +
          (dockW - (dockApps.length * iconSize + (dockApps.length - 1) * gap)) /
            2;
        const iconY = dockY + (dockH - iconSize) / 2;

        for (let i = 0; i < dockApps.length; i++) {
          const da = dockApps[i]!;
          const ix = startX + i * (iconSize + gap);
          ctx.fillStyle = da.color;
          ctx.beginPath();
          ctx.roundRect(ix, iconY, iconSize, iconSize, 8);
          ctx.fill();

          // Crisp vector dock icons (zero emojis)
          if (da.kind === "finder") {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.75;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            const fx = ix + 9;
            const fy = iconY + 9;
            ctx.beginPath();
            ctx.moveTo(fx + 2, fy);
            ctx.lineTo(fx + 6, fy);
            ctx.lineTo(fx + 8, fy + 3);
            ctx.lineTo(fx + 14, fy + 3);
            ctx.lineTo(fx + 16, fy + 5);
            ctx.lineTo(fx + 16, fy + 14);
            ctx.lineTo(fx, fy + 14);
            ctx.lineTo(fx, fy + 2);
            ctx.closePath();
            ctx.stroke();
          } else if (da.kind === "iterm") {
            ctx.fillStyle = "#34d399";
            ctx.font = "bold 13px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(">_", ix + iconSize / 2, iconY + 22);
            ctx.textAlign = "left";
          } else if (da.kind === "arc") {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            const cx = ix + iconSize / 2;
            const cy = iconY + iconSize / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(cx, cy, 3.5, 8, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 8, cy);
            ctx.lineTo(cx + 8, cy);
            ctx.stroke();
          } else if (da.kind === "quicktime") {
            ctx.fillStyle = "#ffffff";
            const qx = ix + iconSize / 2;
            const qy = iconY + iconSize / 2;
            ctx.beginPath();
            ctx.moveTo(qx - 4, qy - 6);
            ctx.lineTo(qx + 6, qy);
            ctx.lineTo(qx - 4, qy + 6);
            ctx.closePath();
            ctx.fill();
          } else if (da.kind === "photobooth") {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            const px = ix + 8;
            const py = iconY + 9;
            ctx.beginPath();
            ctx.roundRect(px, py + 3, 18, 12, 3);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px + 9, py + 9, 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(px + 4, py + 1.5, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }

          const isRunning = wm.getWindows().some((w) => w.appKind === da.kind);
          if (isRunning) {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(ix + iconSize / 2, dockY + dockH - 4, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 5. Mouse Pointer Cursor
      const pointer = lastPointerPosRef.current;
      const cx = pointer.x - recRect.x;
      const cy = pointer.y - recRect.y;

      if (
        cx >= -20 &&
        cx <= recRect.width + 20 &&
        cy >= -20 &&
        cy <= recRect.height + 20
      ) {
        ctx.save();

        // Click ripple
        if (pointerDownRef.current) {
          ctx.fillStyle = "rgba(99, 102, 241, 0.4)";
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        // Cursor arrow
        ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 2;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + 18);
        ctx.lineTo(cx + 4.8, cy + 13.8);
        ctx.lineTo(cx + 8.2, cy + 20.8);
        ctx.lineTo(cx + 10.6, cy + 19.6);
        ctx.lineTo(cx + 7.2, cy + 12.8);
        ctx.lineTo(cx + 13, cy + 12.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      }

      ctx.restore(); // End 2x supersampling scale

      // Update live metrics
      const elapsedSec = (Date.now() - fpsTimerStart) / 1000;
      if (elapsedSec > 0.5) {
        stageDiagnostics.updateMetrics({
          fps: Math.round(frameCount / elapsedSec),
          activeWindowsCount: wm.getWindows().length,
        });
      }

      recordRafRef.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    try {
      const stream = canvas.captureStream(60);
      const candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
      const mimeType =
        candidates.find(
          (m) =>
            typeof MediaRecorder !== "undefined" &&
            MediaRecorder.isTypeSupported(m),
        ) || "video/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 28_000_000, // 28 Mbps ultra-crisp 4K/retina recording for sharp text & vectors
      });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          stageDiagnostics.updateMetrics({
            totalChunks: recordedChunksRef.current.length,
          });
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;

      stageDiagnostics.log(
        "RECORDER",
        `MediaRecorder started: 60 FPS, 28 Mbps (${mimeType}) on ${recRect.width}x${recRect.height} (2x canvas ${canvas.width}x${canvas.height})`,
      );
      stageDiagnostics.updateMetrics({
        bitrateMbps: 28,
        encoderMime: mimeType,
        totalChunks: 0,
      });
    } catch (err) {
      stageDiagnostics.log(
        "RECORDER",
        `MediaRecorder init failed: ${String(err)}`,
      );
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
        const targetMode = mode ?? activeRecordingMode;
        const recCrop = crop ?? selectedCrop;
        const stageRect = {
          x: 0,
          y: 0,
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
        };
        const resolved = resolveRecordingRect(stageRect, {
          mode: targetMode,
          selectedRect: targetMode === "selected-area" ? recCrop : undefined,
          recordAudio: false,
          muteWebAudio: true,
        });

        setInternalRecordingMode(targetMode);
        onRecordingModeChange?.(targetMode);
        if (crop) setSelectedCrop(crop);

        wm.setRecordingRegion(targetMode === "selected-area" ? resolved : null);
        syncWindows();

        const now = Date.now();
        recordStartTimeRef.current = now;
        pointerLoggerRef.current = new PointerLogger({
          recordingRect: resolved,
          startedAtMs: now,
        });
        lastPointerPosRef.current = {
          x: resolved.x + Math.round(resolved.width / 2),
          y: resolved.y + Math.round(resolved.height / 2),
        };

        startCanvasRecording(resolved);
        setIsRecording(true);
        setRecordDuration(0);
        onRecordingStatusChange?.(true, 0);

        stageDiagnostics.log(
          "RECORDER",
          `Started recording in mode ${targetMode} at rect [x:${resolved.x}, y:${resolved.y}, ${resolved.width}x${resolved.height}]`,
        );
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
              const b = new Blob(recordedChunksRef.current, {
                type: "video/webm",
              });
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

        const finalCrop =
          activeRecordingMode === "selected-area"
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

        stageDiagnostics.log(
          "RECORDER",
          `Stopped recording: ${durationMs}ms duration, ${events.length} pointer events recorded, blob size: ${blob.size} bytes`,
        );

        onTakeRecorded?.(blob, manifest);
        return { blob, manifest };
      },
    }),
    [
      isRecording,
      activeRecordingMode,
      selectedCrop,
      wm,
      onTakeRecorded,
      onRecordingStatusChange,
      onRecordingModeChange,
    ],
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
          background:
            "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #1e3a8a 100%)",
        }}
        onMouseMove={handleStageMouseMove}
        onMouseDown={handleStageMouseDown}
        onMouseUp={handleStageMouseUp}
        onClick={handleStageClick}
      >
        {/* Top macOS Menu Bar */}
        <div className="flex h-7 w-full items-center justify-between bg-black/40 px-3 text-xs text-white/90 backdrop-blur-md border-b border-white/10 z-30 relative select-none">
          <div className="flex items-center gap-3.5">
            <AppleLogo className="w-3.5 h-3.5 text-white/90" />
            <span className="font-medium">
              {wm.getFocusedWindow()?.title ?? "Desktop Stage"}
            </span>
            <span className="text-white/60 hover:text-white cursor-pointer">
              File
            </span>
            <span className="text-white/60 hover:text-white cursor-pointer">
              Edit
            </span>
            <span className="text-white/60 hover:text-white cursor-pointer">
              View
            </span>
            <span className="text-white/60 hover:text-white cursor-pointer">
              Window
            </span>
            <span className="text-white/60 hover:text-white cursor-pointer">
              Help
            </span>
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

        {/* Interactive Selected-Area Crop Frame with Draggable Box & 8 Resize Handles */}
        {activeRecordingMode === "selected-area" && (
          <div
            className={`absolute z-20 border-2 border-dashed border-rose-500 bg-rose-500/10 select-none ${
              !isRecording ? "cursor-move" : "pointer-events-none"
            }`}
            style={{
              left: selectedCrop.x,
              top: selectedCrop.y,
              width: selectedCrop.width,
              height: selectedCrop.height,
            }}
            onMouseDown={(e) => !isRecording && handleCropMouseDown(e, "move")}
          >
            {/* Dimensions & Position Badge */}
            <div className="absolute -top-7 left-0 flex items-center gap-1.5 rounded bg-rose-600 px-2 py-0.5 text-[10px] font-mono font-medium text-white shadow-md pointer-events-none">
              <span>
                Crop: {selectedCrop.width}×{selectedCrop.height}
              </span>
              <span className="opacity-75">
                ({selectedCrop.x}, {selectedCrop.y})
              </span>
              {!isRecording && (
                <span className="text-[9px] opacity-90 pl-1">
                  Drag to move · Handles to resize
                </span>
              )}
            </div>

            {/* 8 Resize Handles */}
            {!isRecording && (
              <>
                {/* Top-Left */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "nw")}
                  className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-nwse-resize hover:scale-125 transition-transform"
                  title="Resize Top-Left"
                />
                {/* Top-Center */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "n")}
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-ns-resize hover:scale-125 transition-transform"
                  title="Resize Top"
                />
                {/* Top-Right */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "ne")}
                  className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-nesw-resize hover:scale-125 transition-transform"
                  title="Resize Top-Right"
                />
                {/* Mid-Right */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "e")}
                  className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-ew-resize hover:scale-125 transition-transform"
                  title="Resize Right"
                />
                {/* Bottom-Right */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "se")}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-nwse-resize hover:scale-125 transition-transform"
                  title="Resize Bottom-Right"
                />
                {/* Bottom-Center */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "s")}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-ns-resize hover:scale-125 transition-transform"
                  title="Resize Bottom"
                />
                {/* Bottom-Left */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "sw")}
                  className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-nesw-resize hover:scale-125 transition-transform"
                  title="Resize Bottom-Left"
                />
                {/* Mid-Left */}
                <div
                  onMouseDown={(e) => handleCropMouseDown(e, "w")}
                  className="absolute top-1/2 -left-1.5 -translate-y-1/2 h-3 w-3 rounded-xs border-2 border-rose-600 bg-white shadow cursor-ew-resize hover:scale-125 transition-transform"
                  title="Resize Left"
                />
              </>
            )}
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
                    <X
                      size={8}
                      className="text-black/70 opacity-0 hover:opacity-100"
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      wm.minimizeWindow(win.id);
                      syncWindows();
                    }}
                    className="flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600"
                  >
                    <Minus
                      size={8}
                      className="text-black/70 opacity-0 hover:opacity-100"
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      syncWindows();
                    }}
                    className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600"
                  >
                    <Maximize2
                      size={8}
                      className="text-black/70 opacity-0 hover:opacity-100"
                    />
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
                          {item.out && (
                            <pre className="whitespace-pre-wrap text-zinc-300">
                              {item.out}
                            </pre>
                          )}
                          {item.err && (
                            <pre className="whitespace-pre-wrap text-rose-400">
                              {item.err}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={handleTerminalSubmit}
                      className="flex items-center gap-1 border-t border-zinc-800 pt-1"
                    >
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
                      <span className="font-semibold text-zinc-300">
                        Virtual Root (/)
                      </span>
                      <button
                        onClick={refreshFinder}
                        className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                      >
                        <RefreshCw size={11} /> Refresh
                      </button>
                    </div>

                    <div className="flex-1 overflow-auto py-2">
                      {finderFiles.length === 0 ? (
                        <div className="text-zinc-500 italic">
                          No files in virtual directory
                        </div>
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
                              <span className="text-[9px] text-zinc-500">
                                {f.size} B
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <form
                      onSubmit={handleCreateFile}
                      className="flex items-center gap-1.5 border-t border-zinc-800 pt-1.5"
                    >
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
                        <Globe
                          size={32}
                          className="mx-auto text-indigo-400 mb-2"
                        />
                        <p className="font-semibold text-zinc-200">
                          Arc Isolated Chromium View
                        </p>
                        <p className="text-[11px] text-zinc-400 font-mono mt-1">
                          {arcActiveUrl}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-2 max-w-xs">
                          Sandboxed webview running with strict origin isolation
                          & custom UA spoofing.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* QuickTime Player */}
                {win.appKind === "quicktime" && (
                  <div className="flex h-full flex-col items-center justify-center text-center p-4">
                    <Video size={36} className="text-rose-400 mb-2" />
                    <h4 className="font-medium text-zinc-200 text-xs">
                      QuickTime Media Player
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Audio/video playback engine with timeline routing
                    </p>
                  </div>
                )}

                {/* Photo Booth */}
                {win.appKind === "photobooth" && (
                  <div className="flex h-full flex-col items-center justify-center text-center p-4">
                    <Camera size={36} className="text-emerald-400 mb-2" />
                    <h4 className="font-medium text-zinc-200 text-xs">
                      Photo Booth
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Simulated camera video stream
                    </p>
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
            const isOpen = windows.some(
              (w) => w.appKind === app.kind && !w.isMinimized,
            );
            return (
              <button
                key={app.kind}
                onClick={() => handleDockClick(app.kind)}
                className="group relative flex flex-col items-center p-1.5 transition-transform hover:-translate-y-1.5"
                title={app.name}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-md border border-white/10 group-hover:border-white/30">
                  {app.kind === "finder" && (
                    <Folder size={20} className="text-blue-400" />
                  )}
                  {app.kind === "iterm" && (
                    <Terminal size={20} className="text-emerald-400" />
                  )}
                  {app.kind === "arc" && (
                    <Globe size={20} className="text-indigo-400" />
                  )}
                  {app.kind === "quicktime" && (
                    <Video size={20} className="text-rose-400" />
                  )}
                  {app.kind === "photobooth" && (
                    <Camera size={20} className="text-amber-400" />
                  )}
                </div>

                {/* Active dot indicator */}
                {isOpen && (
                  <span className="mt-1 h-1 w-1 rounded-full bg-white/80" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
