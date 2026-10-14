import type {
  Id,
  Rect,
  Size,
  StagePointerEvent,
  StageRecordingOptions,
  StageTakeManifest,
} from "@cutaway/types";

// ==========================================
// 1. resolveRecordingRect
// ==========================================

export function resolveRecordingRect(
  stage: Rect,
  options: StageRecordingOptions,
): Rect {
  if (
    !stage ||
    typeof stage !== "object" ||
    !Number.isFinite(stage.x) ||
    !Number.isFinite(stage.y) ||
    !Number.isFinite(stage.width) ||
    stage.width <= 0 ||
    !Number.isFinite(stage.height) ||
    stage.height <= 0
  ) {
    throw new Error("Invalid stage rect");
  }

  if (options.mode === "full") {
    return {
      x: stage.x,
      y: stage.y,
      width: stage.width,
      height: stage.height,
    };
  }

  if (options.mode === "selected-area") {
    const sel = options.selectedRect;
    if (
      !sel ||
      typeof sel !== "object" ||
      !Number.isFinite(sel.x) ||
      !Number.isFinite(sel.y) ||
      !Number.isFinite(sel.width) ||
      sel.width <= 0 ||
      !Number.isFinite(sel.height) ||
      sel.height <= 0
    ) {
      throw new Error("Invalid selected rect");
    }

    if (
      sel.x < stage.x ||
      sel.y < stage.y ||
      sel.x + sel.width > stage.x + stage.width ||
      sel.y + sel.height > stage.y + stage.height
    ) {
      throw new Error("Selected rect is outside stage bounds");
    }

    return {
      x: sel.x,
      y: sel.y,
      width: sel.width,
      height: sel.height,
    };
  }

  throw new Error(`Unknown recording mode: ${(options as any).mode}`);
}

// ==========================================
// 2. installStageCaptureHandler
// ==========================================

export interface InstallStageCaptureHandlerOptions {
  desktopCapturer: {
    getSources: (options: { types: string[] }) => Promise<Array<{ id: string; [key: string]: unknown }>>;
  };
  session: {
    setDisplayMediaRequestHandler: (
      handler: ((request: { frame: unknown }, callback: (result: { video?: unknown; audio?: unknown }) => void) => void) | null,
    ) => void;
  };
  getStageSourceId: () => string | null | undefined;
  isTrustedFrame: (frame: unknown) => boolean;
}

export function installStageCaptureHandler(options: InstallStageCaptureHandlerOptions): () => void {
  let isDisposed = false;

  const handler = async (
    request: { frame: unknown },
    callback: (result: { video?: unknown; audio?: unknown }) => void,
  ) => {
    if (isDisposed) {
      callback({});
      return;
    }

    if (!options.isTrustedFrame(request.frame)) {
      callback({});
      return;
    }

    const targetId = options.getStageSourceId();
    if (!targetId || typeof targetId !== "string" || targetId.trim() === "") {
      callback({});
      return;
    }

    try {
      const sources = await options.desktopCapturer.getSources({ types: ["window"] });
      if (isDisposed) {
        callback({});
        return;
      }

      const matched = sources.find((s) => s.id === targetId);
      if (matched) {
        callback({ video: matched });
      } else {
        callback({});
      }
    } catch {
      callback({});
    }
  };

  options.session.setDisplayMediaRequestHandler(handler);

  return () => {
    isDisposed = true;
    options.session.setDisplayMediaRequestHandler(null);
  };
}

// ==========================================
// 3. PointerLogger
// ==========================================

export interface PointerLoggerOptions {
  recordingRect: Rect;
  startedAtMs: number;
}

export class PointerLogger {
  private readonly rect: Rect;
  private readonly startedAtMs: number;
  private readonly events: StagePointerEvent[] = [];
  private lastRelativeMs = -Infinity;

  constructor(options: PointerLoggerOptions) {
    this.rect = { ...options.recordingRect };
    this.startedAtMs = options.startedAtMs;
  }

  record(event: StagePointerEvent): void {
    if (
      !event ||
      typeof event !== "object" ||
      !event.pos ||
      typeof event.pos !== "object" ||
      !Number.isFinite(event.timestampMs) ||
      !Number.isFinite(event.pos.x) ||
      !Number.isFinite(event.pos.y)
    ) {
      return;
    }

    if (event.timestampMs < this.startedAtMs) {
      return;
    }

