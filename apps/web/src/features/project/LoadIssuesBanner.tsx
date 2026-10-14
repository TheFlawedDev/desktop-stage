"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { Button } from "@cutaway/ui";
import { useEditorStore } from "@/state/editorStore";
import { useProject } from "./ProjectProvider";

/**
 * Reports what a project load repaired or discarded.
 *
 * Loading is deliberately forgiving — a corrupt clip is dropped so the rest of
 * the project still opens. But silently losing part of someone's work would be
 * indefensible, so every repair is stated plainly and stays on screen until it
 * is acknowledged.
 *
 * The heading is deliberately neutral about whether a project opened: this
 * banner is also where a rejected file lands ("Unrecognized project file",
 * "File is not valid JSON"), and telling someone their project "opened with 1
 * issue" when nothing was opened is worse than saying nothing.
 */
export function LoadIssuesBanner() {
  const { loadIssues, dismissIssues } = useProject();
  const pruneOrphanedActions = useEditorStore((state) => state.pruneOrphanedActions);

  if (loadIssues.length === 0) return null;

  const hasOrphanedActions = loadIssues.some((issue) =>
    issue.includes("Action targets app instance")
  );

  const handlePrune = () => {
    pruneOrphanedActions();
    dismissIssues();
  };

  return (
    <div className="absolute bottom-10 left-1/2 z-40 w-[min(560px,90vw)] -translate-x-1/2">
      <div className="border-warning/40 bg-surface-overlay shadow-popover rounded-md border p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-text-primary text-xs font-medium">
                Load reported {loadIssues.length} issue{loadIssues.length === 1 ? "" : "s"}
              </p>
              {hasOrphanedActions && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Trash2 size={12} />}
                  onClick={handlePrune}
                >
                  Remove Orphaned Actions
                </Button>
              )}
            </div>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
              {loadIssues.map((issue, index) => (
                <li key={index} className="text-2xs text-text-secondary">
                  {issue}
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={dismissIssues}
            aria-label="Dismiss"
            className="text-text-tertiary hover:text-text-primary shrink-0 rounded-xs p-0.5"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
