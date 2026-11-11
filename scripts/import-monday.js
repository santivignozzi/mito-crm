// Importa un export de monday.com (ver scripts/fetch-monday.js) a la base SQLite.
// Uso: node scripts/import-monday.js [ruta-al-export.json] [--reset]
import { readFileSync } from 'node:fs';
import { db, tx, now } from '../server/db.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const file = args.find((a) => !a.startsWith('--')) || 'data/monday-export.json';
const dump = JSON.parse(readFileSync(file, 'utf8'));

const AVATAR_COLORS = ['#0073ea', '#00c875', '#e2445c', '#a25ddc', '#fdab3d', '#037f4c', '#ff5ac4', '#579bfc', '#7f5347'];
const parse = (s) => {
  try {
    return s == null ? null : JSON.parse(s);
  } catch {
    return null;
  }
};
const pad = (n) => String(n).padStart(2, '0');

function convertColumn(c) {
  const s = parse(c.settings_str) || {};
  const col = { id: c.id, title: c.title, type: c.type, settings: {} };
  if (c.width) col.width = c.width;
  switch (c.type) {
    case 'name':
    case 'subtasks':
      return null;
    case 'status': {
      const pos = s.labels_positions_v2 || {};
      col.settings.labels = Object.entries(s.labels || {})
        .map(([id, name]) => ({ id: Number(id), name, color: s.labels_colors?.[id]?.color || '#c4c4c4' }))
        .sort((a, b) => (pos[a.id] ?? a.id) - (pos[b.id] ?? b.id));
      return col;
    }
    case 'dropdown':
      col.settings.labels = (s.labels || []).map((l) => ({ id: l.id, name: l.name }));
      return col;
    case 'numbers':
      if (s.unit?.custom_unit) col.settings.unit = s.unit.custom_unit.trim();
      return col;
    case 'person':
      col.type = 'people';
      return col;
    case 'people':
    case 'date':
    case 'hour':
    case 'email':
    case 'phone':
    case 'text':
    case 'last_updated':
    case 'link':
    case 'checkbox':
      return col;
    default:
      col.type = 'text';
      return col;
  }
}

function convertValue(col, cv) {
  const v = parse(cv.value);
  switch (col.type) {
    case 'status': {
      const idx = v?.index;
      return col.settings.labels.some((l) => l.id === idx) ? idx : null;
    }
    case 'dropdown':
      return v?.ids?.length ? v.ids : null;
    case 'people': {
      const ids = (v?.personsAndTeams || []).filter((p) => p.kind === 'person').map((p) => String(p.id));
      return ids.length ? ids : null;
    }
    case 'date':
      return v?.date || null;
    case 'hour':
      return v && v.hour != null ? `${pad(v.hour)}:${pad(v.minute || 0)}` : null;
    case 'email':
      return v?.email || cv.text || null;
    case 'phone':
      return v?.phone || cv.text || null;
    case 'numbers': {
      const n = Number(typeof v === 'string' ? v : cv.text);
      return cv.text === '' || cv.text == null || Number.isNaN(n) ? null : n;
    }
    case 'checkbox':
      return v?.checked ? true : null;
    case 'link':
      return v?.url || cv.text || null;
    case 'last_updated':
      return null;
    default:
      return cv.text || null;
  }
}

function viewType(v) {
  if (v.type === 'FeatureBoardView') return null; // vistas de apps externas
  const n = v.name.toLowerCase();
  if (n.includes('kanban')) return 'kanban';
  if (n.includes('calend')) return 'calendar';
  if (n.includes('cronog') || n.includes('gantt') || n.includes('timeline')) return 'timeline';
  if (v.type === 'TableBoardView') return 'table';
  return null;
}

