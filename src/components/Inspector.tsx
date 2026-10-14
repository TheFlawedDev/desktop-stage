import type { StageWindow } from '../types';

type Props = {
  selected?: StageWindow;
  onUpdate: (id: string, patch: Partial<StageWindow>) => void;
  onDuplicate: () => void;
  onLayerChange: (direction: number) => void;
  onDelete: () => void;
};

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

export function Inspector({ selected, onUpdate, onDuplicate, onLayerChange, onDelete }: Props) {
  if (!selected) return <aside className="inspector panel"><div className="empty">Select a window to edit it.</div></aside>;

  return <aside className="inspector panel">
    <div className="panel-title">INSPECTOR <span>{selected.kind}</span></div>
    <div className="inspector-heading"><i style={{ background: selected.color }} />{selected.title}</div>
    <label>Window title<input value={selected.title} onChange={(event) => onUpdate(selected.id, { title: event.target.value })} /></label>
    <label>Content<textarea value={selected.content} onChange={(event) => onUpdate(selected.id, { content: event.target.value })} /></label>
    <div className="field-row">
      <label>Accent<input type="color" value={selected.color} onChange={(event) => onUpdate(selected.id, { color: event.target.value })} /></label>
      <label>Opacity <output>{Math.round(selected.opacity * 100)}%</output><input type="range" min="0.15" max="1" step="0.05" value={selected.opacity} onChange={(event) => onUpdate(selected.id, { opacity: Number(event.target.value) })} /></label>
    </div>
    <div className="field-row"><NumberField label="X" value={selected.x} onChange={(x) => onUpdate(selected.id, { x })} /><NumberField label="Y" value={selected.y} onChange={(y) => onUpdate(selected.id, { y })} /></div>
    <div className="field-row"><NumberField label="Width" value={selected.width} onChange={(width) => onUpdate(selected.id, { width })} /><NumberField label="Height" value={selected.height} onChange={(height) => onUpdate(selected.id, { height })} /></div>
    <label>Scale <output>{selected.scale.toFixed(2)}×</output><input type="range" min="0.5" max="1.5" step="0.05" value={selected.scale} onChange={(event) => onUpdate(selected.id, { scale: Number(event.target.value) })} /></label>
    <div className="action-grid"><button onClick={onDuplicate}>Duplicate</button><button onClick={() => onLayerChange(1)}>Bring forward</button><button onClick={() => onLayerChange(-1)}>Send back</button><button className="danger" onClick={onDelete}>Delete</button></div>
  </aside>;
}
