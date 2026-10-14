import type { AnimatedValues, Keyframe, Project, StageWindow } from '../types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const createWindowId = () => `window-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function getAnimatedValues(window: StageWindow): AnimatedValues {
  const { x, y, width, height, opacity, scale } = window;
  return { x, y, width, height, opacity, scale };
}

export function formatTime(time: number): string {
  return `${String(Math.floor(time / 1000)).padStart(2, '0')}:${String(Math.floor((time % 1000) / 100)).padStart(1, '0')}`;
}

/** Returns the eased state between the closest saved keyframes. */
export function interpolateWindow(window: StageWindow, frames: Keyframe[] | undefined, time: number): AnimatedValues {
  if (!frames?.length) return getAnimatedValues(window);

  const ordered = [...frames].sort((a, b) => a.time - b.time);
  const after = ordered.find((frame) => frame.time >= time);
  const before = [...ordered].reverse().find((frame) => frame.time <= time);

  if (!before) return after!.values;
  if (!after || before.time === after.time) return before.values;

  const progress = (time - before.time) / (after.time - before.time);
  const eased = progress * progress * (3 - 2 * progress);
  const values = {} as AnimatedValues;

  (Object.keys(before.values) as (keyof AnimatedValues)[]).forEach((key) => {
    values[key] = before.values[key] + (after.values[key] - before.values[key]) * eased;
  });

  return values;
}

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<Project>;
  if (project.version !== 1 || !Array.isArray(project.windows) || !project.keyframes || typeof project.keyframes !== 'object') return false;

  const validWindow = (window: unknown): window is StageWindow => {
    if (!window || typeof window !== 'object') return false;
    const value = window as Partial<StageWindow>;
    const numberFields: (keyof AnimatedValues | 'z')[] = ['x', 'y', 'width', 'height', 'opacity', 'scale', 'z'];
    return typeof value.id === 'string' && ['browser', 'code', 'note'].includes(String(value.kind)) &&
      typeof value.title === 'string' && typeof value.content === 'string' && typeof value.color === 'string' &&
      numberFields.every((field) => typeof value[field] === 'number' && Number.isFinite(value[field] as number));
  };
  const validKeyframe = (frame: unknown): frame is Keyframe => {
    if (!frame || typeof frame !== 'object') return false;
    const value = frame as Partial<Keyframe>;
    return typeof value.time === 'number' && Number.isFinite(value.time) && !!value.values &&
      ['x', 'y', 'width', 'height', 'opacity', 'scale'].every((field) => typeof value.values?.[field as keyof AnimatedValues] === 'number' && Number.isFinite(value.values[field as keyof AnimatedValues]));
  };
  return project.windows.every(validWindow) && Object.values(project.keyframes).every((frames) => Array.isArray(frames) && frames.every(validKeyframe));
}
