import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Actions, Activity, Board, Boot, Column, ColType, Item, User, View, ViewType } from './types';
import { CLIENT_ID, COL_TYPES, api, download, getUserId, setUserId, toCsv, visibleItems } from './util';
import { TableView } from './components/TableView';
import { CalendarView, ChartView, KanbanView, TimelineView } from './components/OtherViews';
import { ActivityList, ItemPanel } from './components/ItemPanel';
import { Avatar, Editable, PopButton } from './components/Popover';

const VIEW_TYPES: { type: ViewType; label: string; icon: string }[] = [
  { type: 'table', label: 'Tabla', icon: '▤' },
  { type: 'kanban', label: 'Kanban', icon: '▥' },
  { type: 'calendar', label: 'Calendario', icon: '▦' },
  { type: 'timeline', label: 'Cronograma', icon: '☰' },
  { type: 'chart', label: 'Gráfico', icon: '◔' },
];
const viewIcon = (t: ViewType) => VIEW_TYPES.find((v) => v.type === t)?.icon;
const rid = (p: string) => p + '_' + Math.random().toString(36).slice(2, 10);
const parseHash = () => {
  const m = location.hash.match(/^#\/b\/([^/]+)(?:\/([^/]+))?/);
  return { boardId: m?.[1] || null, viewId: m?.[2] || null };
};

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [route, setRoute] = useState(parseHash);
  const [board, setBoard] = useState<Board | null>(null);
  const [meId, setMeId] = useState(getUserId());
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;

  const fail = useCallback((e: any) => {
    if (e.status === 401) return setNeedLogin(true);
    setToast(e.message || 'Error');
    setTimeout(() => setToast(''), 4000);
  }, []);
  const loadBoot = useCallback(() => api<Boot>('GET', '/bootstrap').then((b) => { setBoot(b); setNeedLogin(false); }).catch(fail), [fail]);
  const loadBoard = useCallback(
    (id: string) =>
      api<Board>('GET', `/boards/${id}`)
        .then((b) => parseHash().boardId === id && setBoard(b))
        .catch((e) => { fail(e); if (e.status === 404) location.hash = ''; }),
    [fail],
  );

  useEffect(() => { loadBoot(); }, [loadBoot]);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (boot && !route.boardId && boot.boards[0]) location.hash = `#/b/${boot.boards[0].id}`;
  }, [boot, route.boardId]);
  useEffect(() => {
    setSearch('');
    setShowActivity(false);
    if (!route.boardId) return setBoard(null);
    if (boardRef.current?.id !== route.boardId) setBoard(null);
    loadBoard(route.boardId);
  }, [route.boardId, loadBoard]);

  // Tiempo real: recargar cuando otro cliente cambia algo
  useEffect(() => {
    if (!boot) return;
    const es = new EventSource('/api/events');
    let t: any;
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.client === CLIENT_ID) return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (!m.board_id) loadBoot();
        const cur = boardRef.current?.id;
        if (cur && (!m.board_id || m.board_id === cur)) loadBoard(cur);
      }, 250);
    };
    return () => es.close();
  }, [!!boot, loadBoot, loadBoard]);

  const act = useMemo<Actions>(() => {
    const mutate = (fn: (b: Board) => Board) => setBoard((b) => (b ? fn(b) : b));
    const run = (p: Promise<any>) =>
      p.catch((e) => {
        fail(e);
        if (boardRef.current) loadBoard(boardRef.current.id);
      });
    const mapItem = (id: string, fn: (i: Item) => Item) => mutate((b) => ({ ...b, items: b.items.map((i) => (i.id === id ? fn(i) : i)) }));
    const saveCols = (sub: boolean | undefined, fn: (cols: Column[]) => Column[]) => {
      const b = boardRef.current!;
      const key = sub ? 'subitem_columns' : 'columns';
      const next = fn(b[key]);
      mutate((x) => ({ ...x, [key]: next }));
      run(api('PATCH', `/boards/${b.id}`, { [key]: next }));
    };
    const saveViews = (views: View[]) => {
      mutate((b) => ({ ...b, views }));
      run(api('PATCH', `/boards/${boardRef.current!.id}`, { views }));
    };
    return {
      setVal(item, colId, value) {
        const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
        mapItem(item.id, (i) => {
          const vals = { ...i.vals };
          if (empty) delete vals[colId];
          else vals[colId] = value;
          return { ...i, vals, updated_at: new Date().toISOString(), updated_by: getUserId() };
        });
        run(api('PATCH', `/items/${item.id}`, { vals: { [colId]: empty ? null : value } }));
      },
      patchItem(id, patch) {
        mutate((b) => {
          const items = b.items.map((i) => (i.id === id ? { ...i, ...patch } : patch.group_id && i.parent_id === id ? { ...i, group_id: patch.group_id } : i));
          if (patch.position != null) items.sort((x, y) => x.position - y.position);
          return { ...b, items };
        });
        run(api('PATCH', `/items/${id}`, patch));
      },
      addItem(groupId, name, opts = {}) {
        run(
          api<Item>('POST', `/boards/${boardRef.current!.id}/items`, { group_id: groupId, name, parent_id: opts.parentId, vals: opts.vals, top: opts.top }).then((it) =>
            mutate((b) => ({ ...b, items: [...b.items, it].sort((x, y) => x.position - y.position) })),
          ),
        );
      },
      batch(ids, action, groupId) {
        if (action === 'delete') mutate((b) => ({ ...b, items: b.items.filter((i) => !ids.includes(i.id) && !ids.includes(i.parent_id || '')) }));
        if (action === 'move') mutate((b) => ({ ...b, items: b.items.map((i) => (ids.includes(i.id) || ids.includes(i.parent_id || '') ? { ...i, group_id: groupId! } : i)) }));
        run(api('POST', '/items/batch', { ids, action, group_id: groupId }).then(() => action !== 'delete' && loadBoard(boardRef.current!.id)));
      },
      addGroup(top) {
        run(api('POST', `/boards/${boardRef.current!.id}/groups`, { top }).then((g) => mutate((b) => ({ ...b, groups: top ? [g, ...b.groups] : [...b.groups, g] }))));
      },
      patchGroup(id, patch) {
        mutate((b) => ({ ...b, groups: b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
        run(api('PATCH', `/groups/${id}`, patch));
      },
      deleteGroup(id) {
        if (boardRef.current!.groups.length <= 1) return fail(new Error('El tablero necesita al menos un grupo'));
        mutate((b) => ({ ...b, groups: b.groups.filter((g) => g.id !== id), items: b.items.filter((i) => i.group_id !== id) }));
        run(api('DELETE', `/groups/${id}`));
      },
      addColumn(type: ColType, sub) {
        const title = COL_TYPES.find((t) => t.type === type)!.label;
        const settings: Column['settings'] =
          type === 'status'
            ? { labels: [{ id: 0, name: 'En curso', color: '#fdab3d' }, { id: 1, name: 'Listo', color: '#00c875' }, { id: 2, name: 'Detenido', color: '#df2f4a' }] }
            : type === 'dropdown'
              ? { labels: [] }
              : {};
        saveCols(sub, (cols) => [...cols, { id: rid(type), title, type, settings }]);
      },
      patchColumn(id, patch, sub) {
        saveCols(sub, (cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      },
      deleteColumn(id, sub) {
        saveCols(sub, (cols) => cols.filter((c) => c.id !== id));
      },
      setViews: saveViews,
      patchView(id, settings) {
        saveViews(boardRef.current!.views.map((v) => (v.id === id ? { ...v, settings: { ...v.settings, ...settings } } : v)));
      },
      patchBoard(patch) {
        const id = boardRef.current!.id;
        mutate((b) => ({ ...b, ...patch }));
        setBoot((bt) => bt && { ...bt, boards: bt.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
        run(api('PATCH', `/boards/${id}`, patch));
      },
      openItem: setOpenId,
      bumpUpdates(itemId, delta) {
        mapItem(itemId, (i) => ({ ...i, updates_count: Math.max(0, i.updates_count + delta) }));
      },
    };
  }, [fail, loadBoard]);

  if (needLogin) return <Login onDone={loadBoot} />;
  if (!boot) return <div className="splash">Cargando…</div>;
  const me = boot.users.find((u) => u.id === meId) || null;
  if (!me)
    return (
      <div className="splash">
        <div className="login">
          <h1>Mito CRM</h1>
          <p className="muted">¿Quién sos? Tus cambios y comentarios quedan a tu nombre.</p>
          {boot.users.map((u) => (
            <button key={u.id} className="menu-item" onClick={() => { setUserId(u.id); setMeId(u.id); }}>
              <Avatar user={u} /> {u.name}
            </button>
          ))}
        </div>
      </div>
    );

  const view = board ? board.views.find((v) => v.id === route.viewId) || board.views[0] : null;
  const openItem = board && openId ? board.items.find((i) => i.id === openId) : null;

  return (
    <div className="app">
      <Sidebar boot={boot} me={me} boardId={route.boardId} reload={loadBoot} fail={fail} onOpenItem={(boardId, itemId) => { location.hash = `#/b/${boardId}`; setOpenId(itemId); }} onSwitchUser={() => { localStorage.removeItem('crm_user'); setMeId(null); }} />
      <main className="main">
        {!board || !view ? (
          <div className="empty">{boot.boards.length ? 'Cargando tablero…' : 'Creá tu primer tablero desde la barra lateral.'}</div>
        ) : (
          <BoardScreen board={board} view={view} users={boot.users} act={act} search={search} setSearch={setSearch} onActivity={() => setShowActivity(true)} onDeleted={() => { location.hash = ''; loadBoot(); }} fail={fail} />
        )}
      </main>
      {board && openItem && <ItemPanel key={openItem.id} item={openItem} board={board} users={boot.users} act={act} />}
      {board && showActivity && <BoardActivity board={board} users={boot.users} onClose={() => setShowActivity(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    api('POST', '/login', { password: pw }).then(onDone).catch((x) => setErr(x.message));
  };
  return (
    <div className="splash">
      <form className="login" onSubmit={submit}>
        <h1>Mito CRM</h1>
        <input className="input" type="password" autoFocus placeholder="Contraseña" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="danger-text">{err}</div>}
        <button className="btn primary">Entrar</button>
      </form>
    </div>
  );
}

function Sidebar({ boot, me, boardId, reload, fail, onOpenItem, onSwitchUser }: { boot: Boot; me: User; boardId: string | null; reload: () => void; fail: (e: any) => void; onOpenItem: (boardId: string, itemId: string) => void; onSwitchUser: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setResults(null);
    const t = setTimeout(() => api('GET', `/search?q=${encodeURIComponent(q)}`).then(setResults).catch(fail), 200);
    return () => clearTimeout(t);
  }, [q, fail]);
  const addBoard = (workspace_id: string) => {
    const name = prompt('Nombre del tablero nuevo');
    if (name?.trim()) api('POST', '/boards', { workspace_id, name: name.trim() }).then((b) => { reload(); location.hash = `#/b/${b.id}`; }).catch(fail);
  };
  const addWorkspace = () => {
    const name = prompt('Nombre del espacio de trabajo');
    if (name?.trim()) api('POST', '/workspaces', { name: name.trim() }).then(reload).catch(fail);
  };
  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="logo">M</span> Mito CRM
      </div>
      <input className="input" placeholder="🔍 Buscar en todo…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="side-scroll">
        {results ? (
          <>
            <div className="side-label">{results.length} resultados</div>
            {results.map((r) => (
              <button key={r.id} className="side-item" onClick={() => { onOpenItem(r.board_id, r.parent_id || r.id); setQ(''); }}>
                <span className="ellipsis">{r.name}</span>
                <small className="muted">{r.board_name}</small>
              </button>
            ))}
          </>
        ) : (
          boot.workspaces.map((w) => (
            <div key={w.id} className="ws">
              <div className="side-label">
                <span className="ellipsis">{w.name}</span>
                <button className="icon-btn" title="Nuevo tablero" onClick={() => addBoard(w.id)}>＋</button>
              </div>
              {boot.boards
                .filter((b) => b.workspace_id === w.id)
                .map((b) => (
                  <a key={b.id} className={'side-item' + (b.id === boardId ? ' active' : '')} href={`#/b/${b.id}`}>
                    <span className="ellipsis">▤ {b.name}</span>
                    <small className="muted">{b.items_count}</small>
                  </a>
                ))}
            </div>
          ))
        )}
        {!results && <button className="side-item muted" onClick={addWorkspace}>＋ Nuevo espacio de trabajo</button>}
      </div>
      <button className="me" onClick={onSwitchUser} title="Cambiar de usuario">
        <Avatar user={me} /> <span className="ellipsis">{me.name}</span> <small className="muted">cambiar</small>
      </button>
    </nav>
  );
}

function BoardActivity({ board, users, onClose }: { board: Board; users: User[]; onClose: () => void }) {
  const [list, setList] = useState<Activity[] | null>(null);
  useEffect(() => {
    api('GET', `/boards/${board.id}/activity`).then(setList);
  }, [board.id]);
  return (
    <aside className="panel">
      <header className="panel-head">
        <button className="icon-btn" onClick={onClose}>✕</button>
        <div className="panel-title">
          <span className="item-title">Registro de actividad</span>
          <div className="muted small">{board.name}</div>
        </div>
      </header>
      <div className="panel-body">{list ? <ActivityList list={list} board={board} users={users} showItem /> : <div className="empty">Cargando…</div>}</div>
    </aside>
  );
}

function BoardScreen({ board, view, users, act, search, setSearch, onActivity, onDeleted, fail }: { board: Board; view: View; users: User[]; act: Actions; search: string; setSearch: (s: string) => void; onActivity: () => void; onDeleted: () => void; fail: (e: any) => void }) {
  const items = useMemo(() => visibleItems(board, view, search, users), [board, view, search, users]);
  const total = useMemo(() => board.items.filter((i) => !i.parent_id).length, [board.items]);
  const go = (id: string) => (location.hash = `#/b/${board.id}/${id}`);
  const addView = (type: ViewType) => {
    const v: View = { id: rid('v'), name: VIEW_TYPES.find((t) => t.type === type)!.label, type, settings: {} };
    act.setViews([...board.views, v]);
    go(v.id);
  };
  const s = view.settings;
  const filterCols = board.columns.filter((c) => ['status', 'dropdown', 'people'].includes(c.type));
  const nFilters = (s.filters || []).filter((f) => f.values.length).length;
  const person = users.find((u) => u.id === s.person);
  const props = { board, view, items, users, act };

  return (
    <>
      <header className="board-head">
        <div className="board-title-row">
          <Editable value={board.name} onSave={(name) => name && act.patchBoard({ name })} className="board-title" />
          <span className="spacer" />
          <button className="btn" onClick={onActivity}>↻ Actividad</button>
          <button className="btn" onClick={() => download(`${board.name}.csv`, toCsv(board, items, users))}>⇩ Exportar CSV</button>
          <PopButton label="⋯" className="btn" width={200} align="right">
            {() => (
              <button className="menu-item danger" onClick={() => { if (confirm(`¿Eliminar el tablero «${board.name}» con todos sus elementos? No se puede deshacer.`)) api('DELETE', `/boards/${board.id}`).then(onDeleted).catch(fail); }}>
                🗑 Eliminar tablero
              </button>
            )}
          </PopButton>
        </div>
        <Editable value={board.description || ''} onSave={(description) => act.patchBoard({ description })} className="board-desc" placeholder="Agregar una descripción…" />
        <nav className="tabs">
          {board.views.map((v) => (
            <span key={v.id} className={'tab' + (v.id === view.id ? ' active' : '')} onClick={() => go(v.id)}>
              {viewIcon(v.type)} {v.name}
              {v.id === view.id && (
                <PopButton label="⋯" className="icon-btn tab-menu" width={200}>
                  {(close) => (
                    <>
                      <button className="menu-item" onClick={() => { const name = prompt('Nombre de la vista', v.name); if (name?.trim()) act.setViews(board.views.map((x) => (x.id === v.id ? { ...x, name: name.trim() } : x))); close(); }}>
                        ✎ Cambiar nombre
                      </button>
                      {board.views.length > 1 && (
                        <button className="menu-item danger" onClick={() => { if (confirm(`¿Eliminar la vista «${v.name}»?`)) { act.setViews(board.views.filter((x) => x.id !== v.id)); location.hash = `#/b/${board.id}`; } close(); }}>
                          🗑 Eliminar vista
                        </button>
                      )}
                    </>
                  )}
                </PopButton>
              )}
            </span>
          ))}
          <PopButton label="＋" className="icon-btn" title="Agregar vista" width={200}>
            {(close) =>
              VIEW_TYPES.map((t) => (
                <button key={t.type} className="menu-item" onClick={() => { addView(t.type); close(); }}>
                  <span className="type-icon">{t.icon}</span> {t.label}
                </button>
              ))
            }
          </PopButton>
        </nav>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={() => act.addItem(board.groups[0].id, 'Elemento nuevo', { top: true })}>Nuevo elemento</button>
        <input className="input search" placeholder="🔍 Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
        <PopButton label={person ? <><Avatar user={person} size={18} /> {person.name.split(' ')[0]}</> : '☺ Persona'} className={'btn' + (person ? ' on' : '')} width={240}>
          {(close) => (
            <div className="menu-scroll">
              {person && <button className="menu-item muted" onClick={() => { act.patchView(view.id, { person: undefined }); close(); }}>✕ Quitar filtro</button>}
              {users.map((u) => (
                <button key={u.id} className={'menu-item' + (u.id === s.person ? ' checked' : '')} onClick={() => { act.patchView(view.id, { person: u.id }); close(); }}>
                  <Avatar user={u} size={22} /> {u.name}
                </button>
              ))}
            </div>
          )}
        </PopButton>
        <PopButton label={`⏷ Filtrar${nFilters ? ` · ${nFilters}` : ''}`} className={'btn' + (nFilters ? ' on' : '')} width={300}>
          {() => <FilterEditor board={board} view={view} users={users} act={act} columns={filterCols} />}
        </PopButton>
        <PopButton label={`⇅ Ordenar${s.sort ? ' · 1' : ''}`} className={'btn' + (s.sort ? ' on' : '')} width={260}>
          {(close) => (
            <div className="form">
              <select value={s.sort?.columnId || ''} onChange={(e) => act.patchView(view.id, { sort: e.target.value ? { columnId: e.target.value, dir: s.sort?.dir || 'asc' } : undefined })}>
                <option value="">Sin ordenar</option>
                <option value="__name">Nombre</option>
                {board.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              {s.sort && (
                <select value={s.sort.dir} onChange={(e) => act.patchView(view.id, { sort: { ...s.sort!, dir: e.target.value as 'asc' | 'desc' } })}>
                  <option value="asc">Ascendente</option>
                  <option value="desc">Descendente</option>
                </select>
              )}
              {s.sort && <button className="menu-item muted" onClick={() => { act.patchView(view.id, { sort: undefined }); close(); }}>✕ Quitar orden</button>}
            </div>
          )}
        </PopButton>
        {view.type === 'table' && (
          <PopButton label={`⦸ Ocultar${s.hidden?.length ? ` · ${s.hidden.length}` : ''}`} className={'btn' + (s.hidden?.length ? ' on' : '')} width={260}>
            {() => (
              <div className="menu-scroll">
                {board.columns.map((c) => {
                  const hid = (s.hidden || []).includes(c.id);
                  return (
                    <button key={c.id} className={'menu-item' + (hid ? '' : ' checked')} onClick={() => act.patchView(view.id, { hidden: hid ? s.hidden!.filter((x) => x !== c.id) : [...(s.hidden || []), c.id] })}>
                      <span className="check">{hid ? '' : '✓'}</span> {c.title}
                    </button>
                  );
                })}
              </div>
            )}
          </PopButton>
        )}
        <span className="spacer" />
        <span className="muted small">{items.length === total ? `${total} elementos` : `${items.length} de ${total} elementos`}</span>
      </div>

      <div className="view-area">
        {view.type === 'table' && <TableView {...props} />}
        {view.type === 'kanban' && <KanbanView {...props} />}
        {view.type === 'calendar' && <CalendarView {...props} />}
        {view.type === 'timeline' && <TimelineView {...props} />}
        {view.type === 'chart' && <ChartView {...props} />}
      </div>
    </>
  );
}

function FilterEditor({ board, view, users, act, columns }: { board: Board; view: View; users: User[]; act: Actions; columns: Column[] }) {
  const filters = view.settings.filters || [];
  const [colId, setColId] = useState(filters.find((f) => f.values.length)?.columnId || columns[0]?.id || '__group');
  const col = columns.find((c) => c.id === colId);
  const options: { id: string | number; name: string; color?: string }[] =
    colId === '__group'
      ? board.groups.map((g) => ({ id: g.id, name: g.title, color: g.color }))
      : col?.type === 'people'
        ? users.map((u) => ({ id: u.id, name: u.name, color: u.color }))
        : (col?.settings.labels || []).map((l) => ({ id: l.id, name: l.name, color: l.color }));
  if (colId !== '__group') options.push({ id: '__empty', name: '(Vacío)', color: '#c4c4c4' });
  const current = filters.find((f) => f.columnId === colId)?.values || [];
  const toggle = (id: string | number) => {
    const values = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    act.patchView(view.id, { filters: [...filters.filter((f) => f.columnId !== colId), { columnId: colId, values }].filter((f) => f.values.length) });
  };
  const count = (id: string) => filters.find((f) => f.columnId === id)?.values.length || 0;
  return (
    <div className="form">
      <select value={colId} onChange={(e) => setColId(e.target.value)}>
        <option value="__group">Grupo{count('__group') ? ` (${count('__group')})` : ''}</option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}{count(c.id) ? ` (${count(c.id)})` : ''}
          </option>
        ))}
      </select>
      <div className="menu-scroll">
        {options.map((o) => (
          <button key={o.id} className={'menu-item' + (current.includes(o.id) ? ' checked' : '')} onClick={() => toggle(o.id)}>
            <span className="check">{current.includes(o.id) ? '✓' : ''}</span>
            {o.color && <span className="dot" style={{ background: o.color }} />} {o.name}
          </button>
        ))}
      </div>
      {filters.length > 0 && <button className="menu-item muted" onClick={() => act.patchView(view.id, { filters: [] })}>✕ Quitar todos los filtros</button>}
    </div>
  );
}
