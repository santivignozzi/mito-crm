import type { Board, Column, ColType, Item, User, View } from './types';

export const CLIENT_ID = Math.random().toString(36).slice(2);
let userId: string | null = localStorage.getItem('crm_user');
export const getUserId = () => userId;
export const setUserId = (id: string) => {
  userId = id;
  localStorage.setItem('crm_user', id);
};

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID, ...(userId ? { 'X-User-Id': userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  }
  return r.json();
}

export const PALETTE = [
  '#00c875', '#037f4c', '#9cd326', '#cab641', '#ffcb00', '#fdab3d', '#ff6d3b', '#df2f4a', '#bb3354', '#ff5ac4',
  '#e484bd', '#a25ddc', '#9d50dd', '#401694', '#225091', '#216edf', '#579bfc', '#007eb5', '#66ccff', '#7f5347', '#c4c4c4', '#757575',
];
export const DROPDOWN_BG = '#e0e7ff';

export const COL_TYPES: { type: ColType; label: string; icon: string }[] = [
  { type: 'status', label: 'Estado', icon: '◉' },
  { type: 'text', label: 'Texto', icon: 'T' },
  { type: 'people', label: 'Personas', icon: '☺' },
  { type: 'date', label: 'Fecha', icon: '▦' },
  { type: 'numbers', label: 'Números', icon: '#' },
  { type: 'dropdown', label: 'Desplegable', icon: '▾' },
  { type: 'email', label: 'E-mail', icon: '@' },
  { type: 'phone', label: 'Teléfono', icon: '✆' },
  { type: 'link', label: 'Enlace', icon: '↗' },
  { type: 'hour', label: 'Hora', icon: '◷' },
  { type: 'checkbox', label: 'Casilla', icon: '☑' },
  { type: 'last_updated', label: 'Última actualización', icon: '↻' },
];
export const defaultWidth = (c: Column) =>
  c.width || ({ status: 150, people: 110, date: 120, hour: 100, numbers: 110, checkbox: 80, last_updated: 150, email: 200, phone: 150 } as Record<string, number>)[c.type] || 170;

// ---------- Fechas ----------
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => ymd(new Date());
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const daysBetween = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const fmtDate = (s: string) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
};
export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.floor(s / 86400)} d`;
  return fmtDate(iso.slice(0, 10));
}
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
export const isUrl = (s: unknown) => typeof s === 'string' && /^https?:\/\/\S+$/i.test(s.trim());
export const href = (s: string) => (/^https?:\/\//i.test(s) ? s : 'https://' + s);

// ---------- Valores ----------
export function cellText(col: Column, v: any, users: User[]): string {
  if (v == null) return '';
  switch (col.type) {
    case 'status':
      return col.settings.labels?.find((l) => l.id === v)?.name || '';
    case 'dropdown':
      return (v as number[]).map((id) => col.settings.labels?.find((l) => l.id === id)?.name || '').join(', ');
    case 'people':
      return (v as string[]).map((id) => users.find((u) => u.id === id)?.name || '').join(', ');
    case 'checkbox':
      return v ? 'Sí' : '';
    default:
      return String(v);
  }
}

function sortKey(col: Column | undefined, it: Item, users: User[]): string | number {
  if (!col) return it.name.toLowerCase();
  if (col.type === 'last_updated') return it.updated_at;
  const v = it.vals[col.id];
  if (v == null) return '';
  if (col.type === 'numbers') return Number(v);
  if (col.type === 'status') return col.settings.labels?.findIndex((l) => l.id === v) ?? 0;
  return cellText(col, v, users).toLowerCase();
}

/** Elementos de primer nivel que pasan filtros/búsqueda de la vista, ordenados. */
export function visibleItems(board: Board, view: View, search: string, users: User[]): Item[] {
  const { filters = [], person, sort } = view.settings;
  const q = search.trim().toLowerCase();
  const cols = Object.fromEntries(board.columns.map((c) => [c.id, c]));
  const peopleCols = board.columns.filter((c) => c.type === 'people');
  let items = board.items.filter((it) => {
    if (it.parent_id) return false;
    for (const f of filters) {
      if (!f.values.length) continue;
      if (f.columnId === '__group') {
        if (!f.values.includes(it.group_id)) return false;
        continue;
      }
      const col = cols[f.columnId];
      if (!col) continue;
      const v = it.vals[f.columnId];
      const arr: (string | number)[] = v == null ? ['__empty'] : Array.isArray(v) ? v : [v];
      if (!arr.some((x) => f.values.includes(x))) return false;
    }
    if (person && !peopleCols.some((c) => (it.vals[c.id] || []).includes(person))) return false;
    if (q) {
      const hay = it.name.toLowerCase().includes(q) || board.columns.some((c) => cellText(c, it.vals[c.id], users).toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  });
  if (sort) {
    const col = cols[sort.columnId];
    const dir = sort.dir === 'asc' ? 1 : -1;
    items = [...items].sort((a, b) => {
      const ka = sortKey(col, a, users);
      const kb = sortKey(col, b, users);
      if (ka === '' && kb !== '') return 1; // vacíos al final
      if (kb === '' && ka !== '') return -1;
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
    });
  }
  return items;
}

export function toCsv(board: Board, items: Item[], users: User[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const groups = Object.fromEntries(board.groups.map((g) => [g.id, g.title]));
  const cols = board.columns.filter((c) => c.type !== 'last_updated');
  const rows = [['Nombre', 'Grupo', ...cols.map((c) => c.title)]];
  for (const it of items) rows.push([it.name, groups[it.group_id] || '', ...cols.map((c) => cellText(c, it.vals[c.id], users))]);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n');
}
export function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
