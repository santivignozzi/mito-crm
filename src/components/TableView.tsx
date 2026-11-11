import { memo, useMemo, useRef, useState } from 'react';
import type { Actions, Board, Column, Group, Item, User, View } from '../types';
import { COL_TYPES, PALETTE, defaultWidth } from '../util';
import { Cell } from './Cell';
import { Editable, PopButton } from './Popover';

const NAME_W = 340;
const SUB_NAME_W = 280;

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  const commit = () => {
    if (v.trim()) onAdd(v.trim());
    setV('');
  };
  return <input className="add-input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function ColumnHeader({ col, act, sub, view, sortable }: { col: Column; act: Actions; sub?: boolean; view?: View; sortable?: boolean }) {
  const w = defaultWidth(col);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const head = (e.currentTarget as HTMLElement).parentElement!;
    let nw = w;
    const move = (ev: MouseEvent) => {
      nw = Math.max(70, w + ev.clientX - x0);
      head.style.width = nw + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (nw !== w) act.patchColumn(col.id, { width: nw }, sub);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const sort = view?.settings.sort?.columnId === col.id ? view.settings.sort.dir : null;
  return (
    <div className="th" style={{ width: w }}>
      <Editable value={col.title} onSave={(title) => title && act.patchColumn(col.id, { title }, sub)} className="th-title" />
      {sort && <span className="sort-ind">{sort === 'asc' ? '↑' : '↓'}</span>}
      <PopButton label="⋯" className="icon-btn th-menu" width={200} align="right">
        {(close) => (
          <>
            {sortable && view && (
              <>
                <button className="menu-item" onClick={() => { act.patchView(view.id, { sort: { columnId: col.id, dir: 'asc' } }); close(); }}>
                  ↑ Ordenar ascendente
                </button>
                <button className="menu-item" onClick={() => { act.patchView(view.id, { sort: { columnId: col.id, dir: 'desc' } }); close(); }}>
                  ↓ Ordenar descendente
                </button>
                <button className="menu-item" onClick={() => { act.patchView(view.id, { hidden: [...(view.settings.hidden || []), col.id] }); close(); }}>
                  ⦸ Ocultar columna
                </button>
              </>
            )}
            <button className="menu-item danger" onClick={() => { if (confirm(`¿Eliminar la columna «${col.title}» y sus datos?`)) act.deleteColumn(col.id, sub); close(); }}>
              🗑 Eliminar columna
            </button>
          </>
        )}
      </PopButton>
      <span className="resizer" onMouseDown={startResize} />
    </div>
  );
}

function AddColumn({ act, sub }: { act: Actions; sub?: boolean }) {
  return (
    <div className="th th-add">
      <PopButton label="＋" className="icon-btn" title="Agregar columna" width={220} align="right">
        {(close) =>
          COL_TYPES.map((t) => (
            <button key={t.type} className="menu-item" onClick={() => { act.addColumn(t.type, sub); close(); }}>
              <span className="type-icon">{t.icon}</span> {t.label}
            </button>
          ))
        }
      </PopButton>
    </div>
  );
}

interface RowProps {
  item: Item;
  subitems: Item[];
  columns: Column[];
  subColumns: Column[];
  users: User[];
  act: Actions;
  color: string;
  selected: boolean;
  expanded: boolean;
  draggable: boolean;
  onSelect: (id: string, shift: boolean) => void;
  onExpand: (id: string) => void;
  onDropOn: (targetId: string, draggedId: string) => void;
}

