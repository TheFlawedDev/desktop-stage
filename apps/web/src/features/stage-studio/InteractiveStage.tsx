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
  Play,
  Pause,
  Upload,
  Image as ImageIcon,
  ExternalLink,
  BookOpen,
  Film,
  Music,
  FileText,
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
  computeDynamicDpr,
  classifyMediaFile,
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
  "M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.07-7.74-7.89-12.13-14.46-6.4-9.61-11.45-20.89-15.15-33.84-3.71-12.94-5.56-25.29-5.56-37.04 0-14.92 3.65-27.18 10.95-36.78 7.3-9.6 16.48-14.49 27.54-14.68 5.65 0 11.48 1.48 17.5 4.45 6.01 2.97 10.15 4.51 12.41 4.63 2.05-.12 6.3-1.74 12.74-4.87 6.44-3.12 12.39-4.59 17.85-4.4 13.68.75 24.62 5.61 32.81 14.58-11.97 7.27-17.85 17.38-17.65 30.34.2 10.19 4.1 18.66 11.69 25.4 7.6 6.74 16.63 10.5 27.1 11.28-2.6 7.65-5.91 15.54-9.92 23.68zM119.22 32.6c0-7.39 2.65-14.19 7.96-20.4 5.3-6.21 11.75-10.37 19.34-12.48.42 2.05.63 3.99.63 5.82 0 7.38-2.73 14.32-8.19 20.83-5.46 6.5-12.01 10.4-19.64 11.71-.1-.83-.1-1.83-.1-5.48z";

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

/** Exact Lucide SVG vector paths (24x24 coordinate box) for pixel-identical canvas rasterization */
export const LUCIDE_PATHS = {
  folder:
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  terminal: "M4 17l6-6-6-6M12 19h8",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  video:
    "M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5 M2 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z",
  camera:
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  film:
    "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M2 8h20 M2 16h20 M6 4v16 M18 4v16",
  fileText:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  music:
    "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  image:
    "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
};

/** Draws an authentic Lucide vector icon onto canvas matching DOM JSX 1:1 */
export function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  pathData: string,
  x: number,
  y: number,
  size: number,
  strokeColor: string,
  lineWidth: number = 1.75,
) {
  ctx.save();
  ctx.translate(x, y);
  const scale = size / 24;
  ctx.scale(scale, scale);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth / scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(pathData));
  ctx.restore();
}

export interface InteractiveStageHandle {
  startRecording: (mode: "full" | "selected-area", selectedCrop?: Rect) => void;
  stopRecording: () => Promise<{ blob: Blob; manifest: StageTakeManifest }>;
  isRecording: () => boolean;
}

/**
 * Synthesizes a real animated sample WebM video blob on initial startup
 * so Finder and QuickTime can play sample media immediately.
 */
