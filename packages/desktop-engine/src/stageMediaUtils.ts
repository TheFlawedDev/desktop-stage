/**
 * Utilities for stage media file classification, formatting badges,
 * and high-resolution dynamic DPR calculation for canvas recording.
 */

export type MediaKind = "video" | "audio" | "image" | "document";

export interface ClassifiedMedia {
  kind: MediaKind;
  badge: "MP4" | "WEBM" | "MOV" | "MKV" | "AUDIO" | "IMG" | "DOC";
  mimeType: string;
}

/**
 * Classifies an incoming OS dropped or imported media file by extension.
 */
export function classifyMediaFile(filename: string): ClassifiedMedia {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  switch (ext) {
    case "mp4":
      return { kind: "video", badge: "MP4", mimeType: "video/mp4" };
    case "webm":
      return { kind: "video", badge: "WEBM", mimeType: "video/webm" };
    case "mov":
      return { kind: "video", badge: "MOV", mimeType: "video/quicktime" };
    case "mkv":
      return { kind: "video", badge: "MKV", mimeType: "video/x-matroska" };
    case "mp3":
      return { kind: "audio", badge: "AUDIO", mimeType: "audio/mpeg" };
    case "wav":
      return { kind: "audio", badge: "AUDIO", mimeType: "audio/wav" };
    case "png":
      return { kind: "image", badge: "IMG", mimeType: "image/png" };
    case "jpg":
    case "jpeg":
      return { kind: "image", badge: "IMG", mimeType: "image/jpeg" };
    default:
      return { kind: "document", badge: "DOC", mimeType: "text/plain" };
  }
}

/**
 * Computes the optimal dynamic Device Pixel Ratio (DPR) for a selected crop area.
 * For small selected crop areas, this dynamically scales the raster resolution
 * up to 6x so that the recording rasterizes at native 1080p+ vector clarity,
 * completely avoiding upscaling blur or pixelation.
 *
 * Guaranteed range: [2, 6]
 */
export function computeDynamicDpr(cropWidth: number, cropHeight: number): number {
  const safeW = Math.max(1, cropWidth);
  const safeH = Math.max(1, cropHeight);
  const dprX = Math.max(2, Math.ceil(1920 / safeW));
  const dprY = Math.max(2, Math.ceil(1080 / safeH));
  return Math.min(6, Math.max(dprX, dprY));
}
