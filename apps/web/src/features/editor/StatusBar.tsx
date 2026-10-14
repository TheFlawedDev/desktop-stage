"use client";

import { WifiOff } from "lucide-react";
import { formatDuration } from "@cutaway/timeline-engine";
import { useEditorStore } from "@/state/editorStore";
import { SaveIndicator } from "@/features/project/SaveIndicator";
import { useProject } from "@/features/project/ProjectProvider";
import { formatByteSize } from "@/features/project/projectFiles";

export function StatusBar() {
  const duration = useEditorStore((state) => state.project.durationFrames);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const clipCount = useEditorStore((state) => Object.keys(state.project.entities.clips).length);
  // The size of the last `.desktopstage` written or read, once there is one.
  // The banner says it too, but the banner is dismissible and "how big was that
  // file?" is a question people come back to.
  const lastArchiveBytes = useProject().archive.lastArchiveBytes;

  return (
    <footer className="border-border-subtle bg-surface-panel text-2xs text-text-tertiary flex h-(--size-statusbar-height) shrink-0 items-center gap-3 border-t px-3">
      {/* Stated plainly and permanently: this is the project's core promise, so
          it belongs in the chrome, not in a marketing page. */}
      <span className="flex items-center gap-1">
        <WifiOff size={11} />
        Local only — no account, no upload
      </span>

      <div className="bg-border-subtle h-3 w-px" />

      <span className="tabular">
        {clipCount} {clipCount === 1 ? "clip" : "clips"}
      </span>
      <span className="tabular">{formatDuration(duration, fps)}</span>

      {lastArchiveBytes !== null && (
        <>
          <div className="bg-border-subtle h-3 w-px" />
          <span className="tabular">Archive {formatByteSize(lastArchiveBytes)}</span>
        </>
      )}

      <div className="flex-1" />

      <SaveIndicator />
    </footer>
  );
}
