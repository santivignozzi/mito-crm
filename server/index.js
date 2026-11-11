import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, tx, newId, now } from './db.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const J = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const wrap = (fn) => (req, res) => {
  try {
    const r = fn(req, res);
    if (r !== undefined) res.json(r);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- Acceso opcional con contraseña compartida (APP_PASSWORD) ----------
const PASSWORD = process.env.APP_PASSWORD || '';
const sign = (v) => createHmac('sha256', PASSWORD).update(v).digest('hex');
const cookieOf = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];
const authed = (req) => {
  if (!PASSWORD) return true;
  const c = cookieOf(req, 'crm_auth') || '';
  const expected = sign('ok');
  return c.length === expected.length && timingSafeEqual(Buffer.from(c), Buffer.from(expected));
};
app.post(
  '/api/login',
  wrap((req, res) => {
    if (PASSWORD && req.body?.password !== PASSWORD) throw fail(401, 'Contraseña incorrecta');
    if (PASSWORD) res.setHeader('Set-Cookie', `crm_auth=${sign('ok')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    return { ok: true };
  }),
);
app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'auth' })));

// ---------- Tiempo real (SSE) ----------
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': ok\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});
function notify(req, boardId) {
  const msg = `data: ${JSON.stringify({ board_id: boardId || null, client: req.headers['x-client-id'] || null })}\n\n`;
  for (const c of clients) c.write(msg);
}
const uid = (req) => req.headers['x-user-id'] || null;

function log(req, boardId, item, kind, data = {}) {
  db.prepare('INSERT INTO activity (board_id,item_id,item_name,user_id,kind,data,created_at) VALUES (?,?,?,?,?,?,?)').run(
    boardId,
    item?.id || null,
    item?.name || null,
    uid(req),
    kind,
    JSON.stringify(data),
    now(),
  );
}

const rowItem = (r) => ({ ...r, vals: J(r.vals, {}) });
const rowBoard = (r) => ({ ...r, columns: J(r.columns, []), subitem_columns: J(r.subitem_columns, []), views: J(r.views, []) });
const getItem = (id) => {
  const r = db.prepare('SELECT * FROM items WHERE id=?').get(id);
  if (!r) throw fail(404, 'Elemento no encontrado');
  return rowItem(r);
};
const nextPos = (table, where, arg) => (db.prepare(`SELECT COALESCE(MAX(position),0)+1 AS p FROM ${table} WHERE ${where}`).get(arg).p);

// ---------- Arranque ----------
app.get(
  '/api/bootstrap',
  wrap(() => ({
    users: db.prepare('SELECT * FROM users ORDER BY name').all(),
    workspaces: db.prepare('SELECT * FROM workspaces ORDER BY position').all(),
    boards: db
      .prepare('SELECT b.id,b.workspace_id,b.name,b.description,b.position,(SELECT COUNT(*) FROM items i WHERE i.board_id=b.id AND i.parent_id IS NULL) AS items_count FROM boards b ORDER BY b.position')
      .all(),
  })),
);

app.post(
  '/api/users',
  wrap((req) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw fail(400, 'Nombre requerido');
    const palette = ['#0073ea', '#00c875', '#e2445c', '#a25ddc', '#fdab3d', '#037f4c', '#ff5ac4', '#579bfc'];
    const u = { id: newId('u'), name, email: req.body.email || null, title: null, color: palette[Math.floor(Math.random() * palette.length)] };
    db.prepare('INSERT INTO users (id,name,email,title,color) VALUES (?,?,?,?,?)').run(u.id, u.name, u.email, u.title, u.color);
    notify(req);
    return u;
  }),
);

// ---------- Espacios ----------
app.post(
  '/api/workspaces',
  wrap((req) => {
    const w = { id: newId('w'), name: String(req.body?.name || 'Nuevo espacio'), description: '', position: nextPos('workspaces', '1=?', 1) };
    db.prepare('INSERT INTO workspaces (id,name,description,position) VALUES (?,?,?,?)').run(w.id, w.name, w.description, w.position);
    notify(req);
    return w;
  }),
);
app.patch(
  '/api/workspaces/:id',
  wrap((req) => {
    if (req.body.name != null) db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(String(req.body.name), req.params.id);
    notify(req);
    return { ok: true };
  }),
);
app.delete(
  '/api/workspaces/:id',
  wrap((req) => {
    db.prepare('DELETE FROM workspaces WHERE id=?').run(req.params.id);
    notify(req);
    return { ok: true };
  }),
);

// ---------- Tableros ----------
const DEFAULT_STATUS = [
  { id: 0, name: 'En curso', color: '#fdab3d' },
  { id: 1, name: 'Listo', color: '#00c875' },
  { id: 2, name: 'Detenido', color: '#df2f4a' },
];
const DEFAULT_SUB_COLUMNS = [
  { id: 'person', title: 'Responsable', type: 'people', settings: {} },
  { id: 'status', title: 'Estado', type: 'status', settings: { labels: DEFAULT_STATUS } },
  { id: 'date0', title: 'Fecha', type: 'date', settings: {} },
];

app.post(
  '/api/boards',
  wrap((req) => {
    const b = {
      id: newId('b'),
      workspace_id: req.body.workspace_id,
      name: String(req.body.name || 'Nuevo tablero'),
      description: '',
      position: nextPos('boards', 'workspace_id=?', req.body.workspace_id),
      columns: [
        { id: 'person', title: 'Responsable', type: 'people', settings: {} },
        { id: 'status', title: 'Estado', type: 'status', settings: { labels: DEFAULT_STATUS } },
        { id: 'date', title: 'Fecha', type: 'date', settings: {} },
      ],
      subitem_columns: DEFAULT_SUB_COLUMNS,
      views: [{ id: 'main', name: 'Tabla principal', type: 'table', settings: {} }],
    };
    tx(() => {
      db.prepare('INSERT INTO boards (id,workspace_id,name,description,position,columns,subitem_columns,views,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        b.id,
        b.workspace_id,
        b.name,
        b.description,
        b.position,
        JSON.stringify(b.columns),
        JSON.stringify(b.subitem_columns),
        JSON.stringify(b.views),
        now(),
      );
      db.prepare('INSERT INTO groups (id,board_id,title,color,position) VALUES (?,?,?,?,?)').run(newId('g'), b.id, 'Grupo nuevo', '#579bfc', 1);
    });
    notify(req);
    return { id: b.id };
  }),
);

app.get(
  '/api/boards/:id',
  wrap((req) => {
    const r = db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id);
    if (!r) throw fail(404, 'Tablero no encontrado');
    const b = rowBoard(r);
    if (!b.subitem_columns.length) b.subitem_columns = DEFAULT_SUB_COLUMNS;
    b.groups = db.prepare('SELECT * FROM groups WHERE board_id=? ORDER BY position').all(b.id);
    const counts = Object.fromEntries(
      db.prepare('SELECT item_id, COUNT(*) AS n FROM updates WHERE board_id=? GROUP BY item_id').all(b.id).map((x) => [x.item_id, x.n]),
    );
    b.items = db
      .prepare('SELECT * FROM items WHERE board_id=? ORDER BY position, created_at')
      .all(b.id)
      .map((i) => ({ ...rowItem(i), updates_count: counts[i.id] || 0 }));
    return b;
  }),
);

app.patch(
  '/api/boards/:id',
  wrap((req) => {
    const sets = [];
    const args = [];
    for (const k of ['name', 'description', 'workspace_id', 'position']) if (req.body[k] != null) sets.push(`${k}=?`), args.push(req.body[k]);
    for (const k of ['columns', 'subitem_columns', 'views']) if (Array.isArray(req.body[k])) sets.push(`${k}=?`), args.push(JSON.stringify(req.body[k]));
    if (sets.length) db.prepare(`UPDATE boards SET ${sets.join(',')} WHERE id=?`).run(...args, req.params.id);
    notify(req, req.params.id);
    return { ok: true };
  }),
);
app.delete(
  '/api/boards/:id',
  wrap((req) => {
    db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);
    db.prepare('DELETE FROM activity WHERE board_id=?').run(req.params.id);
    notify(req, req.params.id);
    return { ok: true };
  }),
);

// ---------- Grupos ----------
app.post(
  '/api/boards/:id/groups',
  wrap((req) => {
    const palette = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#037f4c', '#ff5ac4', '#ffcb00', '#66ccff', '#7f5347'];
    const n = db.prepare('SELECT COUNT(*) AS n FROM groups WHERE board_id=?').get(req.params.id).n;
    const top = req.body?.top;
    const pos = top ? db.prepare('SELECT COALESCE(MIN(position),0)-1 AS p FROM groups WHERE board_id=?').get(req.params.id).p : nextPos('groups', 'board_id=?', req.params.id);
    const g = { id: newId('g'), board_id: req.params.id, title: String(req.body?.title || 'Grupo nuevo'), color: req.body?.color || palette[n % palette.length], position: pos };
    db.prepare('INSERT INTO groups (id,board_id,title,color,position) VALUES (?,?,?,?,?)').run(g.id, g.board_id, g.title, g.color, g.position);
    notify(req, g.board_id);
    return g;
  }),
);
app.patch(
  '/api/groups/:id',
  wrap((req) => {
    const g = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
    if (!g) throw fail(404, 'Grupo no encontrado');
    for (const k of ['title', 'color', 'position']) if (req.body[k] != null) db.prepare(`UPDATE groups SET ${k}=? WHERE id=?`).run(req.body[k], g.id);
    notify(req, g.board_id);
    return { ok: true };
  }),
);
app.delete(
  '/api/groups/:id',
  wrap((req) => {
    const g = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
    if (!g) throw fail(404, 'Grupo no encontrado');
    if (db.prepare('SELECT COUNT(*) AS n FROM groups WHERE board_id=?').get(g.board_id).n <= 1) throw fail(400, 'El tablero necesita al menos un grupo');
    db.prepare('DELETE FROM groups WHERE id=?').run(g.id);
    log(req, g.board_id, null, 'group_deleted', { title: g.title });
    notify(req, g.board_id);
    return { ok: true };
  }),
);

// ---------- Elementos ----------
app.post(
  '/api/boards/:id/items',
  wrap((req) => {
    const { group_id, parent_id = null, name, vals = {}, top } = req.body;
    if (!String(name || '').trim()) throw fail(400, 'Nombre requerido');
    const scope = parent_id ? ['parent_id=?', parent_id] : ['group_id=?', group_id];
    const position = top ? db.prepare(`SELECT COALESCE(MIN(position),0)-1 AS p FROM items WHERE ${scope[0]}`).get(scope[1]).p : nextPos('items', scope[0], scope[1]);
    const t = now();
    const it = { id: newId('i'), board_id: req.params.id, group_id, parent_id, name: String(name).trim(), position, vals, created_at: t, updated_at: t, created_by: uid(req), updated_by: uid(req), updates_count: 0 };
    db.prepare('INSERT INTO items (id,board_id,group_id,parent_id,name,position,vals,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      it.id,
      it.board_id,
      it.group_id,
      it.parent_id,
      it.name,
      it.position,
      JSON.stringify(vals),
      t,
      t,
      it.created_by,
      it.updated_by,
    );
    log(req, it.board_id, it, 'created');
    notify(req, it.board_id);
    return it;
  }),
);

app.patch(
  '/api/items/:id',
  wrap((req) => {
    const it = getItem(req.params.id);
    const { name, group_id, position, vals } = req.body;
    tx(() => {
      if (name != null && String(name).trim() && name !== it.name) {
        log(req, it.board_id, it, 'renamed', { from: it.name, to: name });
        it.name = String(name).trim();
      }
      if (group_id != null && group_id !== it.group_id) {
        log(req, it.board_id, it, 'moved', { from: it.group_id, to: group_id });
        it.group_id = group_id;
        db.prepare('UPDATE items SET group_id=? WHERE parent_id=?').run(group_id, it.id);
      }
      if (position != null) it.position = position;
      if (vals && typeof vals === 'object') {
        for (const [k, v] of Object.entries(vals)) {
          const before = it.vals[k] ?? null;
          const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
          if (JSON.stringify(before) === JSON.stringify(empty ? null : v)) continue;
          log(req, it.board_id, it, 'value', { column_id: k, sub: !!it.parent_id, from: before, to: empty ? null : v });
          if (empty) delete it.vals[k];
          else it.vals[k] = v;
        }
      }
      it.updated_at = now();
      it.updated_by = uid(req);
      db.prepare('UPDATE items SET name=?, group_id=?, position=?, vals=?, updated_at=?, updated_by=? WHERE id=?').run(
        it.name,
        it.group_id,
        it.position,
        JSON.stringify(it.vals),
        it.updated_at,
        it.updated_by,
        it.id,
      );
    });
    notify(req, it.board_id);
    return it;
  }),
);

app.post(
  '/api/items/batch',
  wrap((req) => {
    const { ids = [], action, group_id } = req.body;
    let boardId = null;
    const created = [];
    tx(() => {
      for (const id of ids) {
        const r = db.prepare('SELECT * FROM items WHERE id=?').get(id);
        if (!r) continue;
        const it = rowItem(r);
        boardId = it.board_id;
        if (action === 'delete') {
          db.prepare('DELETE FROM items WHERE id=?').run(id);
          log(req, it.board_id, it, 'deleted');
        } else if (action === 'move') {
          db.prepare('UPDATE items SET group_id=?, position=? WHERE id=?').run(group_id, nextPos('items', 'group_id=?', group_id), id);
          db.prepare('UPDATE items SET group_id=? WHERE parent_id=?').run(group_id, id);
          log(req, it.board_id, it, 'moved', { from: it.group_id, to: group_id });
        } else if (action === 'duplicate') {
          const t = now();
          const copy = (src, parentId, name) => {
            const nid = newId('i');
            db.prepare('INSERT INTO items (id,board_id,group_id,parent_id,name,position,vals,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
              nid,
              src.board_id,
              src.group_id,
              parentId,
              name,
              src.position + 0.5,
              src.vals,
              t,
              t,
              uid(req),
              uid(req),
            );
            return nid;
          };
          const nid = copy(r, r.parent_id, `${r.name} (copia)`);
          for (const s of db.prepare('SELECT * FROM items WHERE parent_id=?').all(id)) copy(s, nid, s.name);
          created.push(nid);
          log(req, it.board_id, { id: nid, name: `${r.name} (copia)` }, 'created', { duplicated_from: id });
        }
      }
    });
    notify(req, boardId);
    return { ok: true, created };
  }),
);

// ---------- Actualizaciones y actividad ----------
app.get(
  '/api/items/:id/updates',
  wrap((req) => db.prepare('SELECT * FROM updates WHERE item_id=? ORDER BY created_at DESC').all(req.params.id)),
);
app.post(
  '/api/items/:id/updates',
  wrap((req) => {
    const it = getItem(req.params.id);
    const body = String(req.body?.body || '').trim();
    if (!body) throw fail(400, 'Texto requerido');
    const user = uid(req) && db.prepare('SELECT * FROM users WHERE id=?').get(uid(req));
    const u = { id: newId('up'), item_id: it.id, board_id: it.board_id, user_id: user?.id || null, user_name: user?.name || null, body, created_at: now() };
    db.prepare('INSERT INTO updates (id,item_id,board_id,user_id,user_name,body,created_at) VALUES (?,?,?,?,?,?,?)').run(u.id, u.item_id, u.board_id, u.user_id, u.user_name, u.body, u.created_at);
    log(req, it.board_id, it, 'update_posted');
    notify(req, it.board_id);
    return u;
  }),
);
app.delete(
  '/api/updates/:id',
  wrap((req) => {
    const u = db.prepare('SELECT * FROM updates WHERE id=?').get(req.params.id);
    if (u) db.prepare('DELETE FROM updates WHERE id=?').run(u.id);
    notify(req, u?.board_id);
    return { ok: true };
  }),
);
const rowAct = (a) => ({ ...a, data: J(a.data, {}) });
app.get(
  '/api/items/:id/activity',
  wrap((req) => db.prepare('SELECT * FROM activity WHERE item_id=? ORDER BY id DESC LIMIT 200').all(req.params.id).map(rowAct)),
);
app.get(
  '/api/boards/:id/activity',
  wrap((req) => db.prepare('SELECT * FROM activity WHERE board_id=? ORDER BY id DESC LIMIT 300').all(req.params.id).map(rowAct)),
);

// ---------- Búsqueda global ----------
app.get(
  '/api/search',
  wrap((req) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return [];
    const like = `%${q.replace(/[%_]/g, '')}%`;
    return db
      .prepare(
        `SELECT i.id, i.name, i.board_id, i.parent_id, b.name AS board_name FROM items i JOIN boards b ON b.id=i.board_id
         WHERE i.name LIKE ? OR i.vals LIKE ? ORDER BY i.updated_at DESC LIMIT 40`,
      )
      .all(like, like);
  }),
);

// ---------- Frontend estático ----------
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Mito CRM en http://localhost:${port}`));