const Row = memo(function Row({ item, subitems, columns, subColumns, users, act, color, selected, expanded, draggable, onSelect, onExpand, onDropOn }: RowProps) {
  const [over, setOver] = useState(false);
  return (
    <>
      <div
        className={'tr' + (selected ? ' selected' : '') + (over ? ' drop-over' : '')}
        draggable={draggable}
        onDragStart={(e) => { e.dataTransfer.setData('text/item', item.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('text/item')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData('text/item'); if (id && id !== item.id) onDropOn(item.id, id); }}
      >
        <div className="td lead" style={{ width: NAME_W, borderLeftColor: color }}>
          <input type="checkbox" checked={selected} onChange={() => {}} onClick={(e) => onSelect(item.id, e.shiftKey)} />
          <button className={'icon-btn caret' + (expanded ? ' open' : '') + (subitems.length ? ' has' : '')} title="Subelementos" onClick={() => onExpand(item.id)}>
            ›
          </button>
          <Editable value={item.name} onSave={(name) => name && act.patchItem(item.id, { name })} className="item-name" />
          {subitems.length > 0 && <span className="sub-count">{subitems.length}</span>}
          <button className={'open-btn' + (item.updates_count ? ' has' : '')} title="Abrir elemento" onClick={() => act.openItem(item.id)}>
            {item.updates_count ? `💬 ${item.updates_count}` : '⤢ Abrir'}
          </button>
        </div>
        {columns.map((c) => (
          <div key={c.id} className="td" style={{ width: defaultWidth(c) }}>
            <Cell col={c} item={item} users={users} act={act} />
          </div>
        ))}
        <div className="td filler" />
      </div>
      {expanded && (
        <div className="subtable">
          <div className="tr head">
            <div className="th lead" style={{ width: SUB_NAME_W }}>Subelemento</div>
            {subColumns.map((c) => (
              <ColumnHeader key={c.id} col={c} act={act} sub />
            ))}
            <AddColumn act={act} sub />
          </div>
          {subitems.map((s) => (
            <div className="tr" key={s.id}>
              <div className="td lead" style={{ width: SUB_NAME_W, borderLeftColor: color }}>
                <Editable value={s.name} onSave={(name) => name && act.patchItem(s.id, { name })} className="item-name" />
                <button className="icon-btn row-del" title="Eliminar subelemento" onClick={() => act.batch([s.id], 'delete')}>
                  ✕
                </button>
              </div>
              {subColumns.map((c) => (
                <div key={c.id} className="td" style={{ width: defaultWidth(c) }}>
                  <Cell col={c} item={s} users={users} act={act} sub />
                </div>
              ))}
              <div className="td filler" />
            </div>
          ))}
          <div className="tr add">
            <div className="td lead" style={{ width: SUB_NAME_W, borderLeftColor: color }}>
              <AddInput placeholder="+ Agregar subelemento" onAdd={(name) => act.addItem(item.group_id, name, { parentId: item.id })} />
            </div>
          </div>
        </div>
      )}
    </>
  );
});

function Summary({ col, items }: { col: Column; items: Item[] }) {
  if (col.type === 'status') {
    const labels = col.settings.labels || [];
    const counts = new Map<number | null, number>();
    for (const it of items) {
      const v = labels.some((l) => l.id === it.vals[col.id]) ? it.vals[col.id] : null;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return (
      <div className="status-bar">
        {[...labels, { id: null as any, name: 'Sin valor', color: '#c4c4c4' }].map((l) =>
          counts.get(l.id) ? <span key={String(l.id)} title={`${l.name}: ${counts.get(l.id)} (${Math.round((counts.get(l.id)! / items.length) * 100)}%)`} style={{ background: l.color, flex: counts.get(l.id) }} /> : null,
        )}
      </div>
    );
  }
  if (col.type === 'numbers') {
    const sum = items.reduce((a, it) => a + (Number(it.vals[col.id]) || 0), 0);
    return (
      <div className="sum">
        <b>{sum.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{col.settings.unit ? ' ' + col.settings.unit : ''}</b>
        <small>suma</small>
      </div>
    );
  }
  return null;
}

export function TableView({ board, view, items, users, act }: { board: Board; view: View; items: Item[]; users: User[]; act: Actions }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('crm_collapsed') || '[]')));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastSel = useRef<string | null>(null);

  const hidden = view.settings.hidden || [];
  const columns = useMemo(() => board.columns.filter((c) => !hidden.includes(c.id)), [board.columns, hidden.join()]);
  const subsByParent = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of board.items) if (it.parent_id) m.set(it.parent_id, [...(m.get(it.parent_id) || []), it]);
    return m;
  }, [board.items]);
  const byGroup = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) m.set(it.group_id, [...(m.get(it.group_id) || []), it]);
    return m;
  }, [items]);
  const order = useMemo(() => board.groups.flatMap((g) => byGroup.get(g.id) || []).map((i) => i.id), [board.groups, byGroup]);
  const filtering = items.length !== board.items.filter((i) => !i.parent_id).length;
  const draggable = !view.settings.sort;
  const NO_SUBS = useRef<Item[]>([]).current;

  const stable = useRef({ order, items, act, selected });
  stable.current = { order, items, act, selected };
  const handlers = useMemo(
    () => ({
      onSelect: (id: string, shift: boolean) => {
        const { order, selected } = stable.current;
        const next = new Set(selected);
        if (shift && lastSel.current) {
          const [a, b] = [order.indexOf(lastSel.current), order.indexOf(id)].sort((x, y) => x - y);
          for (const x of order.slice(a, b + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        lastSel.current = id;
        setSelected(next);
      },
      onExpand: (id: string) =>
        setExpanded((s) => {
          const n = new Set(s);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }),
      onDropOn: (targetId: string, draggedId: string) => {
        const { items, act } = stable.current;
        const target = items.find((i) => i.id === targetId);
        if (!target) return;
        const siblings = items.filter((i) => i.group_id === target.group_id && i.id !== draggedId);
        const idx = siblings.findIndex((i) => i.id === targetId);
        const prev = siblings[idx - 1];
        act.patchItem(draggedId, { group_id: target.group_id, position: prev ? (prev.position + target.position) / 2 : target.position - 1 });
      },
    }),
    [],
  );

  const toggleCollapse = (id: string) => {
    const n = new Set(collapsed);
    n.has(id) ? n.delete(id) : n.add(id);
    setCollapsed(n);
    localStorage.setItem('crm_collapsed', JSON.stringify([...n]));
  };
  const selIds = [...selected].filter((id) => order.includes(id));
  const clearSel = () => setSelected(new Set());

  const renderGroup = (g: Group) => {
    const rows = byGroup.get(g.id) || [];
    if (filtering && !rows.length) return null;
    const isCollapsed = collapsed.has(g.id);
    const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
    return (
      <section className="group" key={g.id}>
        <div
          className="group-head"
          onDragOver={(e) => e.dataTransfer.types.includes('text/item') && e.preventDefault()}
          onDrop={(e) => { const id = e.dataTransfer.getData('text/item'); if (id) act.batch([id], 'move', g.id); }}
        >
          <button className={'icon-btn caret big' + (isCollapsed ? '' : ' open')} style={{ color: g.color }} onClick={() => toggleCollapse(g.id)}>
            ›
          </button>
          <span style={{ color: g.color }}>
            <Editable value={g.title} onSave={(title) => title && act.patchGroup(g.id, { title })} className="group-title" />
          </span>
          <span className="muted small">{rows.length} {rows.length === 1 ? 'elemento' : 'elementos'}</span>
          <PopButton label="⋯" className="icon-btn" width={220}>
            {(close) => (
              <>
                <div className="palette">
                  {PALETTE.slice(0, 20).map((c) => (
                    <button key={c} className="swatch" style={{ background: c }} onClick={() => { act.patchGroup(g.id, { color: c }); close(); }} />
                  ))}
                </div>
                <button className="menu-item danger" onClick={() => { if (confirm(`¿Eliminar el grupo «${g.title}» y sus ${rows.length} elementos?`)) act.deleteGroup(g.id); close(); }}>
                  🗑 Eliminar grupo
                </button>
              </>
            )}
          </PopButton>
        </div>
        {!isCollapsed && (
          <div className="table">
            <div className="tr head">
              <div className="th lead" style={{ width: NAME_W, borderLeftColor: g.color }}>
                <input
                  type="checkbox"
                  checked={allSel}
                  onChange={() => {
                    const n = new Set(selected);
                    rows.forEach((r) => (allSel ? n.delete(r.id) : n.add(r.id)));
                    setSelected(n);
                  }}
                />
                <span className="th-title">Elemento</span>
              </div>
              {columns.map((c) => (
                <ColumnHeader key={c.id} col={c} act={act} view={view} sortable />
              ))}
              <AddColumn act={act} />
            </div>
            {rows.map((it) => (
              <Row
                key={it.id}
                item={it}
                subitems={subsByParent.get(it.id) || NO_SUBS}
                columns={columns}
                subColumns={board.subitem_columns}
                users={users}
                act={act}
                color={g.color}
                selected={selected.has(it.id)}
                expanded={expanded.has(it.id)}
                draggable={draggable}
                {...handlers}
              />
            ))}
            <div className="tr add">
              <div className="td lead" style={{ width: NAME_W, borderLeftColor: g.color, opacity: 0.9 }}>
                <AddInput placeholder="+ Agregar elemento" onAdd={(name) => act.addItem(g.id, name)} />
              </div>
            </div>
            <div className="tr foot">
              <div className="td lead ghost" style={{ width: NAME_W }} />
              {columns.map((c) => (
                <div key={c.id} className="td" style={{ width: defaultWidth(c) }}>
                  <Summary col={c} items={rows} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="table-view">
      {board.groups.map(renderGroup)}
      {filtering && !items.length && <div className="empty">Ningún elemento coincide con los filtros.</div>}
      <button className="btn" onClick={() => act.addGroup()}>
        ＋ Agregar grupo nuevo
      </button>
      {selIds.length > 0 && (
        <div className="batch-bar">
          <b className="batch-count">{selIds.length}</b>
          <span>{selIds.length === 1 ? 'elemento seleccionado' : 'elementos seleccionados'}</span>
          <button className="btn ghost" onClick={() => { act.batch(selIds, 'duplicate'); clearSel(); }}>
            ⧉ Duplicar
          </button>
          <PopButton label="→ Mover a" className="btn ghost" width={220}>
            {(close) =>
              board.groups.map((g) => (
                <button key={g.id} className="menu-item" onClick={() => { act.batch(selIds, 'move', g.id); clearSel(); close(); }}>
                  <span className="dot" style={{ background: g.color }} /> {g.title}
                </button>
              ))
            }
          </PopButton>
          <button className="btn ghost" onClick={() => { if (confirm(`¿Eliminar ${selIds.length} elemento(s)?`)) { act.batch(selIds, 'delete'); clearSel(); } }}>
            🗑 Eliminar
          </button>
          <button className="icon-btn" onClick={clearSel}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
