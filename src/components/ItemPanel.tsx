import { useEffect, useState } from 'react';
import type { Actions, Activity, Board, Item, Update, User } from '../types';
import { api, cellText, fmtDateTime, timeAgo } from '../util';
import { Cell } from './Cell';
import { Avatar, Editable } from './Popover';

export function describe(a: Activity, board: Board, users: User[]): string {
  const d = a.data || {};
  switch (a.kind) {
    case 'created':
      return d.duplicated_from ? 'duplicó el elemento' : 'creó el elemento';
    case 'deleted':
      return 'eliminó el elemento';
    case 'renamed':
      return `cambió el nombre de «${d.from}» a «${d.to}»`;
    case 'moved': {
      const g = (id: string) => board.groups.find((x) => x.id === id)?.title || '—';
      return `movió de «${g(d.from)}» a «${g(d.to)}»`;
    }
    case 'value': {
      const col = (d.sub ? board.subitem_columns : board.columns).find((c) => c.id === d.column_id);
      if (!col) return 'cambió un valor';
      const t = (v: any) => cellText(col, v, users) || '—';
      return `cambió ${col.title}: ${t(d.from)} → ${t(d.to)}`;
    }
    case 'update_posted':
      return 'escribió una actualización';
    case 'group_deleted':
      return `eliminó el grupo «${d.title}»`;
    default:
      return a.kind;
  }
}

export function ActivityList({ list, board, users, showItem }: { list: Activity[]; board: Board; users: User[]; showItem?: boolean }) {
  if (!list.length) return <div className="empty">Todavía no hay actividad registrada.</div>;
  return (
    <div className="activity">
      {list.map((a) => {
        const u = users.find((x) => x.id === a.user_id);
        return (
          <div key={a.id} className="activity-row">
            <span className="muted small when" title={fmtDateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
            <Avatar user={u} size={22} />
            <span>
              {showItem && a.item_name && <b>{a.item_name} · </b>}
              {describe(a, board, users)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ItemPanel({ item, board, users, act }: { item: Item; board: Board; users: User[]; act: Actions }) {
  const [tab, setTab] = useState<'updates' | 'fields' | 'activity'>('updates');
  const [updates, setUpdates] = useState<Update[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [draft, setDraft] = useState('');
  const columns = item.parent_id ? board.subitem_columns : board.columns;
  const group = board.groups.find((g) => g.id === item.group_id);

  useEffect(() => {
    api('GET', `/items/${item.id}/updates`).then(setUpdates).catch(() => setUpdates([]));
  }, [item.id]);
  useEffect(() => {
    if (tab === 'activity') api('GET', `/items/${item.id}/activity`).then(setActivity);
  }, [item.id, tab, item.updated_at]);

  const post = async () => {
    if (!draft.trim()) return;
    const u = await api<Update>('POST', `/items/${item.id}/updates`, { body: draft });
    setUpdates([u, ...updates]);
    setDraft('');
    act.bumpUpdates(item.id, 1);
  };
  const remove = async (u: Update) => {
    if (!confirm('¿Eliminar esta actualización?')) return;
    await api('DELETE', `/updates/${u.id}`);
    setUpdates(updates.filter((x) => x.id !== u.id));
    act.bumpUpdates(item.id, -1);
  };

  return (
    <aside className="panel">
      <header className="panel-head">
        <button className="icon-btn" onClick={() => act.openItem(null)} title="Cerrar">✕</button>
        <div className="panel-title">
          <Editable value={item.name} onSave={(name) => name && act.patchItem(item.id, { name })} className="item-title" />
          <div className="muted small">
            {board.name} › <span style={{ color: group?.color }}>{group?.title}</span>
          </div>
        </div>
        <button className="icon-btn" title="Eliminar elemento" onClick={() => { if (confirm('¿Eliminar este elemento?')) { act.batch([item.id], 'delete'); act.openItem(null); } }}>
          🗑
        </button>
      </header>
      <nav className="tabs">
        {([['updates', `Actualizaciones${updates.length ? ` · ${updates.length}` : ''}`], ['fields', 'Campos'], ['activity', 'Registro de actividad']] as const).map(([k, label]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'updates' && (
          <>
            <div className="composer">
              <textarea placeholder="Escribí una actualización…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && post()} />
              <div className="composer-foot">
                <span className="muted small">Ctrl + Enter para publicar</span>
                <button className="btn primary" disabled={!draft.trim()} onClick={post}>Publicar</button>
              </div>
            </div>
            {!updates.length && <div className="empty">Sin actualizaciones todavía.</div>}
            {updates.map((u) => {
              const user = users.find((x) => x.id === u.user_id);
              return (
                <article key={u.id} className="update">
                  <header>
                    <Avatar user={user} />
                    <b>{user?.name || u.user_name || 'Alguien'}</b>
                    <span className="muted small" title={fmtDateTime(u.created_at)}>{timeAgo(u.created_at)}</span>
                    <span className="spacer" />
                    <button className="icon-btn" onClick={() => remove(u)} title="Eliminar">✕</button>
                  </header>
                  <p>{u.body}</p>
                </article>
              );
            })}
          </>
        )}
        {tab === 'fields' && (
          <div className="fields">
            {columns.map((c) => (
              <div className="field" key={c.id}>
                <label>{c.title}</label>
                <div className="field-cell">
                  <Cell col={c} item={item} users={users} act={act} sub={!!item.parent_id} />
                </div>
              </div>
            ))}
            <div className="muted small">Creado el {fmtDateTime(item.created_at)}</div>
          </div>
        )}
        {tab === 'activity' && <ActivityList list={activity} board={board} users={users} />}
      </div>
    </aside>
  );
}
