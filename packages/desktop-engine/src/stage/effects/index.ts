import type { IMouseFollowCamera, Rect, StagePointerEvent } from "@cutaway/types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isValidBaseRect(rect: Rect): boolean {
  return (
    typeof rect === "object" &&
    rect !== null &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    rect.width > 0 &&
    Number.isFinite(rect.height) &&
    rect.height > 0
  );
}

const TAU_MS = 180;

export class MouseFollowCamera implements IMouseFollowCamera {
  computeSmoothedView(
    pointerEvents: StagePointerEvent[],
    frameTimestampMs: number,
    baseStageRect: Rect,
    zoomFactor: number = 1.5,
  ): { viewport: Rect; zoom: number } {
    if (!Number.isFinite(zoomFactor) || zoomFactor < 1) {
      throw new Error(`Invalid zoom factor: ${zoomFactor}`);
    }

    if (!Number.isFinite(frameTimestampMs) || frameTimestampMs < 0) {
      throw new Error(`Invalid frame timestamp: ${frameTimestampMs}`);
    }

    if (!isValidBaseRect(baseStageRect)) {
      throw new Error("Invalid base stage rect");
    }

    const viewportWidth = baseStageRect.width / zoomFactor;
    const viewportHeight = baseStageRect.height / zoomFactor;
    const halfW = viewportWidth / 2;
    const halfH = viewportHeight / 2;

    const baseCenterX = baseStageRect.x + baseStageRect.width / 2;
    const baseCenterY = baseStageRect.y + baseStageRect.height / 2;

    // Filter valid pointer events that occurred at or before frameTimestampMs
    const validEvents: StagePointerEvent[] = [];
    for (const ev of pointerEvents) {
      if (
        ev &&
        typeof ev === "object" &&
        ev.pos &&
        typeof ev.pos === "object" &&
        Number.isFinite(ev.timestampMs) &&
        ev.timestampMs >= 0 &&
        ev.timestampMs <= frameTimestampMs &&
        Number.isFinite(ev.pos.x) &&
        Number.isFinite(ev.pos.y)
      ) {
        validEvents.push(ev);
      }
    }

    if (validEvents.length === 0) {
      return {
        viewport: {
          x: baseCenterX - halfW,
          y: baseCenterY - halfH,
          width: viewportWidth,
          height: viewportHeight,
        },
        zoom: zoomFactor,
      };
    }

    // Sort chronologically
    validEvents.sort((a, b) => a.timestampMs - b.timestampMs);

    let cx = baseCenterX;
    let cy = baseCenterY;

    const firstEvent = validEvents[0]!;
    let currentTime = firstEvent.timestampMs;
    let targetX = clamp(
      firstEvent.pos.x,
      baseStageRect.x,
      baseStageRect.x + baseStageRect.width,
    );
    let targetY = clamp(
      firstEvent.pos.y,
      baseStageRect.y,
      baseStageRect.y + baseStageRect.height,
    );

    for (let i = 1; i < validEvents.length; i++) {
      const ev = validEvents[i]!;
      const dt = ev.timestampMs - currentTime;
      if (dt > 0) {
        const decay = Math.exp(-dt / TAU_MS);
        cx = targetX + (cx - targetX) * decay;
        cy = targetY + (cy - targetY) * decay;
        currentTime = ev.timestampMs;
      }
      targetX = clamp(
        ev.pos.x,
        baseStageRect.x,
        baseStageRect.x + baseStageRect.width,
      );
      targetY = clamp(
        ev.pos.y,
        baseStageRect.y,
        baseStageRect.y + baseStageRect.height,
      );
    }

    const finalDt = frameTimestampMs - currentTime;
    if (finalDt > 0) {
      const decay = Math.exp(-finalDt / TAU_MS);
      cx = targetX + (cx - targetX) * decay;
      cy = targetY + (cy - targetY) * decay;
    }

    // Clamp viewport inside baseStageRect
    const minCenterX = baseStageRect.x + halfW;
    const maxCenterX = baseStageRect.x + baseStageRect.width - halfW;
    const minCenterY = baseStageRect.y + halfH;
    const maxCenterY = baseStageRect.y + baseStageRect.height - halfH;

    const clampedCenterX = clamp(cx, minCenterX, maxCenterX);
    const clampedCenterY = clamp(cy, minCenterY, maxCenterY);

    return {
      viewport: {
        x: clampedCenterX - halfW,
        y: clampedCenterY - halfH,
        width: viewportWidth,
        height: viewportHeight,
      },
      zoom: zoomFactor,
    };
  }
}
