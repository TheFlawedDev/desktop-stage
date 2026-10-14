import type { CSSProperties, PointerEvent } from 'react';
import type { AnimatedValues, StageWindow } from '../types';

type Props = {
  window: StageWindow;
  values: AnimatedValues;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent, id: string, mode: 'move' | 'resize') => void;
};

function ContentLines({ content }: { content: string }) {
  return <>{content.split('\n').map((line, index) => <p key={`${line}-${index}`}>{line || '\u00a0'}</p>)}</>;
}

export function StageWindowView({ window, values, selected, onSelect, onPointerDown }: Props) {
  const style = {
    left: values.x,
    top: values.y,
    width: values.width,
    height: values.height,
    opacity: values.opacity,
    zIndex: window.z,
    transform: `scale(${values.scale})`,
    transformOrigin: 'top left',
    '--accent': window.color,
  } as CSSProperties;

  return <article className={`stage-window ${window.kind} ${selected ? 'selected' : ''}`} style={style} onPointerDown={onSelect}>
    <div className="window-titlebar" onPointerDown={(event) => onPointerDown(event, window.id, 'move')}>
      <div className="traffic"><i /><i /><i /></div>
      <span>{window.title}</span><b>•••</b>
    </div>
    {window.kind === 'browser' && <>
      <div className="address"><span>⌕</span><span>studio.local/{window.title.toLowerCase().replace(/ /g, '-')}</span><small>↗</small></div>
      <div className="browser-content"><div className="hero-block" /><h2>{window.title}</h2><ContentLines content={window.content} /></div>
    </>}
    {window.kind === 'code' && <pre>{window.content}</pre>}
    {window.kind === 'note' && <div className="note-content"><ContentLines content={window.content} /><div className="message-box">Write a message <b>⌁</b></div></div>}
    {selected && <div className="resize-handle" onPointerDown={(event) => onPointerDown(event, window.id, 'resize')} />}
  </article>;
}