tx(() => {
  if (reset) for (const t of ['activity', 'updates', 'items', 'groups', 'boards', 'workspaces', 'users']) db.exec(`DELETE FROM ${t}`);

  const insUser = db.prepare('INSERT OR REPLACE INTO users (id,name,email,title,color) VALUES (?,?,?,?,?)');
  dump.users.forEach((u, i) => insUser.run(String(u.id), u.name, u.email || null, u.title || null, AVATAR_COLORS[i % AVATAR_COLORS.length]));

  const insWs = db.prepare('INSERT OR REPLACE INTO workspaces (id,name,description,position) VALUES (?,?,?,?)');
  dump.workspaces.forEach((w, i) => insWs.run(String(w.id), w.name, w.description || '', i));

  const byId = Object.fromEntries(dump.boards.map((b) => [b.id, b]));
  const insBoard = db.prepare(
    'INSERT OR REPLACE INTO boards (id,workspace_id,name,description,position,columns,subitem_columns,views,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  const insGroup = db.prepare('INSERT OR REPLACE INTO groups (id,board_id,title,color,position) VALUES (?,?,?,?,?)');
  const insItem = db.prepare(
    'INSERT OR REPLACE INTO items (id,board_id,group_id,parent_id,name,position,vals,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  const insUpd = db.prepare('INSERT OR REPLACE INTO updates (id,item_id,board_id,user_id,user_name,body,created_at) VALUES (?,?,?,?,?,?,?)');

  let nBoards = 0,
    nItems = 0,
    nUpdates = 0;
  const mains = dump.boards.filter((b) => b.type === 'board').sort((a, b) => Number(a.id) - Number(b.id));
  mains.forEach((b, bi) => {
    const columns = b.columns.filter((c) => !c.archived).map(convertColumn).filter(Boolean);
    const subCol = b.columns.find((c) => c.type === 'subtasks');
    const subBoard = subCol && byId[String((parse(subCol.settings_str)?.boardIds || [])[0])];
    const subColumns = subBoard ? subBoard.columns.map(convertColumn).filter(Boolean) : [];

    const statuses = columns.filter((c) => c.type === 'status');
    const firstStatus = (statuses.find((c) => /status|estado/i.test(c.title)) || statuses[0])?.id;
    const dates = columns.filter((c) => c.type === 'date').map((c) => c.id);
    const views = [{ id: 'main', name: 'Tabla principal', type: 'table', settings: {} }];
    const seen = new Set(['table']);
    for (const v of b.views) {
      const type = viewType(v);
      if (!type || seen.has(type)) continue; // el export no trae filtros: las tablas duplicadas serían idénticas
      seen.add(type);
      const settings = {};
      if (type === 'kanban') settings.columnId = firstStatus;
      if (type === 'calendar' || type === 'timeline') settings.dateColumnId = dates[0];
      if (type === 'timeline' && dates[1]) settings.endDateColumnId = dates[1];
      views.push({ id: 'v' + v.id, name: v.name, type, settings });
    }

    insBoard.run(b.id, String(b.workspace_id), b.name, b.description || '', bi, JSON.stringify(columns), JSON.stringify(subColumns), JSON.stringify(views), now());
    nBoards++;
    b.groups
      .filter((g) => !g.archived)
      .sort((x, y) => Number(x.position) - Number(y.position))
      .forEach((g, gi) => insGroup.run(`${b.id}_${g.id}`, b.id, g.title, g.color, gi));

    const colById = Object.fromEntries(columns.map((c) => [c.id, c]));
    const subColById = Object.fromEntries(subColumns.map((c) => [c.id, c]));
    const toVals = (cvs, map) => {
      const vals = {};
      let updater = null;
      for (const cv of cvs) {
        const col = map[cv.id];
        if (!col) continue;
        if (col.type === 'last_updated') updater = parse(cv.value)?.updater_id || updater;
        const val = convertValue(col, cv);
        if (val != null) vals[cv.id] = val;
      }
      return { vals, updater };
    };

    b.items_page.items.forEach((it, i) => {
      const gid = `${b.id}_${it.group.id}`;
      const { vals, updater } = toVals(it.column_values, colById);
      insItem.run(it.id, b.id, gid, null, it.name, i, JSON.stringify(vals), it.created_at, it.updated_at, null, updater ? String(updater) : null);
      nItems++;
      (it.subitems || []).forEach((s, si) => {
        const sv = toVals(s.column_values, subColById);
        insItem.run(s.id, b.id, gid, it.id, s.name, si, JSON.stringify(sv.vals), s.created_at || it.created_at, s.updated_at || it.updated_at, null, null);
        nItems++;
      });
      for (const u of it.updates || []) {
        insUpd.run(u.id, it.id, b.id, u.creator ? String(u.creator.id) : null, u.creator?.name || null, u.text_body || '', u.created_at);
        nUpdates++;
      }
    });
  });
  console.log(`Importado: ${dump.users.length} usuarios, ${dump.workspaces.length} espacios, ${nBoards} tableros, ${nItems} elementos, ${nUpdates} actualizaciones`);
});
