import { useEffect, useMemo, useRef, useState } from 'react';
import type { Actions, Board, Column, Item, User, View } from '../types';
import { MONTHS_LONG, addDays, cellText, daysBetween, fmtDate, parseYmd, today, ymd } from '../util';
import { Avatar } from './Popover';

interface ViewProps {
  board: Board;
  view: View;
  items: Item[];
  users: User[];
  act: Actions;
}

function ColumnSelect({ label, columns, value, onChange, allowNone, extra }: { label: string; columns: Column[]; value?: string; onChange: (id: string) => void; allowNone?: boolean; extra?: { id: string; title: string }[] }) {
  return (
    <label className="col-select">
      {label}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">—</option>}
        {extra?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Columna de estado "principal": la que se llama Status/Estado, o la primera. */
const mainStatus = (board: Board) => {
  const cols = board.columns.filter((c) => c.type === 'status');
  return cols.find((c) => /status|estado/i.test(c.title)) || cols[0];
};
const statusColor = (board: Board, it: Item) => {
  const c = mainStatus(board);
  return c?.settings.labels?.find((x) => x.id === it.vals[c.id])?.color || '#8b93a7';
};
/** Columna de texto más completa: sirve de subtítulo cuando muchos elementos comparten nombre. */
function useSubtitleCol(board: Board, skip?: string) {
  return useMemo(() => {
    let best: Column | undefined;
    let bestN = 0;
    for (const c of board.columns) {
      if (c.type !== 'text' || c.id === skip) continue;
      const n = board.items.reduce((a, it) => a + (it.vals[c.id] && !/^https?:/.test(it.vals[c.id]) ? 1 : 0), 0);
      if (n > bestN) [best, bestN] = [c, n];
    }
    return best;
  }, [board.columns, board.items, skip]);
}

// ---------------- Kanban ----------------
export function KanbanView({ board, view, items, users, act }: ViewProps) {
  const statusCols = board.columns.filter((c) => c.type === 'status');
  const col = statusCols.find((c) => c.id === view.settings.columnId) || mainStatus(board);
  const [over, setOver] = useState<string | null>(null);
  const textCol = useSubtitleCol(board);
  if (!col) return <div className="empty">Este tablero no tiene columnas de estado. Agregá una desde la tabla para usar el Kanban.</div>;
  const labels = col.settings.labels || [];
  const lanes = [...labels.map((l) => ({ key: String(l.id), id: l.id as number | null, name: l.name, color: l.color! })), { key: 'none', id: null, name: 'Sin valor', color: '#c4c4c4' }];
  const peopleCol = board.columns.find((c) => c.type === 'people');
  const dateCol = board.columns.find((c) => c.type === 'date');
  const laneOf = (it: Item) => (labels.some((l) => l.id === it.vals[col.id]) ? String(it.vals[col.id]) : 'none');
  return (
    <div className="view-pad">
      <div className="view-controls">
        <ColumnSelect label="Columna del Kanban" columns={statusCols} value={col.id} onChange={(columnId) => act.patchView(view.id, { columnId })} />
      </div>
      <div className="kanban">
        {lanes.map((lane) => {
          const cards = items.filter((it) => laneOf(it) === lane.key);
          return (
            <div
              key={lane.key}
              className={'lane' + (over === lane.key ? ' over' : '')}
              onDragOver={(e) => { e.preventDefault(); setOver(lane.key); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const it = items.find((i) => i.id === e.dataTransfer.getData('text/item'));
                if (it && laneOf(it) !== lane.key) act.setVal(it, col.id, lane.id);
              }}
            >
              <div className="lane-head" style={{ background: lane.color }}>
                {lane.name} <span>{cards.length}</span>
              </div>
              <div className="lane-body">
                {cards.map((it) => (
                  <div key={it.id} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/item', it.id)} onClick={() => act.openItem(it.id)}>
                    <div className="card-title">{it.name}</div>
                    {textCol && it.vals[textCol.id] && <div className="card-sub">{it.vals[textCol.id]}</div>}
                    <div className="card-foot">
                      <span className="muted small">{dateCol && it.vals[dateCol.id] ? '▦ ' + fmtDate(it.vals[dateCol.id]) : ''}</span>
                      <span className="people">{peopleCol && (it.vals[peopleCol.id] || []).map((id: string) => <Avatar key={id} size={22} user={users.find((u) => u.id === id)} />)}</span>
                    </div>
                  </div>
                ))}
                <KanbanAdd onAdd={(name) => act.addItem(board.groups[0].id, name, { vals: lane.id == null ? {} : { [col.id]: lane.id } })} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function KanbanAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  const commit = () => {
    if (v.trim()) onAdd(v.trim());
    setV('');
  };
  return <input className="add-input card-add" placeholder="+ Agregar elemento" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

// ---------------- Calendario ----------------
export function CalendarView({ board, view, items, act }: ViewProps) {
  const dateCols = board.columns.filter((c) => c.type === 'date');
  const col = dateCols.find((c) => c.id === view.settings.dateColumnId) || dateCols[0];
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [openDay, setOpenDay] = useState<string | null>(null);
  const subCol = useSubtitleCol(board);
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    if (col) for (const it of items) if (it.vals[col.id]) m.set(it.vals[col.id], [...(m.get(it.vals[col.id]) || []), it]);
    return m;
  }, [items, col?.id]);
  if (!col) return <div className="empty">Este tablero no tiene columnas de fecha. Agregá una desde la tabla para usar el Calendario.</div>;

  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7)); // lunes
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const weeks = days[35].getMonth() === month.getMonth() ? 6 : 5;
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const noDate = items.filter((it) => !it.vals[col.id]).length;
  const t = today();
  return (
    <div className="view-pad calendar-wrap">
      <div className="view-controls">
        <button className="btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hoy</button>
        <button className="btn" onClick={() => shift(-1)}>‹</button>
        <button className="btn" onClick={() => shift(1)}>›</button>
        <b className="cal-title">{MONTHS_LONG[month.getMonth()]} {month.getFullYear()}</b>
        <span className="spacer" />
        {noDate > 0 && <span className="muted small">{noDate} sin fecha</span>}
        <ColumnSelect label="Fecha" columns={dateCols} value={col.id} onChange={(dateColumnId) => act.patchView(view.id, { dateColumnId })} />
      </div>
      <div className="calendar" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(110px, 1fr))` }}>
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const key = ymd(d);
          const list = byDay.get(key) || [];
          const open = openDay === key;
          return (
            <div
              key={key}
              className={'cal-day' + (d.getMonth() !== month.getMonth() ? ' out' : '') + (key === t ? ' today' : '')}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const it = items.find((i) => i.id === e.dataTransfer.getData('text/item'));
                if (it && it.vals[col.id] !== key) act.setVal(it, col.id, key);
              }}
            >
              <div className="cal-num"><span>{d.getDate()}</span></div>
              {(open ? list : list.slice(0, 3)).map((it) => (
                <div key={it.id} className="cal-chip" title={it.name + (subCol && it.vals[subCol.id] ? ' · ' + it.vals[subCol.id] : '')} style={{ background: statusColor(board, it) }} draggable onDragStart={(e) => e.dataTransfer.setData('text/item', it.id)} onClick={() => act.openItem(it.id)}>
                  <b>{it.name}</b>
                  {subCol && it.vals[subCol.id] ? ' · ' + it.vals[subCol.id] : ''}
                </div>
              ))}
              {list.length > 3 && (
                <button className="cal-more" onClick={() => setOpenDay(open ? null : key)}>
                  {open ? 'ver menos' : `+${list.length - 3} más`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Cronograma ----------------
const DAY_W = 30;
export function TimelineView({ board, view, items, act }: ViewProps) {
  const dateCols = board.columns.filter((c) => c.type === 'date');
  const startCol = dateCols.find((c) => c.id === view.settings.dateColumnId) || dateCols[0];
  const endCol = dateCols.find((c) => c.id === view.settings.endDateColumnId && c.id !== startCol?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const subCol = useSubtitleCol(board);
  const t = today();

  const bars = useMemo(() => {
    if (!startCol) return [];
    return items
      .map((it) => {
        const a = it.vals[startCol.id] || (endCol && it.vals[endCol.id]);
        if (!a) return null;
        const b = (endCol && it.vals[endCol.id]) || a;
        return { it, start: a < b ? a : b, end: a < b ? b : a };
      })
      .filter(Boolean) as { it: Item; start: string; end: string }[];
  }, [items, startCol?.id, endCol?.id]);

  const [from, to] = useMemo(() => {
    let lo = t;
    let hi = t;
    for (const b of bars) {
      if (b.start < lo) lo = b.start;
      if (b.end > hi) hi = b.end;
    }
    lo = addDays(lo, -7);
    hi = addDays(hi, 21);
    if (daysBetween(lo, hi) > 550) lo = addDays(hi, -550);
    return [lo, hi];
  }, [bars, t]);
  const total = daysBetween(from, to) + 1;

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, daysBetween(from, t) * DAY_W - 200);
  }, [from, view.id]);

  if (!startCol) return <div className="empty">Este tablero no tiene columnas de fecha. Agregá una desde la tabla para usar el Cronograma.</div>;

  const dayList = Array.from({ length: total }, (_, i) => parseYmd(addDays(from, i)));
  const months: { label: string; span: number }[] = [];
  for (const d of dayList) {
    const label = `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    if (months.length && months[months.length - 1].label === label) months[months.length - 1].span++;
    else months.push({ label, span: 1 });
  }
  const rows = board.groups.map((g) => ({ g, bars: bars.filter((b) => b.it.group_id === g.id) })).filter((r) => r.bars.length);
  const noDate = items.length - bars.length;

  return (
    <div className="view-pad timeline-wrap">
      <div className="view-controls">
        <ColumnSelect label="Inicio" columns={dateCols} value={startCol.id} onChange={(dateColumnId) => act.patchView(view.id, { dateColumnId })} />
        <ColumnSelect label="Fin" columns={dateCols.filter((c) => c.id !== startCol.id)} value={endCol?.id} allowNone onChange={(endDateColumnId) => act.patchView(view.id, { endDateColumnId })} />
        <button className="btn" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, daysBetween(from, t) * DAY_W - 200), behavior: 'smooth' })}>Hoy</button>
        <span className="spacer" />
        {noDate > 0 && <span className="muted small">{noDate} sin fecha</span>}
      </div>
      {!bars.length ? (
        <div className="empty">Ningún elemento tiene fecha en «{startCol.title}». Cargá fechas desde la tabla para verlos acá.</div>
      ) : (
        <div className="timeline" ref={scroller}>
          <div style={{ width: total * DAY_W + 220 }}>
            <div className="tl-head">
              <div className="tl-side" />
              <div>
                <div className="tl-months">
                  {months.map((m) => (
                    <div key={m.label} style={{ width: m.span * DAY_W }}>{m.span > 3 ? m.label : ''}</div>
                  ))}
                </div>
                <div className="tl-days">
                  {dayList.map((d) => (
                    <div key={+d} className={(d.getDay() === 0 || d.getDay() === 6 ? 'we' : '') + (ymd(d) === t ? ' today' : '')} style={{ width: DAY_W }}>
                      {d.getDate()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {rows.map(({ g, bars }) => (
              <div key={g.id}>
                <div className="tl-group" style={{ color: g.color }}>
                  <div className="tl-side">{g.title}</div>
                </div>
                {bars.map(({ it, start, end }) => (
                  <div className="tl-row" key={it.id}>
                    <div className="tl-side" title={it.name} onClick={() => act.openItem(it.id)}>{it.name}{subCol && it.vals[subCol.id] ? <span className="muted"> · {it.vals[subCol.id]}</span> : null}</div>
                    <div className="tl-track" style={{ width: total * DAY_W, backgroundSize: `${DAY_W}px 100%` }}>
                      <div className="tl-today" style={{ left: daysBetween(from, t) * DAY_W + DAY_W / 2 }} />
                      <div
                        className="tl-bar"
                        title={`${it.name}: ${fmtDate(start)}${end !== start ? ' → ' + fmtDate(end) : ''}`}
                        style={{ left: Math.max(0, daysBetween(from, start)) * DAY_W + 2, width: (daysBetween(start < from ? from : start, end) + 1) * DAY_W - 4, background: g.color }}
                        onClick={() => act.openItem(it.id)}
                      >
                        {end !== start ? it.name : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Gráfico ----------------
export function ChartView({ board, view, items, users, act }: ViewProps) {
  const cols = board.columns.filter((c) => ['status', 'dropdown', 'people'].includes(c.type));
  const colId = view.settings.columnId || mainStatus(board)?.id || '__group';
  const col = cols.find((c) => c.id === colId);
  const data = useMemo(() => {
    const m = new Map<string, { label: string; color: string; n: number }>();
    const add = (label: string, color: string) => m.set(label, { label, color, n: (m.get(label)?.n || 0) + 1 });
    for (const it of items) {
      if (!col) {
        const g = board.groups.find((x) => x.id === it.group_id);
        add(g?.title || '—', g?.color || '#c4c4c4');
        continue;
      }
      const v = it.vals[col.id];
      const arr = v == null ? [] : Array.isArray(v) ? v : [v];
      if (!arr.length) add('Sin valor', '#c4c4c4');
      for (const x of arr) {
        if (col.type === 'people') {
          const u = users.find((p) => p.id === x);
          add(u?.name || '—', u?.color || '#c4c4c4');
        } else {
          const l = col.settings.labels?.find((p) => p.id === x);
          add(l?.name || cellText(col, x, users) || 'Sin valor', l?.color || '#6366f1');
        }
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [items, col, board.groups, users]);
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="view-pad">
      <div className="view-controls">
        <ColumnSelect label="Agrupar por" columns={cols} value={colId} extra={[{ id: '__group', title: 'Grupo' }]} onChange={(columnId) => act.patchView(view.id, { columnId })} />
        <span className="spacer" />
        <span className="muted">{items.length} elementos</span>
      </div>
      <div className="chart">
        {data.slice(0, 30).map((d) => (
          <div className="bar-row" key={d.label}>
            <span className="bar-label" title={d.label}>{d.label}</span>
            <div className="bar-track">
              <div className="bar" style={{ width: `${(d.n / max) * 100}%`, background: d.color }} />
            </div>
            <b>{d.n}</b>
            <span className="muted small">{Math.round((d.n / Math.max(1, items.length)) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
