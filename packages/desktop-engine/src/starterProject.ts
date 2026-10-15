/**
 * The project a new editor session opens with.
 *
 * It is the prototype's four-window scene, converted through the same
 * {@link convertV1Project} path a user's saved project takes — so the starter
 * scene is also a constantly exercised example of the migration, and there is no
 * second, hand-maintained copy of "what the demo looks like".
 *
 * Two authored action clips are added on top of the conversion to show what the
 * action row is for: both target an app by `instanceId`, which is the contract
 * every later action feature relies on.
 */

import type { Clip, DesktopStandardActionKind, DesktopStandardActionPayload, ProjectDocument } from "@cutaway/types";
import { DESKTOP_CONTENT_TYPES } from "@cutaway/types";
import { createClip, createId } from "@cutaway/utils";
import starterFixture from "./__fixtures__/v1-starter-project.json";
import { convertV1Project, V1_ACTION_TRACK_ID, V1_DURATION_FRAMES, V1_DESKTOP_TRACK_ID } from "./migrateV1";
import { isV1Project } from "./v1";
import type { V1Project } from "./v1-types";

export const STARTER_PROJECT_NAME = "Desktop Stage starter";
export const STARTER_FRAME_RATE = 30;
/** 600 frames at 30 fps — the prototype's 20 seconds, now expressible. */
export const STARTER_DURATION_FRAMES = V1_DURATION_FRAMES;

interface StarterAction {
  id: string;
  instanceId: string;
  startFrame: number;
  durationFrames: number;
  action: DesktopStandardActionKind;
  text?: string;
}

/**
 * Authored actions for the starter scene.
 *
 * `focus` raises its app to the front for the clip's duration, then lets it fall
 * back to its authored z-order — the same half-open range rule every other clip
 * follows.
 */
const STARTER_ACTIONS: readonly StarterAction[] = [
  {
    id: "action-focus-terminal",
    instanceId: "app-terminal",
    startFrame: 90,
    durationFrames: 30,
    action: "focus",
  },
  {
    id: "action-rename-browser",
    instanceId: "app-browser",
    startFrame: 240,
    durationFrames: 90,
    action: "setTitle",
    text: "Studio Dashboard — live",
  },
  {
    id: "action-focus-browser",
    instanceId: "app-browser",
    startFrame: 360,
    durationFrames: 60,
    action: "focus",
  },
];

/**
 * The bundled v1 fixture, validated on first use.
 *
 * The check lives here rather than in the converter so that a corrupted fixture
 * fails loudly at the point it is read instead of producing a subtly wrong demo
 * scene.
 */
export function starterV1Project(): V1Project {
  const candidate: unknown = starterFixture;
  if (!isV1Project(candidate)) {
    throw new Error("The bundled v1 starter fixture is not a valid version 1 project.");
  }
  return candidate;
}

function createActionClip(action: StarterAction): Clip {
  const payload: DesktopStandardActionPayload = {
    instanceId: action.instanceId,
    action: action.action,
    ...(action.text ? { text: action.text } : {}),
  };

  return createClip({
    id: action.id,
    name: action.action,
    trackId: V1_ACTION_TRACK_ID,
    startFrame: action.startFrame,
    durationFrames: action.durationFrames,
    content: {
      kind: "plugin",
      contentType: DESKTOP_CONTENT_TYPES.action,
      data: payload as unknown as Record<string, unknown>,
    },
  });
}

/**
 * Builds the starter scene. Fresh objects every call, safe to mutate.
 *
 * The project **id** is fresh on every call, while every id inside the scene —
 * tracks, clips, and app instances — stays deterministic. That split matters for
 * persistence: the store keys records by `project.id`, so two projects sharing
 * the starter's id would overwrite each other. Minting an id here means "New
 * project" (and a cold start) can never collide with a project already saved,
 * and the conversion path stays reproducible for the same scene.
 */
export function createStarterProject(): ProjectDocument {
  const converted = convertV1Project(starterV1Project(), {
    name: STARTER_PROJECT_NAME,
    projectId: createId("project"),
  });

  const clips = { ...converted.entities.clips };
  for (const action of STARTER_ACTIONS) clips[action.id] = createActionClip(action);

  return {
    ...converted,
    entities: { ...converted.entities, clips },
    // Spelled out rather than derived: the desktop row is the one that draws,
    // and the action row sits under it as metadata.
    trackOrder: [V1_DESKTOP_TRACK_ID, V1_ACTION_TRACK_ID],
    durationFrames: STARTER_DURATION_FRAMES,
  };
}
