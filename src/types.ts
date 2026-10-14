export type WindowKind = 'browser' | 'code' | 'note';

export type AnimatedValues = {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  scale: number;
};

export type StageWindow = AnimatedValues & {
  id: string;
  kind: WindowKind;
  title: string;
  content: string;
  color: string;
  z: number;
};

export type Keyframe = { time: number; values: AnimatedValues };

export type Project = {
  version: 1;
  windows: StageWindow[];
  keyframes: Record<string, Keyframe[]>;
};

export type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  values: AnimatedValues;
};
