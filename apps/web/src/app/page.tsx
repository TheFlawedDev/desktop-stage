"use client";

import dynamic from "next/dynamic";

const EditorShell = dynamic(
  () => import("@/features/editor/EditorShell").then((mod) => mod.EditorShell),
  { ssr: false }
);

/**
 * The editor is the product, so it lives at `/`.
 *
 * There is no landing page and no sign-in gate by design: `pnpm dev`, open
 * localhost, start editing.
 */
export default function EditorPage() {
  return <EditorShell />;
}