async function generateWelcomeDemoBlob(): Promise<Blob> {
  if (typeof document === "undefined") return new Blob([], { type: "video/webm" });
  return new Promise((resolve) => {
    try {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d");
      if (!ctx || typeof MediaRecorder === "undefined") {
        resolve(new Blob([], { type: "video/webm" }));
        return;
      }
      const stream = c.captureStream(30);
      const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
      const rec = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
      rec.start();

      let t = 0;
      const timer = setInterval(() => {
        t += 0.08;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, 640, 360);

        // Animated dynamic neon orbs
        ctx.fillStyle = "#6366f1";
        ctx.beginPath();
        ctx.arc(320 + Math.sin(t) * 90, 180 + Math.cos(t) * 45, 48, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(320 + Math.cos(t) * 110, 180 + Math.sin(t) * 55, 32, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#f43f5e";
        ctx.beginPath();
        ctx.arc(320 + Math.sin(t * 1.5) * 60, 180 - Math.cos(t * 1.5) * 60, 24, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("QuickTime Sample Video", 320, 175);
        ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("Interactive Virtual Desktop Media Player", 320, 205);

        if (t > 2.0) {
          clearInterval(timer);
          if (rec.state !== "inactive") rec.stop();
        }
      }, 50);
    } catch {
      resolve(new Blob([], { type: "video/webm" }));
    }
  });
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

  // Wallpaper state
  const [wallpaper, setWallpaper] = useState<string>("royal-blue-nebula");
  const [customWallpaperUrl, setCustomWallpaperUrl] = useState<string | null>(null);
  const customWallpaperImgRef = useRef<HTMLImageElement | null>(null);
  const wallpaperFileInputRef = useRef<HTMLInputElement>(null);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);

  // Finder state & Drag-and-drop media ingestion
  const [finderFiles, setFinderFiles] = useState<
    Array<{ name: string; isDir: boolean; size: number }>
  >([]);
  const [newFileName, setNewFileName] = useState("");
  const [isDraggingOverFinder, setIsDraggingOverFinder] = useState(false);
  const mediaRegistryRef = useRef<
    Map<string, { url: string; file?: File; kind: string; badge: string }>
  >(new Map());

  // QuickTime player state
  const [quickTimeMediaUrl, setQuickTimeMediaUrl] = useState<string | null>(null);
  const [quickTimeMediaTitle, setQuickTimeMediaTitle] = useState<string>("welcome-demo.webm");
  const quickTimeVideoRef = useRef<HTMLVideoElement>(null);
  const [quickTimePlaying, setQuickTimePlaying] = useState(true);
  const [quickTimeCurrentTime, setQuickTimeCurrentTime] = useState(0);
  const [quickTimeDuration, setQuickTimeDuration] = useState(0);

  // Arc Browser state
  const [arcUrl, setArcUrl] = useState("https://en.m.wikipedia.org");
  const [arcActiveUrl, setArcActiveUrl] = useState("https://en.m.wikipedia.org");
  const [arcReaderMode, setArcReaderMode] = useState(false);

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
    let mounted = true;
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
        if (!(await vfs.exists("/welcome-demo.webm"))) {
          const demoBlob = await generateWelcomeDemoBlob();
          if (!mounted) return;
          const demoUrl = URL.createObjectURL(demoBlob);
          mediaRegistryRef.current.set("welcome-demo.webm", {
            url: demoUrl,
            kind: "video",
            badge: "WEBM",
          });
          await vfs.writeFile(
            "/welcome-demo.webm",
            `[WebM Video Demo (${demoBlob.size} bytes)]\n`,
          );
          setQuickTimeMediaUrl(demoUrl);
          setQuickTimeMediaTitle("welcome-demo.webm");
        }
        void refreshFinder();
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
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
        y = Math.max(0, Math.min(STAGE_HEIGHT - h, y + dy));
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
            -initialCropRect.y,
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

  // Finder drag & drop handler for media files from host OS
  const handleFinderDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverFinder(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      const url = URL.createObjectURL(file);
      const info = classifyMediaFile(file.name);
      mediaRegistryRef.current.set(file.name, {
        url,
        file,
        kind: info.kind,
        badge: info.badge,
      });
      await vfs.writeFile(
        `/${file.name}`,
        `[Imported ${info.badge} file: ${file.name} (${file.size} bytes)]\n`,
      );
    }
    await refreshFinder();
    stageDiagnostics.log(
      "SHELL",
      `Ingested ${files.length} media file(s) via Finder drag & drop`,
    );
  };

  // Finder file click handler (opens videos in QuickTime with auto-play)
  const handleFinderFileClick = (file: { name: string; isDir: boolean; size: number }) => {
    if (file.isDir) return;
    const info = classifyMediaFile(file.name);
    if (info.kind === "video") {
      const registered = mediaRegistryRef.current.get(file.name);
      const url = registered?.url ?? quickTimeMediaUrl;
      if (url) {
        setQuickTimeMediaUrl(url);
        setQuickTimeMediaTitle(file.name);
        const existing = wm.getWindows().find((w) => w.appKind === "quicktime");
        if (existing) {
          wm.restoreWindow(existing.id);
          wm.focusWindow(existing.id);
        } else {
          wm.openApp("quicktime", { x: 380, y: 110, width: 620, height: 400 });
        }
        syncWindows();
        setQuickTimePlaying(true);
        stageDiagnostics.log("UI", `Opened video ${file.name} in QuickTime with auto-play`);
      }
    }
  };

  // Arc navigation with DuckDuckGo fallback
  const handleArcNavigate = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      setArcUrl(trimmed);
      setArcActiveUrl(trimmed);
    } else if (trimmed.includes(".") && !trimmed.includes(" ")) {
      const url = `https://${trimmed}`;
      setArcUrl(url);
      setArcActiveUrl(url);
    } else {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
      setArcUrl(trimmed);
      setArcActiveUrl(searchUrl);
    }
    setArcReaderMode(false);
  };

  // Canvas frame recording loop with 2x supersampling and visual parity
  const startCanvasRecording = (recRect: Rect) => {
    const canvas = canvasRecordRef.current;
    if (!canvas) return;

    const DPR = computeDynamicDpr(recRect.width, recRect.height);
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
      if (wallpaper === "custom" && customWallpaperImgRef.current) {
        ctx.drawImage(
          customWallpaperImgRef.current,
          -recRect.x,
          -recRect.y,
          STAGE_WIDTH,
          STAGE_HEIGHT,
        );
      } else {
        const bgGrad = ctx.createLinearGradient(
          -recRect.x,
          -recRect.y,
          STAGE_WIDTH - recRect.x,
          STAGE_HEIGHT - recRect.y,
        );
        if (wallpaper === "macos-sonoma") {
          bgGrad.addColorStop(0, "#d97706");
          bgGrad.addColorStop(0.5, "#e11d48");
          bgGrad.addColorStop(1, "#581c87");
        } else if (wallpaper === "macos-sequoia") {
          bgGrad.addColorStop(0, "#064e3b");
          bgGrad.addColorStop(0.5, "#134e4a");
          bgGrad.addColorStop(1, "#0f172a");
        } else if (wallpaper === "macos-monterey") {
          bgGrad.addColorStop(0, "#4c1d95");
          bgGrad.addColorStop(0.5, "#be185d");
          bgGrad.addColorStop(1, "#1e40af");
        } else {
          // royal-blue-nebula
          bgGrad.addColorStop(0, "#1e1b4b");
          bgGrad.addColorStop(0.4, "#312e81");
          bgGrad.addColorStop(1, "#1e3a8a");
        }
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, recRect.width, recRect.height);

        // Ambient desktop nebula glow
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
      }

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
          ctx.fillText("Virtual Root (/) · Drag files from OS", rx + 12, cy + 18);

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
            const fy = itemStartY + row * 82;
            if (fy + 72 > ry + rh - 30) break;

            // File media badges
            const mediaInfo = classifyMediaFile(file.name);
            let badgeBg = "#27272a";
            let badgeText = "#a1a1aa";
            if (mediaInfo.badge === "MP4") {
              badgeBg = "#1e3a8a";
              badgeText = "#60a5fa";
            } else if (mediaInfo.badge === "WEBM") {
              badgeBg = "#581c87";
              badgeText = "#c084fc";
            } else if (mediaInfo.badge === "MOV" || mediaInfo.badge === "MKV") {
              badgeBg = "#831843";
              badgeText = "#f472b6";
            } else if (mediaInfo.badge === "AUDIO") {
              badgeBg = "#78350f";
              badgeText = "#fbbf24";
            } else if (mediaInfo.badge === "IMG") {
              badgeBg = "#064e3b";
              badgeText = "#34d399";
            }

            // 1. Draw authentic Lucide vector icon matching DOM
            let iconPath = LUCIDE_PATHS.fileText;
            let iconColor = "#a1a1aa";
            if (file.isDir) {
              iconPath = LUCIDE_PATHS.folder;
              iconColor = "#60a5fa";
            } else if (mediaInfo.kind === "video") {
              iconPath = LUCIDE_PATHS.film;
              iconColor = "#c084fc";
            } else if (mediaInfo.kind === "audio") {
              iconPath = LUCIDE_PATHS.music;
              iconColor = "#fbbf24";
            } else if (mediaInfo.kind === "image") {
              iconPath = LUCIDE_PATHS.image;
              iconColor = "#34d399";
            }

            drawLucideIcon(ctx, iconPath, fx + 15, fy, 26, iconColor, 1.75);

            // 2. Draw format pill badge for files
            if (!file.isDir) {
              const badgeW = 34;
              const badgeH = 12;
              const bx = fx + 28 - badgeW / 2;
              const by = fy + 28;
              ctx.fillStyle = badgeBg;
              ctx.beginPath();
              ctx.roundRect(bx, by, badgeW, badgeH, 3);
              ctx.fill();
              ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
              ctx.stroke();

              ctx.fillStyle = badgeText;
              ctx.font = "bold 8px monospace";
              ctx.textAlign = "center";
              ctx.fillText(mediaInfo.badge, fx + 28, by + 9);
            }

            // 3. File name & size
            ctx.fillStyle = "#f4f4f5";
            ctx.font = "10px -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(file.name.slice(0, 12), fx + 28, fy + 48);
            ctx.fillStyle = "#71717a";
            ctx.font = "9px -apple-system, sans-serif";
            const szText = file.size ? `${(file.size / 1024).toFixed(1)} KB` : "45 B";
            ctx.fillText(szText, fx + 28, fy + 59);
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
            "DuckDuckGo search • Real webview navigation",
            rx + 28,
            cy + 94,
          );
        } else if (win.appKind === "quicktime") {
          const videoEl = quickTimeVideoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            try {
              ctx.drawImage(videoEl, rx, cy, rw, ch);
            } catch {
              ctx.fillStyle = "#000000";
              ctx.fillRect(rx, cy, rw, ch);
            }
          } else {
            ctx.fillStyle = "#000000";
            ctx.fillRect(rx, cy, rw, ch);
          }

          // Glassmorphic playback bar overlay on canvas
          ctx.fillStyle = "rgba(24, 24, 27, 0.8)";
          ctx.beginPath();
          ctx.roundRect(rx + rw / 2 - 90, ry + rh - 34, 180, 24, 12);
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`▶ QuickTime · ${quickTimeMediaTitle}`, rx + rw / 2, ry + rh - 18);
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
      const dockApps = [
        { kind: "finder", color: "#60a5fa", path: LUCIDE_PATHS.folder },
        { kind: "iterm", color: "#34d399", path: LUCIDE_PATHS.terminal },
        { kind: "arc", color: "#818cf8", path: LUCIDE_PATHS.globe },
        { kind: "quicktime", color: "#fb7185", path: LUCIDE_PATHS.video },
        { kind: "photobooth", color: "#fbbf24", path: LUCIDE_PATHS.camera },
      ];

      const iconTileSize = 40;
      const iconInnerSize = 20;
      const gap = 8;
      const padX = 12;
      const dockW =
        padX * 2 +
        dockApps.length * iconTileSize +
        (dockApps.length - 1) * gap; // 24 + 200 + 32 = 256
      const dockH = 54;
      const dockX = (STAGE_WIDTH - dockW) / 2 - recRect.x;
      const dockY = STAGE_HEIGHT - dockH - 8 - recRect.y;

      if (
        dockY < recRect.height &&
        dockX + dockW > 0 &&
        dockX < recRect.width
      ) {
        // Dock pill glass background
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = "rgba(0, 0, 0, 0.40)";
        ctx.beginPath();
        ctx.roundRect(dockX, dockY, dockW, dockH, 16);
        ctx.fill();
        ctx.restore();

        // Dock pill border
        ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(dockX, dockY, dockW, dockH, 16);
        ctx.stroke();

        const startX = dockX + padX;
        const iconY = dockY + 5;

        for (let i = 0; i < dockApps.length; i++) {
          const da = dockApps[i]!;
          const ix = startX + i * (iconTileSize + gap);

          // Tile gradient matching DOM: bg-gradient-to-b from-zinc-700 to-zinc-800
          const grad = ctx.createLinearGradient(
            ix,
            iconY,
            ix,
            iconY + iconTileSize,
          );
          grad.addColorStop(0, "#3f3f46"); // zinc-700
          grad.addColorStop(1, "#27272a"); // zinc-800
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(ix, iconY, iconTileSize, iconTileSize, 12);
          ctx.fill();

          // Border matching DOM: border border-white/10
          ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(ix, iconY, iconTileSize, iconTileSize, 12);
          ctx.stroke();

          // Draw exact Lucide vector icon inside tile
          const iconOffsetX = ix + (iconTileSize - iconInnerSize) / 2;
          const iconOffsetY = iconY + (iconTileSize - iconInnerSize) / 2;
          drawLucideIcon(
            ctx,
            da.path,
            iconOffsetX,
            iconOffsetY,
            iconInnerSize,
            da.color,
            1.75,
          );

          const isRunning = wm
            .getWindows()
            .some((w) => w.appKind === da.kind && !w.isMinimized);
          if (isRunning) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.beginPath();
            ctx.arc(
              ix + iconTileSize / 2,
              iconY + iconTileSize + 4,
              1.5,
              0,
              Math.PI * 2,
            );
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
        const startTime = recordStartTimeRef.current;
        const durationMs =
          startTime > 0 ? Math.max(100, Date.now() - startTime) : 1000;
        recordStartTimeRef.current = 0;
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
          ...(customWallpaperUrl && wallpaper === "custom"
            ? {
                backgroundImage: `url(${customWallpaperUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : wallpaper === "macos-sonoma"
              ? { background: "linear-gradient(135deg, #d97706 0%, #e11d48 50%, #581c87 100%)" }
              : wallpaper === "macos-sequoia"
                ? { background: "linear-gradient(135deg, #064e3b 0%, #134e4a 50%, #0f172a 100%)" }
                : wallpaper === "macos-monterey"
                  ? { background: "linear-gradient(135deg, #4c1d95 0%, #be185d 50%, #1e40af 100%)" }
                  : { background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #1e3a8a 100%)" }),
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

            {/* Desktop Wallpaper Picker Dropdown */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowWallpaperPicker((prev) => !prev);
                }}
                className="flex items-center gap-1 hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-white/10"
                title="Change Desktop Wallpaper"
              >
                <ImageIcon size={12} />
                <span className="capitalize">{wallpaper.replace("macos-", "").replace("-", " ")}</span>
              </button>

              {showWallpaperPicker && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-7 z-50 w-44 rounded-md border border-zinc-700 bg-zinc-900/95 p-1 text-xs shadow-xl backdrop-blur-md"
                >
                  <p className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Wallpaper
                  </p>
                  {[
                    { id: "royal-blue-nebula", label: "Royal Blue Nebula" },
                    { id: "macos-sonoma", label: "macOS Sonoma" },
                    { id: "macos-sequoia", label: "macOS Sequoia" },
                    { id: "macos-monterey", label: "macOS Monterey" },
                  ].map((wp) => (
                    <button
                      key={wp.id}
                      onClick={() => {
                        setWallpaper(wp.id);
                        setShowWallpaperPicker(false);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-zinc-800 ${
                        wallpaper === wp.id ? "text-indigo-400 font-semibold" : "text-zinc-300"
                      }`}
                    >
                      {wp.label}
                      {wallpaper === wp.id && <span>✓</span>}
                    </button>
                  ))}
                  <div className="my-1 border-t border-zinc-800" />
                  <button
                    onClick={() => {
                      wallpaperFileInputRef.current?.click();
                      setShowWallpaperPicker(false);
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-800"
                  >
                    <Upload size={11} />
                    Custom Image...
                  </button>
                </div>
              )}
            </div>

            {/* Hidden file input for custom wallpaper */}
            <input
              ref={wallpaperFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  setCustomWallpaperUrl(url);
                  setWallpaper("custom");
                  const img = new Image();
                  img.src = url;
                  img.onload = () => {
                    customWallpaperImgRef.current = img;
                  };
                }
              }}
            />

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
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingOverFinder(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingOverFinder(false);
                    }}
                    onDrop={handleFinderDrop}
                    className="relative flex h-full flex-col text-xs"
                  >
                    {isDraggingOverFinder && (
                      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-md border-2 border-dashed border-blue-400 bg-blue-950/85 p-4 text-center backdrop-blur-xs">
                        <Upload size={32} className="mb-2 text-blue-300 animate-bounce" />
                        <p className="text-xs font-semibold text-white">Drop media files here</p>
                        <p className="text-[10px] text-blue-300">Videos (.mp4, .webm, .mov), Audio, Images</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                      <span className="font-semibold text-zinc-300">
                        Virtual Root (/) · Drag files from OS
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
                          No files in virtual directory. Drag & drop files here.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {finderFiles.map((f) => {
                            const info = classifyMediaFile(f.name);
                            return (
                              <div
                                key={f.name}
                                onClick={() => handleFinderFileClick(f)}
                                className="group flex flex-col items-center justify-center rounded-md p-2 hover:bg-zinc-800/70 cursor-pointer transition-colors"
                                title={info.kind === "video" ? `${f.name} (Click to play in QuickTime)` : f.name}
                              >
                                {f.isDir ? (
                                  <Folder size={26} className="text-blue-400" />
                                ) : (
                                  <div className="flex flex-col items-center gap-1">
                                    {info.kind === "video" && (
                                      <Film size={26} className="text-purple-400" />
                                    )}
                                    {info.kind === "audio" && (
                                      <Music size={26} className="text-amber-400" />
                                    )}
                                    {info.kind === "image" && (
                                      <ImageIcon size={26} className="text-emerald-400" />
                                    )}
                                    {info.kind !== "video" &&
                                      info.kind !== "audio" &&
                                      info.kind !== "image" && (
                                        <FileText size={26} className="text-zinc-400" />
                                      )}
                                    <div
                                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase shadow-xs ${
                                        info.badge === "MP4"
                                          ? "border border-blue-600/50 bg-blue-950/80 text-blue-300"
                                          : info.badge === "WEBM"
                                            ? "border border-purple-600/50 bg-purple-950/80 text-purple-300"
                                            : info.badge === "MOV" || info.badge === "MKV"
                                              ? "border border-rose-600/50 bg-rose-950/80 text-rose-300"
                                              : info.badge === "AUDIO"
                                                ? "border border-amber-600/50 bg-amber-950/80 text-amber-300"
                                                : info.badge === "IMG"
                                                  ? "border border-emerald-600/50 bg-emerald-950/80 text-emerald-300"
                                                  : "border border-zinc-700 bg-zinc-800 text-zinc-400"
                                      }`}
                                    >
                                      {info.badge}
                                    </div>
                                  </div>
                                )}
                                <span className="mt-1 w-full truncate text-center text-[11px] font-medium text-zinc-200 group-hover:text-white">
                                  {f.name}
                                </span>
                                <span className="text-[9px] text-zinc-500">
                                  {f.size ? `${(f.size / 1024).toFixed(1)} KB` : "45 B"}
                                </span>
                              </div>
                            );
                          })}
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

                {/* Arc Webview Sandbox with DuckDuckGo Lookup & Bookmarks */}
                {win.appKind === "arc" && (
                  <div className="flex h-full flex-col text-xs bg-zinc-950">
                    {/* Navigation Bar */}
                    <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/80 p-1.5">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleArcNavigate(arcUrl);
                        }}
                        className="flex flex-1 items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-950 px-2 py-1"
                      >
                        <Globe size={12} className="shrink-0 text-indigo-400" />
                        <input
                          type="text"
                          value={arcUrl}
                          onChange={(e) => setArcUrl(e.target.value)}
                          placeholder="Search DuckDuckGo or enter URL (e.g. wikipedia.org)..."
                          className="flex-1 bg-transparent text-xs text-zinc-100 focus:outline-none"
                        />
                        <button type="submit" className="text-zinc-400 hover:text-white">
                          <ArrowRight size={12} />
                        </button>
                      </form>

                      <button
                        onClick={() => setArcReaderMode((prev) => !prev)}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border transition-colors ${
                          arcReaderMode
                            ? "border-indigo-500/50 bg-indigo-600/30 text-indigo-300"
                            : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="Toggle clean reader mode"
                      >
                        <BookOpen size={11} /> Reader
                      </button>
                    </div>

                    {/* Bookmarks Bar */}
                    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800/60 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400">
                      <span className="shrink-0 font-medium text-zinc-500">Bookmarks:</span>
                      {[
                        { name: "Wikipedia", url: "https://en.m.wikipedia.org" },
                        { name: "DuckDuckGo", url: "https://html.duckduckgo.com" },
                        { name: "DevDocs", url: "https://devdocs.io" },
                        { name: "Example Domain", url: "https://example.com" },
                        { name: "Hacker News", url: "https://news.ycombinator.com" },
                      ].map((bm) => (
                        <button
                          key={bm.name}
                          onClick={() => {
                            setArcUrl(bm.url);
                            setArcActiveUrl(bm.url);
                            setArcReaderMode(false);
                          }}
                          className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
                        >
                          {bm.name}
                        </button>
                      ))}
                    </div>

                    {/* Webview Content */}
                    <div className="relative flex-1 overflow-hidden bg-white">
                      {arcReaderMode ? (
                        <div className="h-full overflow-auto bg-zinc-900 p-4 text-zinc-200">
                          <h2 className="mb-2 text-base font-bold text-white">Arc Reader View</h2>
                          <p className="mb-3 font-mono text-xs text-zinc-400">{arcActiveUrl}</p>
                          <div className="space-y-2 text-xs leading-relaxed text-zinc-300">
                            <p>
                              Clean distraction-free reading mode. Websites that forbid iframe embedding
                              via <code className="font-mono text-indigo-400">X-Frame-Options: SAMEORIGIN</code> can
                              be previewed here without header restrictions.
                            </p>
                            <p>
                              Destination URL:{" "}
                              <a
                                href={arcActiveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-400 underline"
                              >
                                {arcActiveUrl}
                              </a>
                            </p>
                          </div>
                        </div>
                      ) : (
                        <iframe
                          src={arcActiveUrl}
                          title="Arc Web Browser"
                          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                          className="h-full w-full border-0 bg-white"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* QuickTime Player with Live HTML5 Video & Glassmorphic Scrubber */}
                {win.appKind === "quicktime" && (
                  <div className="relative flex h-full flex-col bg-black overflow-hidden select-none">
                    {quickTimeMediaUrl ? (
                      <video
                        ref={quickTimeVideoRef}
                        src={quickTimeMediaUrl}
                        autoPlay
                        loop
                        playsInline
                        muted
                        onTimeUpdate={() => {
                          if (quickTimeVideoRef.current) {
                            setQuickTimeCurrentTime(quickTimeVideoRef.current.currentTime);
                            setQuickTimeDuration(quickTimeVideoRef.current.duration || 0);
                          }
                        }}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                        <Video size={36} className="mb-2 text-rose-400" />
                        <h4 className="text-xs font-medium text-zinc-200">
                          QuickTime Media Player
                        </h4>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Click any video file in Finder to open and play
                        </p>
                      </div>
                    )}

                    {/* Floating macOS QuickTime Transport Scrubber */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-full border border-white/20 bg-zinc-900/85 px-3.5 py-1.5 shadow-2xl backdrop-blur-md">
                      <button
                        onClick={() => {
                          if (!quickTimeVideoRef.current) return;
                          if (quickTimeVideoRef.current.paused) {
                            void quickTimeVideoRef.current.play();
                            setQuickTimePlaying(true);
                          } else {
                            quickTimeVideoRef.current.pause();
                            setQuickTimePlaying(false);
                          }
                        }}
                        className="text-white hover:text-rose-400 transition-colors"
                        title={quickTimePlaying ? "Pause" : "Play"}
                      >
                        {quickTimePlaying ? <Pause size={13} /> : <Play size={13} className="fill-current" />}
                      </button>

                      <input
                        type="range"
                        min={0}
                        max={quickTimeDuration || 100}
                        step={0.1}
                        value={quickTimeCurrentTime}
                        onChange={(e) => {
                          const time = Number(e.target.value);
                          setQuickTimeCurrentTime(time);
                          if (quickTimeVideoRef.current) {
                            quickTimeVideoRef.current.currentTime = time;
                          }
                        }}
                        className="h-1 w-28 accent-rose-500 rounded-lg cursor-pointer"
                      />

                      <span className="font-mono text-[10px] text-zinc-300 tabular">
                        {Math.floor(quickTimeCurrentTime)}s / {Math.floor(quickTimeDuration || 3)}s
                      </span>
                    </div>
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
