"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useProject } from "./ProjectProvider";
import { archiveProgressText } from "./projectFiles";

/**
 * Progress and outcome for the portable `.desktopstage` flow.
 *
 * Packing a media-rich project takes real time, and unpacking one writes files
 * to the browser's storage. Both need to say so: a Share click that appears to
 * do nothing for ten seconds invites a second click, and a failed import must
 * state plainly that the open project was left alone — otherwise the obvious
 * fear is that it was damaged.
 *
 * A banner rather than a modal, matching the rest of the shell: the editor
 * stays usable while an archive is read or written.
 */
export function ArchiveStatusBanner() {
  const { archive } = useProject();
  const { phase, progress, notice, dismissNotice } = archive;

  if (phase === "idle" && !notice) return null;

  const busy = phase !== "idle";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-50 flex justify-center px-4">
      <div
        role={busy ? "status" : "alert"}
        aria-live="polite"
        className="border-border-default bg-surface-overlay shadow-popover pointer-events-auto w-[min(560px,90vw)] rounded-md border p-3"
      >
        <div className="flex items-start gap-2">
          {busy ? (
            <Loader2 size={14} className="text-accent mt-0.5 shrink-0 animate-spin" />
          ) : notice?.tone === "error" ? (
            <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
          ) : (
            <Check size={14} className="text-accent mt-0.5 shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-text-primary text-xs font-medium">
              {busy
                ? phase === "exporting"
                  ? "Packing project archive…"
                  : "Opening project archive…"
                : notice?.title}
            </p>

            {busy && (
              <p className="text-text-secondary tabular mt-1 text-2xs">
                {archiveProgressText(progress, phase === "exporting" ? "export" : "import")}
              </p>
            )}

            {!busy && notice && notice.details.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {notice.details.map((detail, index) => (
                  <li key={index} className="text-2xs text-text-secondary">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!busy && (
            <button
              onClick={dismissNotice}
              aria-label="Dismiss"
              className="text-text-tertiary hover:text-text-primary shrink-0 rounded-xs p-0.5"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
