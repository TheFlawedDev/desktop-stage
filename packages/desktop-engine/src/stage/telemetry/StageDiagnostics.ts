/**
 * Structured telemetry and diagnostics engine for Desktop Stage.
 *
 * Provides microsecond-precision trace logging across all stage subsystems:
 * - RECORDER: MediaRecorder bitrates, chunks, canvas frame draw times
 * - CAMERA: MouseFollowCamera smoothing math, target vs smoothed coordinates, clamping
 * - WM: Window stacking order, focus changes, dragging, resizing, crop bounds
 * - SHELL: iTerm command execution, exit codes, execution durations
 */

export type DiagnosticCategory = "RECORDER" | "CAMERA" | "WM" | "SHELL" | "UI";

export interface DiagnosticTrace {
  id: string;
  timestampMs: number;
  timeFormatted: string;
  category: DiagnosticCategory;
  message: string;
  data?: Record<string, unknown>;
}

export interface LiveStageMetrics {
  fps: number;
  bitrateMbps: number;
  encoderMime: string;
  totalChunks: number;
  pointerEventsCount: number;
  cameraSmoothingDelta: number;
  activeWindowsCount: number;
  canvasRenderTimeMs: number;
}

class StageDiagnosticsEngine {
  private traces: DiagnosticTrace[] = [];
  private maxTraces = 1500;
  private listeners = new Set<(trace: DiagnosticTrace) => void>();
  private metrics: LiveStageMetrics = {
    fps: 0,
    bitrateMbps: 0,
    encoderMime: "uninitialized",
    totalChunks: 0,
    pointerEventsCount: 0,
    cameraSmoothingDelta: 0,
    activeWindowsCount: 0,
    canvasRenderTimeMs: 0,
  };

  /**
   * Records a timestamped diagnostic event.
   */
  log(category: DiagnosticCategory, message: string, data?: Record<string, unknown>): DiagnosticTrace {
    const now = Date.now();
    const d = new Date(now);
    const timeFormatted = `${d.toTimeString().split(" ")[0]}.${d.getMilliseconds().toString().padStart(3, "0")}`;

    const trace: DiagnosticTrace = {
      id: `trace-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestampMs: now,
      timeFormatted,
      category,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
    };

    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(trace);
      } catch {
        // Safe from listener errors
      }
    }

    return trace;
  }

  updateMetrics(partial: Partial<LiveStageMetrics>): void {
    this.metrics = { ...this.metrics, ...partial };
  }

  getMetrics(): LiveStageMetrics {
    return { ...this.metrics };
  }

  getTraces(): DiagnosticTrace[] {
    return [...this.traces];
  }

  clear(): void {
    this.traces = [];
  }

  subscribe(listener: (trace: DiagnosticTrace) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        metrics: this.metrics,
        traceCount: this.traces.length,
        traces: this.traces,
      },
      null,
      2
    );
  }
}

export const stageDiagnostics = new StageDiagnosticsEngine();
