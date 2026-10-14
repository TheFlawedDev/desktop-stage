import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector } from './components/Inspector';
import { StageWindowView } from './components/StageWindowView';
import { Timeline } from './components/Timeline';
import { DURATION_MS, WINDOW_PRESETS, createStarterProject } from './data/starterProject';
import { useProjectStorage } from './hooks/useProjectStorage';
import type { DragState, Keyframe, Project, StageWindow, WindowKind } from './types';
import { clamp, createWindowId, formatTime, getAnimatedValues, interpolateWindow, isProject } from './utils/project';
import './styles.css';

function downloadProject(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'desktop-stage-project.json';
  link.click();
  // Waiting lets the browser begin the download before this temporary URL disappears.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function createWindow(kind: WindowKind, count: number, z: number): StageWindow {
  return { id: createWindowId(), kind, ...WINDOW_PRESETS[kind], x: 300 + (count * 22) % 180, y: 150 + (count * 27) % 160, width: 290, height: 210, opacity: 1, scale: 1, z };
}

/** Renumbering z values guarantees a stable visual order after layer changes. */
function withNormalizedLayers(windows: StageWindow[]): StageWindow[] {
  return [...windows].sort((left, right) => left.z - right.z).map((window, z) => ({ ...window, z }));
}

function App() {
  const [project, setProject] = useProjectStorage();
  const [selectedId, setSelectedId] = useState('browser');
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState('Starter scene loaded');
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<DragState | null>(null);
  const playStart = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0;
    const tick = (now: number) => {
      if (playStart.current === null) playStart.current = now - playhead;
      const next = now - playStart.current;
      if (next >= DURATION_MS) { setPlayhead(DURATION_MS); setPlaying(false); playStart.current = null; return; }
      setPlayhead(next);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [playing]);

  const selected = project.windows.find((window) => window.id === selectedId) ?? project.windows[0];
  const rendered = useMemo(() => new Map(project.windows.map((window) => [window.id, interpolateWindow(window, project.keyframes[window.id], playhead)])), [project, playhead]);
  const updateWindow = (id: string, patch: Partial<StageWindow>) => setProject((current) => ({ ...current, windows: current.windows.map((window) => window.id === id ? { ...window, ...patch } : window) }));

  const addWindow = (kind: WindowKind) => {
    const window = createWindow(kind, project.windows.length + 1, project.windows.length);
    setProject((current) => ({ ...current, windows: [...current.windows, window] }));
    setSelectedId(window.id);
    setMessage(`Added ${kind} window`);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: createWindowId(), title: `${selected.title} copy`, x: selected.x + 28, y: selected.y + 28, z: project.windows.length };
    setProject((current) => ({ ...current, windows: withNormalizedLayers([...current.windows, copy]) }));
    setSelectedId(copy.id);
    setMessage('Window duplicated');
  };
  const remove = () => {
    if (!selected || project.windows.length === 1) return;
    const remaining = project.windows.filter((window) => window.id !== selected.id);
    setProject((current) => ({ ...current, windows: withNormalizedLayers(remaining), keyframes: Object.fromEntries(Object.entries(current.keyframes).filter(([id]) => id !== selected.id)) }));
    setSelectedId(remaining[0].id);
    setMessage('Window removed');
  };
  const addKeyframe = () => {
    if (!selected) return;
    const values = rendered.get(selected.id) ?? getAnimatedValues(selected);
    setProject((current) => {
      const frames = current.keyframes[selected.id] ?? [];
      const closeFrame = frames.findIndex((frame) => Math.abs(frame.time - playhead) < 120);
      const keyframe: Keyframe = { time: Math.round(playhead), values };
      const nextFrames = [...frames];
      if (closeFrame >= 0) nextFrames[closeFrame] = keyframe;
      else nextFrames.push(keyframe);
      return { ...current, keyframes: { ...current.keyframes, [selected.id]: nextFrames.sort((left, right) => left.time - right.time) } };
    });
    setMessage(`Keyframe set at ${formatTime(playhead)}`);
  };
  const importProject = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value: unknown = JSON.parse(String(reader.result));
        if (!isProject(value)) throw new Error('Invalid project');
        setProject({ ...value, windows: withNormalizedLayers(value.windows) });
        setSelectedId(value.windows[0]?.id ?? '');
        setMessage('Project imported');
      } catch { setMessage('Could not import: choose a valid Desktop Stage project JSON file.'); }
    };
    reader.readAsText(file);
  };
  const reset = () => { setProject(createStarterProject()); setSelectedId('browser'); setPlayhead(0); setPlaying(false); setMessage('Starter scene restored'); };
  const pointerDown = (event: PointerEvent, id: string, mode: DragState['mode']) => {
    if (playing) return;
    event.stopPropagation();
    const window = project.windows.find((item) => item.id === id);
    if (!window) return;
    setSelectedId(id);
    drag.current = { id, mode, startX: event.clientX, startY: event.clientY, values: rendered.get(id) ?? getAnimatedValues(window) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const patch = state.mode === 'move' ? { x: clamp(state.values.x + dx, -180, 930), y: clamp(state.values.y + dy, -120, 540) } : { width: clamp(state.values.width + dx, 180, 700), height: clamp(state.values.height + dy, 110, 500) };
    updateWindow(state.id, patch);
  };
  const changeLayer = (direction: number) => {
    if (!selected) return;
    setProject((current) => {
      const sorted = withNormalizedLayers(current.windows);
      const index = sorted.findIndex((window) => window.id === selected.id);
      const nextIndex = clamp(index + direction, 0, sorted.length - 1);
      [sorted[index], sorted[nextIndex]] = [sorted[nextIndex], sorted[index]];
      return { ...current, windows: withNormalizedLayers(sorted.map((window, z) => ({ ...window, z }))) };
    });
  };
  const togglePreview = () => {
    if (playing) { setPlaying(false); playStart.current = null; return; }
    if (playhead >= DURATION_MS) setPlayhead(0);
    playStart.current = null;
    setPlaying(true);
  };

  return <main>
    <header className="topbar"><div className="brand"><span className="brand-mark">✦</span><span>Desktop Stage</span><em>prototype</em></div><div className="project-status"><span className="save-dot" /> Saved locally · {message}</div><div className="header-actions"><button onClick={reset}>Reset scene</button><button onClick={() => fileInput.current?.click()}>Import</button><button className="primary" onClick={() => { downloadProject(project); setMessage('Project exported'); }}>Export project</button><input ref={fileInput} onChange={(event) => importProject(event.target.files?.[0])} type="file" accept="application/json" hidden /></div></header>
    <section className="workspace">
      <aside className="library panel"><div className="panel-title">WINDOWS <span>{project.windows.length}</span></div><button className="add-button" onClick={() => addWindow('browser')}>＋ Browser</button><button className="add-button" onClick={() => addWindow('code')}>＋ Code / terminal</button><button className="add-button" onClick={() => addWindow('note')}>＋ Text window</button><div className="window-list">{[...project.windows].sort((left, right) => right.z - left.z).map((window) => <button key={window.id} className={`window-item ${window.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(window.id)}><i style={{ background: window.color }} /><span>{window.title}</span><small>{window.kind}</small></button>)}</div><div className="library-tip">Tip: drag any title bar to move a window. The corner handle resizes it.</div></aside>
      <section className="stage-area"><div className="stage-toolbar"><span>SCENE 01 / DESKTOP</span><div><button onClick={() => setPlayhead(0)}>↺</button><button className="play" onClick={togglePreview}>{playing ? '❚❚ Pause' : '▶ Preview'}</button><span className="timecode">{formatTime(playhead)} / 00:20</span></div></div><div className="stage-frame"><div className="desktop" onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>{[...project.windows].sort((left, right) => left.z - right.z).map((window) => <StageWindowView key={window.id} window={window} values={rendered.get(window.id)!} selected={selectedId === window.id} onSelect={() => setSelectedId(window.id)} onPointerDown={pointerDown} />)}<div className="dock"><span>◉</span><span>⌘</span><span>◈</span><span>◌</span></div></div></div></section>
      <Inspector selected={selected} onUpdate={updateWindow} onDuplicate={duplicate} onLayerChange={changeLayer} onDelete={remove} />
    </section>
    <Timeline project={project} selected={selected} playhead={playhead} playing={playing} onPlay={togglePreview} onKeyframe={addKeyframe} onPlayheadChange={setPlayhead} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