    const relMs = event.timestampMs - this.startedAtMs;
    if (relMs < this.lastRelativeMs) {
      return;
    }

    // Drops events outside the recording rectangle (right and bottom edges exclusive)
    if (
      event.pos.x < this.rect.x ||
      event.pos.x >= this.rect.x + this.rect.width ||
      event.pos.y < this.rect.y ||
      event.pos.y >= this.rect.y + this.rect.height
    ) {
      return;
    }

    const cloned: StagePointerEvent = {
      timestampMs: relMs,
      pos: { x: event.pos.x, y: event.pos.y },
      type: event.type,
      ...(event.targetWindowId !== undefined ? { targetWindowId: event.targetWindowId } : {}),
    };

    this.events.push(cloned);
    this.lastRelativeMs = relMs;
  }

  getEvents(): StagePointerEvent[] {
    return this.events.map((e) => ({
      timestampMs: e.timestampMs,
      pos: { x: e.pos.x, y: e.pos.y },
      type: e.type,
      ...(e.targetWindowId !== undefined ? { targetWindowId: e.targetWindowId } : {}),
    }));
  }
}

// ==========================================
// 4. cropStageFrame
// ==========================================

export function cropStageFrame(
  ctx: { drawImage: (...args: any[]) => void },
  source: unknown,
  sourceSize: Size,
  stage: Rect,
  recording: Rect,
): void {
  if (
    !sourceSize ||
    !Number.isFinite(sourceSize.width) ||
    sourceSize.width <= 0 ||
    !Number.isFinite(sourceSize.height) ||
    sourceSize.height <= 0
  ) {
    throw new Error("Invalid sourceSize");
  }

  if (
    !stage ||
    !Number.isFinite(stage.x) ||
    !Number.isFinite(stage.y) ||
    !Number.isFinite(stage.width) ||
    stage.width <= 0 ||
    !Number.isFinite(stage.height) ||
    stage.height <= 0
  ) {
    throw new Error("Invalid stage rect");
  }

  if (
    !recording ||
    !Number.isFinite(recording.x) ||
    !Number.isFinite(recording.y) ||
    !Number.isFinite(recording.width) ||
    recording.width <= 0 ||
    !Number.isFinite(recording.height) ||
    recording.height <= 0
  ) {
    throw new Error("Invalid recording rect");
  }

  if (
    recording.x < stage.x ||
    recording.y < stage.y ||
    recording.x + recording.width > stage.x + stage.width ||
    recording.y + recording.height > stage.y + stage.height
  ) {
    throw new Error("Recording rect is outside stage rect");
  }

  const scaleX = sourceSize.width / stage.width;
  const scaleY = sourceSize.height / stage.height;

  const sx = (recording.x - stage.x) * scaleX;
  const sy = (recording.y - stage.y) * scaleY;
  const sWidth = recording.width * scaleX;
  const sHeight = recording.height * scaleY;

  const dx = 0;
  const dy = 0;
  const dWidth = recording.width;
  const dHeight = recording.height;

  ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
}

// ==========================================
// 5. createBrowserRecordingBackend
// ==========================================

export interface CreateBrowserRecordingBackendOptions {
  frameRate?: number;
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  saveVideo: (blob: Blob) => Promise<string>;
  setWebAudioMuted: (muted: boolean) => void;
  getControlledAudioStreams?: () => MediaStream[];
  getMicrophone?: () => Promise<MediaStream>;
  requestMicrophone?: boolean;
}

export interface BackendRequest {
  stageRect: Rect;
  recordingRect: Rect;
  recordAudio: boolean;
  onWarning: (message: string) => void;
}

export interface BackendSession {
  finish: () => Promise<{ videoUri: string }>;
  dispose: () => void;
}

export interface RecordingBackend {
  start: (request: BackendRequest) => Promise<BackendSession>;
}

