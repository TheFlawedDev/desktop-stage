import { describe, expect, it } from "vitest";
import { DESKTOP_CONTENT_TYPES, staticValue, type ProjectDocument } from "@cutaway/types";
import { createClip, createTrack } from "@cutaway/utils";
import { createDesktopProject, createDesktopTrack, parseDesktopContent } from "../project";
import { resolveDesktopFrame } from "../resolveDesktopFrame";
import { createStarterProject } from "../starterProject";

describe("trackMouse action validation", () => {
  it("parses a valid trackMouse payload with full parameters", () => {
    const parsed = parseDesktopContent(DESKTOP_CONTENT_TYPES.action, {
      action: "trackMouse",
      zoom: 2.0,
      smoothingMs: 250,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.family).toBe("action");
    expect(parsed.payload).toEqual({
      action: "trackMouse",
      instanceId: undefined,
      zoom: 2.0,
      smoothingMs: 250,
    });
  });

  it("parses a valid trackMouse payload with minimal parameters", () => {
    const parsed = parseDesktopContent(DESKTOP_CONTENT_TYPES.action, {
      action: "trackMouse",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toEqual({
      action: "trackMouse",
      instanceId: undefined,
      zoom: undefined,
      smoothingMs: undefined,
    });
  });

  it("rejects zoom < 1.0", () => {
    const parsed = parseDesktopContent(DESKTOP_CONTENT_TYPES.action, {
      action: "trackMouse",
      zoom: 0.8,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe("malformed");
    expect(parsed.message).toContain("zoom");
  });

  it("rejects negative smoothingMs", () => {
    const parsed = parseDesktopContent(DESKTOP_CONTENT_TYPES.action, {
      action: "trackMouse",
      smoothingMs: -50,
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe("malformed");
    expect(parsed.message).toContain("smoothingMs");
  });

  it("rejects non-numeric zoom", () => {
    const parsed = parseDesktopContent(DESKTOP_CONTENT_TYPES.action, {
      action: "trackMouse",
      zoom: "fast",
    });

    expect(parsed.ok).toBe(false);
  });
});

describe("resolveDesktopFrame with trackMouse action", () => {
  function createProjectWithActionAndVideo(): {
    project: ProjectDocument;
    actionClipId: string;
    videoClipId: string;
  } {
    const project = createStarterProject();
    const actionTrack = project.entities.tracks["track-action"];
    if (!actionTrack) throw new Error("Missing track-action in starter project");

    // Add a video track with a video clip covering frames 10..90
    const videoTrack = createTrack({ id: "track-video", kind: "video", index: 1 });
    const videoClip = createClip({
      id: "clip-video-take",
      trackId: videoTrack.id,
      startFrame: 10,
      durationFrames: 80,
      content: {
        kind: "video",
        mediaId: "media-rec-1",
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(1),
        muted: false,
      },
    });

    // Add a trackMouse action clip covering frames 30..60 (duration 30)
    const actionClip = createClip({
      id: "clip-track-mouse",
      trackId: actionTrack.id,
      startFrame: 30,
      durationFrames: 30,
      content: {
        kind: "plugin",
        contentType: DESKTOP_CONTENT_TYPES.action,
        data: {
          action: "trackMouse",
          zoom: 1.5,
          smoothingMs: 180,
        },
      },
    });

    const enrichedProject: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        tracks: {
          ...project.entities.tracks,
          [videoTrack.id]: videoTrack,
        },
        clips: {
          ...project.entities.clips,
          [videoClip.id]: videoClip,
          [actionClip.id]: actionClip,
        },
      },
      trackOrder: [...project.trackOrder, videoTrack.id],
    };

    return {
      project: enrichedProject,
      actionClipId: actionClip.id,
      videoClipId: videoClip.id,
    };
  }

  it("evaluates camera as inactive before the action start frame", () => {
    const { project } = createProjectWithActionAndVideo();
    const resolved = resolveDesktopFrame(project, 20);

    expect(resolved.camera).toBeDefined();
    expect(resolved.camera.active).toBe(false);
    expect(resolved.camera.zoom).toBe(1.0);
  });

  it("evaluates camera as active during the action range [30, 60)", () => {
    const { project, actionClipId, videoClipId } = createProjectWithActionAndVideo();

    // At start frame
    const resolved30 = resolveDesktopFrame(project, 30);
    expect(resolved30.camera.active).toBe(true);
    expect(resolved30.camera.zoom).toBe(1.5);
    expect(resolved30.camera.smoothingMs).toBe(180);
    expect(resolved30.camera.targetVideoClipId).toBe(videoClipId);
    expect(resolved30.camera.actionClipId).toBe(actionClipId);

    // In the middle
    const resolved45 = resolveDesktopFrame(project, 45);
    expect(resolved45.camera.active).toBe(true);
    expect(resolved45.camera.zoom).toBe(1.5);
    expect(resolved45.camera.targetVideoClipId).toBe(videoClipId);
  });

  it("evaluates camera as inactive after the action duration ends at frame 60", () => {
    const { project } = createProjectWithActionAndVideo();

    const resolved60 = resolveDesktopFrame(project, 60);
    expect(resolved60.camera.active).toBe(false);
    expect(resolved60.camera.zoom).toBe(1.0);

    const resolved70 = resolveDesktopFrame(project, 70);
    expect(resolved70.camera.active).toBe(false);
    expect(resolved70.camera.zoom).toBe(1.0);
  });

  it("does not report missing-target issue for trackMouse action", () => {
    const { project, actionClipId } = createProjectWithActionAndVideo();
    const resolved = resolveDesktopFrame(project, 40);

    const missingTarget = resolved.issues.filter(
      (issue) => issue.clipId === actionClipId && issue.code === "missing-target",
    );
    expect(missingTarget).toHaveLength(0);
  });

  it("ignores trackMouse action when clip is hidden", () => {
    const { project, actionClipId } = createProjectWithActionAndVideo();
    const hiddenClipProject: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          ...project.entities.clips,
          [actionClipId]: { ...project.entities.clips[actionClipId]!, hidden: true },
        },
      },
    };

    const resolved = resolveDesktopFrame(hiddenClipProject, 45);
    expect(resolved.camera.active).toBe(false);
  });

  it("ignores trackMouse action when action track is hidden", () => {
    const { project } = createProjectWithActionAndVideo();
    const actionTrack = project.entities.tracks["track-action"]!;
    const hiddenTrackProject: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        tracks: {
          ...project.entities.tracks,
          ["track-action"]: { ...actionTrack, hidden: true },
        },
      },
    };

    const resolved = resolveDesktopFrame(hiddenTrackProject, 45);
    expect(resolved.camera.active).toBe(false);
  });
});
