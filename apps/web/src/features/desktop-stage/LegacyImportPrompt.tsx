"use client";

import { AlertTriangle, FolderOpen } from "lucide-react";
import { Button } from "@cutaway/ui";
import { useProject } from "@/features/project/ProjectProvider";

/**
 * The explicit offer to import a prototype project found in `localStorage`.
 *
 * A banner rather than a modal, on purpose: it never traps the user in a
 * decision they did not ask for, and every edit stays available while it is on
 * screen. It asks once — declining is recorded — and the old stored value is
 * never rewritten or deleted.
 *
 * Nothing about this depends on the origin the app is served from. On a
 * different port the old key is simply a different origin's storage and is
 * unreadable, so no offer appears at all; the sentence users need in that case
 * is the one at the bottom pointing at the manual v1 JSON import in the
 * toolbar.
 */
export function LegacyImportPrompt() {
  const { legacyImport } = useProject();
  const { status, error, accept, decline } = legacyImport;

  if (status === "idle") return null;

  const busy = status === "importing";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center px-4">
      <div
        role="dialog"
        aria-label="Import saved Desktop Stage version 1 project"
        className="border-border-default bg-surface-overlay shadow-popover pointer-events-auto w-[min(560px,90vw)] rounded-md border p-3"
      >
        <div className="flex items-start gap-2">
          <FolderOpen size={14} className="text-accent mt-0.5 shrink-0" />

          <div className="min-w-0 flex-1">
            <p className="text-text-primary text-xs font-medium">
              Import your saved version 1 project?
            </p>
            <p className="text-text-secondary mt-1 text-2xs">
              This browser still has a Desktop Stage version 1 project in local storage. Importing
              converts it, saves it to your project library, and replaces what is open now. The
              stored version 1 copy is left exactly as it was.
            </p>

            {error && (
              <p className="text-warning mt-1 flex items-start gap-1 text-2xs">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <p className="text-text-tertiary mt-1 text-2xs">
              On a different address that storage is not visible; an exported version 1 JSON file
              can still be opened with the folder button in the toolbar.
            </p>

            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void accept()}>
                {busy ? "Importing…" : "Import project"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={decline}>
                Don&apos;t import
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