export function createBrowserRecordingBackend(
  options: CreateBrowserRecordingBackendOptions,
): RecordingBackend {
  if (options.frameRate !== undefined) {
    if (
      !Number.isInteger(options.frameRate) ||
      options.frameRate < 1 ||
      options.frameRate > 120
    ) {
      throw new Error("Invalid frameRate: must be an integer between 1 and 120");
    }
  }

  const fps = options.frameRate ?? 30;

  return {
    async start(request: BackendRequest): Promise<BackendSession> {
      options.setWebAudioMuted(true);

      let screenStream: MediaStream;
      try {
        const getMedia =
          options.getDisplayMedia ??
          ((c: MediaStreamConstraints) => navigator.mediaDevices.getDisplayMedia(c));
        screenStream = await getMedia({ video: true, audio: true });
      } catch (err) {
        options.setWebAudioMuted(false);
        throw err;
      }

      const video = document.createElement("video");
      video.srcObject = screenStream;
      video.muted = true;
      video.autoplay = true;
      await video.play().catch(() => {});

      const canvas = document.createElement("canvas");
      canvas.width = request.recordingRect.width;
      canvas.height = request.recordingRect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        options.setWebAudioMuted(false);
        screenStream.getTracks().forEach((t) => t.stop());
        throw new Error("Failed to acquire 2D canvas context");
      }

      let active = true;
      let rafId: number | null = null;

      const render = () => {
        if (!active) return;
        const videoTrack = screenStream.getVideoTracks()[0];
        const settings = (videoTrack?.getSettings?.() as Record<string, unknown>) ?? {};
        const sourceWidth =
          video.videoWidth || (settings.width as number) || request.stageRect.width;
        const sourceHeight =
          video.videoHeight || (settings.height as number) || request.stageRect.height;

        cropStageFrame(
          ctx,
          video,
          { width: sourceWidth, height: sourceHeight },
          request.stageRect,
          request.recordingRect,
        );
        rafId = requestAnimationFrame(render);
      };

      render();

      const canvasStream = (canvas as any).captureStream(fps) as MediaStream;

      let audioContext: AudioContext | null = null;
      let micStream: MediaStream | null = null;
      const outputAudioTracks: MediaStreamTrack[] = [];

      if (request.recordAudio) {
        const audioStreamsToMix: MediaStream[] = [];

        if (options.requestMicrophone && options.getMicrophone) {
          try {
            micStream = await options.getMicrophone();
            if (micStream) {
              audioStreamsToMix.push(micStream);
            }
          } catch (err: any) {
            request.onWarning(err?.message || "Microphone access denied");
          }
        }

        if (options.getControlledAudioStreams) {
          const controlled = options.getControlledAudioStreams();
          if (controlled && controlled.length > 0) {
            audioStreamsToMix.push(...controlled);
          }
        }

        if (audioStreamsToMix.length > 0) {
          const AudioCtx =
            window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            audioContext = new AudioCtx();
            const dest = audioContext.createMediaStreamDestination();
            for (const st of audioStreamsToMix) {
              const sourceNode = audioContext.createMediaStreamSource(st);
              sourceNode.connect(dest);
            }
            outputAudioTracks.push(...dest.stream.getAudioTracks());
          }
        }
      }

      const combinedTracks: MediaStreamTrack[] = [
        ...canvasStream.getVideoTracks(),
        ...outputAudioTracks,
      ];
      const combinedStream = new MediaStream(combinedTracks);
      const recorder = new MediaRecorder(combinedStream);

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event: any) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.start();

      let isFinishedOrDisposed = false;

      const cleanupTracksAndContext = () => {
        active = false;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        screenStream.getTracks().forEach((track) => track.stop());
        canvasStream.getTracks().forEach((track) => track.stop());
        micStream?.getTracks().forEach((track) => track.stop());

        if (audioContext && audioContext.state !== "closed") {
          audioContext.close().catch(() => {});
        }

        video.pause();
        video.srcObject = null;
        options.setWebAudioMuted(false);
      };

      return {
        async finish(): Promise<{ videoUri: string }> {
          if (isFinishedOrDisposed) {
            throw new Error("Backend session has already finished or been disposed");
          }
          isFinishedOrDisposed = true;

          active = false;
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }

          const stopPromise = new Promise<void>((resolve) => {
            recorder.addEventListener("stop", () => resolve(), { once: true });
            recorder.stop();
          });
          await stopPromise;

          cleanupTracksAndContext();

          const blob = new Blob(chunks, { type: "video/webm" });
          const videoUri = await options.saveVideo(blob);
          return { videoUri };
        },

        dispose(): void {
          if (isFinishedOrDisposed) return;
          isFinishedOrDisposed = true;

          if (recorder.state !== "inactive") {
            recorder.stop();
          }

          cleanupTracksAndContext();
        },
      };
    },
  };
}

// ==========================================
// 6. StageRecorder
// ==========================================

