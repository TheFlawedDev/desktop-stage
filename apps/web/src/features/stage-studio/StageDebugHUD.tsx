"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bug,
  X,
  Copy,
  Check,
  Trash2,
  Activity,
  Layers,
  Camera,
  Video,
  Terminal,
  MousePointer,
} from "lucide-react";
import {
  stageDiagnostics,
  type DiagnosticTrace,
  type DiagnosticCategory,
  type LiveStageMetrics,
} from "@desktop-stage/desktop-engine";

interface StageDebugHUDProps {
  onClose: () => void;
  workspaceMode: "interactive" | "preview";
  trackMouseEnabled: boolean;
  isRecording: boolean;
}

export function StageDebugHUD({
  onClose,
  workspaceMode,
  trackMouseEnabled,
  isRecording,
}: StageDebugHUDProps) {
  const [traces, setTraces] = useState<DiagnosticTrace[]>(() =>
    stageDiagnostics.getTraces(),
  );
  const [metrics, setMetrics] = useState<LiveStageMetrics>(() =>
    stageDiagnostics.getMetrics(),
  );
  const [activeFilter, setActiveFilter] = useState<DiagnosticCategory | "ALL">(
    "ALL",
  );
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = stageDiagnostics.subscribe((_newTrace) => {
      setTraces(stageDiagnostics.getTraces());
      setMetrics(stageDiagnostics.getMetrics());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [traces.length]);

  const handleCopyTrace = async () => {
    try {
      const json = stageDiagnostics.exportJson();
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleClear = () => {
    stageDiagnostics.clear();
    setTraces([]);
  };

  const filteredTraces =
    activeFilter === "ALL"
      ? traces
      : traces.filter((t) => t.category === activeFilter);

  const getCategoryColor = (cat: DiagnosticCategory) => {
    switch (cat) {
      case "RECORDER":
        return "text-rose-400 border-rose-500/30 bg-rose-500/10";
      case "CAMERA":
        return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
      case "WM":
        return "text-blue-400 border-blue-500/30 bg-blue-500/10";
      case "SHELL":
        return "text-amber-400 border-amber-500/30 bg-amber-500/10";
      case "UI":
        return "text-purple-400 border-purple-500/30 bg-purple-500/10";
    }
  };

  return (
    <div className="absolute top-3 right-3 z-50 flex w-96 flex-col rounded-lg border border-zinc-700/80 bg-zinc-900/95 font-sans shadow-2xl backdrop-blur-md text-xs select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Bug size={14} className="text-amber-400" />
          <span className="font-semibold text-zinc-100">
            Stage Diagnostics HUD
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400">
            v0.2.0
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyTrace}
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Copy full telemetry log as JSON"
          >
            {copied ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <Copy size={12} />
            )}
            <span>{copied ? "Copied!" : "Export"}</span>
          </button>
          <button
            onClick={handleClear}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Clear traces"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Close HUD"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Live Status Indicators */}
      <div className="grid grid-cols-2 gap-1.5 border-b border-zinc-800 p-2.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Layers size={13} className="text-blue-400 shrink-0" />
          <span className="text-zinc-400">Mode:</span>
          <span className="font-semibold text-zinc-100 uppercase">
            {workspaceMode}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-300">
          <Video
            size={13}
            className={
              isRecording
                ? "text-rose-400 animate-pulse shrink-0"
                : "text-zinc-500 shrink-0"
            }
          />
          <span className="text-zinc-400">Encoder:</span>
          <span className="font-mono text-[10px] text-zinc-200">
            {metrics.fps > 0
              ? `${metrics.fps} FPS · ${metrics.bitrateMbps}M`
              : "60 FPS · 12M"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-300">
          <Camera
            size={13}
            className={
              trackMouseEnabled
                ? "text-emerald-400 shrink-0"
                : "text-zinc-500 shrink-0"
            }
          />
          <span className="text-zinc-400">1.5× Cam:</span>
          <span
            className={`font-semibold ${trackMouseEnabled ? "text-emerald-400" : "text-zinc-500"}`}
          >
            {trackMouseEnabled ? "Active" : "Off"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-300">
          <Activity size={13} className="text-purple-400 shrink-0" />
          <span className="text-zinc-400">Chunks:</span>
          <span className="font-mono text-zinc-100">{metrics.totalChunks}</span>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800/80 px-2 py-1.5 text-[10px]">
        {(["ALL", "RECORDER", "CAMERA", "WM", "SHELL", "UI"] as const).map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
                activeFilter === cat
                  ? "bg-zinc-700 text-zinc-100 shadow-xs"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {cat}
            </button>
          ),
        )}
        <span className="ml-auto text-[10px] font-mono text-zinc-400">
          {filteredTraces.length} traces
        </span>
      </div>

      {/* Microsecond Trace Log Stream */}
      <div
        ref={scrollRef}
        className="flex max-h-56 min-h-36 flex-col overflow-y-auto p-2 font-mono text-[10px] leading-relaxed space-y-1 bg-zinc-950/70"
      >
        {filteredTraces.length === 0 ? (
          <div className="text-center text-zinc-400 py-6 italic font-sans text-xs">
            No diagnostic events logged yet
          </div>
        ) : (
          filteredTraces.slice(-100).map((t) => (
            <div key={t.id} className="flex items-start gap-1.5">
              <span className="text-zinc-400 shrink-0">{t.timeFormatted}</span>
              <span
                className={`rounded border px-1 py-0 text-[9px] font-bold shrink-0 ${getCategoryColor(
                  t.category,
                )}`}
              >
                {t.category}
              </span>
              <span className="text-zinc-300 break-all">{t.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
