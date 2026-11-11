import { memo, useState } from 'react';
import type { Actions, Column, Item, Label, User } from '../types';
import { DROPDOWN_BG, PALETTE, fmtDate, href, isUrl, timeAgo } from '../util';
import { Avatar, Popover } from './Popover';

interface CellProps {
  col: Column;
  item: Item;
  users: User[];
  act: Actions;
  sub?: boolean;
}

function LabelEditor({ col, act, sub, withColor }: { col: Column; act: Actions; sub?: boolean; withColor: boolean }) {
  const labels = col.settings.labels || [];
  const [colorFor, setColorFor] = useState<number | null>(null);
  const save = (next: Label[]) => act.patchColumn(col.id, { settings: { ...col.settings, labels: next } }, sub);
  const add = () => {
    const id = Math.max(-1, ...labels.map((l) => l.id)) + 1;
    const used = new Set(labels.map((l) => l.color));
    save([...labels, { id, name: 'Nueva etiqueta', ...(withColor ? { color: PALETTE.find((c) => !used.has(c)) || PALETTE[0] } : {}) }]);
  };
  return (
    <div className="label-editor">
      {labels.map((l) => (
        <div key={l.id}>
          <div className="label-edit-row">
            {withColor && <button className="swatch" style={{ background: l.color }} onClick={() => setColorFor(colorFor === l.id ? null : l.id)} />}
            <input defaultValue={l.name} onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && save(labels.map((x) => (x.id === l.id ? { ...x, name: e.target.value.trim() } : x)))} />
            <button className="icon-btn" title="Eliminar etiqueta" onClick={() => save(labels.filter((x) => x.id !== l.id))}>
              ✕
            </button>
          </div>
          {colorFor === l.id && (
            <div className="palette">
              {PALETTE.map((c) => (
                <button key={c} className="swatch" style={{ background: c }} onClick={() => { save(labels.map((x) => (x.id === l.id ? { ...x, color: c } : x))); setColorFor(null); }} />
              ))}
            </div>
          )}
        </div>
      ))}
      <button className="menu-item" onClick={add}>
        + Nueva etiqueta
      </button>
    </div>
  );
}

function StatusCell({ col, item, act, sub }: CellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const labels = col.settings.labels || [];
  const cur = labels.find((l) => l.id === item.vals[col.id]);
  const pick = (id: number | null) => {
    act.setVal(item, col.id, id);
    setAnchor(null);
  };
  return (
    <>
      <div className="cell-status" style={{ background: cur?.color || '#c4c4c4' }} onClick={(e) => { setEditing(false); setAnchor(e.currentTarget); }}>
        {cur?.name || ''}
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={220}>
          {editing ? (
            <LabelEditor col={col} act={act} sub={sub} withColor />
          ) : (
            <div className="status-picker">
              {labels.map((l) => (
                <button key={l.id} className="status-option" style={{ background: l.color }} onClick={() => pick(l.id)}>
                  {l.name}
                </button>
              ))}
              <button className="status-option" style={{ background: '#c4c4c4' }} onClick={() => pick(null)}>
                &nbsp;
              </button>
            </div>
          )}
          <button className="menu-item muted" onClick={() => setEditing(!editing)}>
            {editing ? '← Volver' : '✎ Editar etiquetas'}
          </button>
        </Popover>
      )}
    </>
  );
}

function DropdownCell({ col, item, act, sub }: CellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const labels = col.settings.labels || [];
  const ids: number[] = item.vals[col.id] || [];
  const toggle = (id: number) => act.setVal(item, col.id, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const matches = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
  const create = () => {
    const id = Math.max(0, ...labels.map((l) => l.id)) + 1;
    act.patchColumn(col.id, { settings: { ...col.settings, labels: [...labels, { id, name: q.trim() }] } }, sub);
    act.setVal(item, col.id, [...ids, id]);
    setQ('');
  };
  return (
    <>
      <div className="cell-click chips" onClick={(e) => { setEditing(false); setAnchor(e.currentTarget); }}>
        {ids.map((id) => (
          <span key={id} className="chip" style={{ background: DROPDOWN_BG }}>
            {labels.find((l) => l.id === id)?.name}
          </span>
        ))}
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={240}>
          {editing ? (
            <LabelEditor col={col} act={act} sub={sub} withColor={false} />
          ) : (
            <>
              <input autoFocus className="input" placeholder="Buscar o crear…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && !matches.length && create()} />
              <div className="menu-scroll">
                {matches.map((l) => (
                  <button key={l.id} className={'menu-item' + (ids.includes(l.id) ? ' checked' : '')} onClick={() => toggle(l.id)}>
                    <span className="check">{ids.includes(l.id) ? '✓' : ''}</span>
                    {l.name}
                  </button>
                ))}
                {q.trim() && !labels.some((l) => l.name.toLowerCase() === q.trim().toLowerCase()) && (
                  <button className="menu-item" onClick={create}>
                    + Crear «{q.trim()}»
                  </button>
                )}
              </div>
            </>
          )}
          <button className="menu-item muted" onClick={() => setEditing(!editing)}>
            {editing ? '← Volver' : '✎ Editar etiquetas'}
          </button>
        </Popover>
      )}
    </>
  );
}