export interface StageRecorderOptions {
  stageRect: Rect;
  backend: RecordingBackend;
  clock?: () => number;
  wallClock?: () => number;
  makeTakeId?: () => string;
}

export class StageRecorder {
  private readonly stageRect: Rect;
  private readonly backend: RecordingBackend;
  private readonly clock: () => number;
  private readonly wallClock: () => number;
  private readonly makeTakeId: () => string;

  private _state: "idle" | "starting" | "recording" | "stopping" | "disposed" = "idle";
  private _warnings: string[] = [];
  private currentSession: BackendSession | null = null;
  private pointerLogger: PointerLogger | null = null;
  private activeRecordingRect: Rect | null = null;
  private startedAtMs = 0;
  private createdAtMs = 0;

  constructor(options: StageRecorderOptions) {
    this.stageRect = { ...options.stageRect };
    this.backend = options.backend;
    this.clock = options.clock ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    let idCounter = 0;
    this.makeTakeId = options.makeTakeId ?? (() => `take-${++idCounter}`);
  }

  get state(): "idle" | "starting" | "recording" | "stopping" | "disposed" {
    return this._state;
  }

  get warnings(): string[] {
    return [...this._warnings];
  }

  recordPointer(event: StagePointerEvent): void {
    if (this._state !== "recording" || !this.pointerLogger) {
      return;
    }
    this.pointerLogger.record(event);
  }

  async start(options: StageRecordingOptions): Promise<void> {
    if (this._state === "disposed") {
      throw new Error("StageRecorder is disposed");
    }
    if (this._state !== "idle") {
      throw new Error(`Cannot start recording when state is ${this._state}`);
    }
    if (!options.muteWebAudio) {
      throw new Error("Recording requires web audio to be muted");
    }

    const recordingRect = resolveRecordingRect(this.stageRect, options);
    this.activeRecordingRect = recordingRect;
    this._warnings = [];
    this._state = "starting";

    try {
      const session = await this.backend.start({
        stageRect: this.stageRect,
        recordingRect,
        recordAudio: options.recordAudio,
        onWarning: (msg: string) => {
          this._warnings.push(msg);
        },
      });

      const stateAfterAwait: string = this._state;
      if (stateAfterAwait === "disposed") {
        session.dispose();
        throw new Error("StageRecorder was disposed during start");
      }

      this.currentSession = session;
      this.startedAtMs = this.clock();
      this.createdAtMs = this.wallClock();
      this.pointerLogger = new PointerLogger({
        recordingRect,
        startedAtMs: this.startedAtMs,
      });
      this._state = "recording";
    } catch (err) {
      const stateInCatch: string = this._state;
      if (stateInCatch !== "disposed") {
        this._state = "idle";
      }
      throw err;
    }
  }

  async stop(): Promise<StageTakeManifest> {
    if (this._state === "disposed") {
      throw new Error("StageRecorder is disposed");
    }
    if (this._state !== "recording") {
      throw new Error(`Cannot stop recording when state is ${this._state}`);
    }

    this._state = "stopping";
    // Freeze duration immediately before async finalize
    const durationMs = this.clock() - this.startedAtMs;

    const session = this.currentSession;
    if (!session) {
      this._state = "idle";
      throw new Error("No active recording session");
    }

    let takeResult: { videoUri: string };
    try {
      takeResult = await session.finish();
      if (!takeResult || typeof takeResult !== "object" || !takeResult.videoUri) {
        throw new Error("Backend failed to return a valid videoUri");
      }
    } catch (err) {
      session.dispose();
      this.currentSession = null;
      this._state = "idle";
      throw err;
    }

    session.dispose();
    this.currentSession = null;

    const pointerEvents = this.pointerLogger ? this.pointerLogger.getEvents() : [];

    const manifest: StageTakeManifest = {
      takeId: this.makeTakeId(),
      videoUri: takeResult.videoUri,
      durationMs,
      recordingRect: this.activeRecordingRect!,
      pointerEvents,
      trackMouseEnabled: false,
      createdAt: this.createdAtMs,
    };

    this._state = "idle";
    return manifest;
  }

  dispose(): void {
    if (this._state === "disposed") {
      return;
    }
    this._state = "disposed";
    if (this.currentSession) {
      this.currentSession.dispose();
      this.currentSession = null;
    }
    this.pointerLogger = null;
  }
}
