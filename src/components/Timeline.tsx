import type { MouseEvent } from 'react';
import { DURATION_MS } from '../data/starterProject';
import { clamp } from '../utils/project';
import type { Project, StageWindow } from '../types';

type Props = { project: Project; selected?: StageWindow; playhead: number; playing: boolean; onPlay: () => void; onKeyframe: () => void; onPlayheadChange: (time: number) => void };

export function Timeline({ project, selected, playhead, playing, onPlay, onKeyframe, onPlayheadChange }: Props) {
  const seek = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onPlayheadChange(clamp(((event.clientX - rect.left) / rect.width) * DURATION_MS, 0, DURATION_MS));
  };
  const frames = selected ? project.keyframes[selected.id] ?? [] : [];

  return <section className="timeline panel">
    <div className="timeline-controls"><button onClick={onPlay}>{playing ? '❚❚' : '▶'}</button><button className="keyframe-button" disabled={!selected} onClick={onKeyframe}>◆ Add / update keyframe</button><span>{selected ? `${selected.title} · ${frames.length} keys` : 'No selection'}</span></div>
    <div className="timeline-track" onClick={seek}>
      <div className="ruler">{[0, 5, 10, 15, 20].map((seconds) => <span key={seconds} style={{ left: `${seconds * 5}%` }}>{`00:${String(seconds).padStart(2, '0')}`}</span>)}</div>
      {frames.map((frame) => <i className="timeline-key" key={frame.time} style={{ left: `${frame.time / DURATION_MS * 100}%` }} />)}
      <div className="playhead" style={{ left: `${playhead / DURATION_MS * 100}%` }}><b /></div>
    </div>
  </section>;
}