function PeopleCell({ col, item, users, act }: CellProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const ids: string[] = item.vals[col.id] || [];
  const toggle = (id: string) => act.setVal(item, col.id, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <>
      <div className="cell-click people" onClick={(e) => setAnchor(e.currentTarget)}>
        {ids.length ? ids.map((id) => <Avatar key={id} user={users.find((u) => u.id === id)} />) : <span className="avatar empty">＋</span>}
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={240}>
          <div className="menu-scroll">
            {users.map((u) => (
              <button key={u.id} className={'menu-item' + (ids.includes(u.id) ? ' checked' : '')} onClick={() => toggle(u.id)}>
                <span className="check">{ids.includes(u.id) ? '✓' : ''}</span>
                <Avatar user={u} size={22} /> {u.name}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function InputCell({ col, item, act }: CellProps) {
  const [editing, setEditing] = useState(false);
  const v = item.vals[col.id];
  const type = col.type === 'date' ? 'date' : col.type === 'hour' ? 'time' : col.type === 'numbers' ? 'number' : col.type === 'email' ? 'email' : 'text';
  if (editing) {
    const commit = (raw: string) => {
      setEditing(false);
      const next = raw.trim() === '' ? null : col.type === 'numbers' ? Number(raw) : raw.trim();
      if (next !== (v ?? null) && !(typeof next === 'number' && Number.isNaN(next))) act.setVal(item, col.id, next);
    };
    return (
      <input
        autoFocus
        className="cell-input"
        type={type}
        step="any"
        defaultValue={v ?? ''}
        onFocus={(e) => (type === 'date' || type === 'time') && (e.target as any).showPicker?.()}
        onChange={(e) => {
          // Fecha/hora: guardar apenas el selector entrega un valor completo
          const x = e.target.value;
          if ((type === 'date' && Number(x.slice(0, 4)) >= 1900) || (type === 'time' && x)) act.setVal(item, col.id, x);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  let shown: React.ReactNode = v ?? '';
  if (v != null) {
    if (col.type === 'date') shown = fmtDate(v);
    else if (col.type === 'numbers') shown = `${Number(v).toLocaleString('es-AR')}${col.settings.unit ? ' ' + col.settings.unit : ''}`;
    else if (col.type === 'email') shown = <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>{v}</a>;
    else if (col.type === 'phone') shown = <a href={`tel:+${String(v).replace(/\D/g, '')}`} onClick={(e) => e.stopPropagation()}>{v}</a>;
    else if (col.type === 'link' || isUrl(v))
      shown = (
        <a href={href(String(v))} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {String(v).replace(/^https?:\/\/(www\.)?/, '')}
        </a>
      );
  }
  return (
    <div className={'cell-click cell-text' + (col.type === 'numbers' || col.type === 'date' || col.type === 'hour' ? ' center' : '')} title={typeof v === 'string' ? v : undefined} onClick={() => setEditing(true)}>
      <span className="ellipsis">{shown}</span>
    </div>
  );
}

export const Cell = memo(function Cell(p: CellProps) {
  const { col, item, users, act } = p;
  switch (col.type) {
    case 'status':
      return <StatusCell {...p} />;
    case 'dropdown':
      return <DropdownCell {...p} />;
    case 'people':
      return <PeopleCell {...p} />;
    case 'checkbox':
      return (
        <div className="cell-click center" onClick={() => act.setVal(item, col.id, item.vals[col.id] ? null : true)}>
          <span className={'checkmark' + (item.vals[col.id] ? ' on' : '')}>✓</span>
        </div>
      );
    case 'last_updated':
      return (
        <div className="cell-text people muted">
          <Avatar user={users.find((u) => u.id === item.updated_by)} size={22} />
          <span className="ellipsis">{timeAgo(item.updated_at)}</span>
        </div>
      );
    default:
      return <InputCell {...p} />;
  }
});
