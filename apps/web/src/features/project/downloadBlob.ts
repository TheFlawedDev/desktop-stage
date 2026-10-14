"use client";

/**
 * Hands a generated blob to the browser as a download.
 *
 * Two details here are load-bearing:
 *
 * - The anchor is attached to the document before it is clicked. Safari ignores
 *   a click on a detached anchor, so a "downloaded" file that never appears is
 *   the failure mode avoided by the two extra lines.
 * - The object URL is revoked *after* the click, on a later task rather than
 *   synchronously. Every object URL pins its blob in memory until revoked, but
 *   revoking inside the click handler can cancel the download in browsers that
 *   resolve the URL after the handler returns. A short delay is the middle
 *   ground: the blob is released promptly, and the download has already begun.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
